import { BoxGeometry, CapsuleGeometry, Color, DirectionalLight, Fog, Group, HemisphereLight, Mesh, MeshBasicMaterial, MeshStandardMaterial, PerspectiveCamera, Plane, Raycaster, RingGeometry, Scene as ThreeScene, SphereGeometry, Vector2, Vector3, WebGLRenderer } from "three";
import type { BufferGeometry, Material } from "three";
import { DEFAULT_VIEW, cameraAt, drag, heading, keyDirection, lifted, tilt, turn, zoom } from "../controls.ts";
import type { View } from "../controls.ts";
import type { Point } from "../layout.ts";
import type { Scene, SceneOptions } from "../scene_types.ts";
import { SPEED, advance, pathOf, stepTo } from "../walk.ts";
import { PALETTE, buildRoom } from "./floor.ts";
import { listen } from "./input.ts";
import { buildLabels } from "./labels.ts";
import { buildThings } from "./shapes.ts";

// The scene of the plant (docs/design/plant_ui.md sections 2, 3 and 9): the one module that makes a WebGL renderer. It builds the room and the things from the layout, puts a plain operator figure
// at the entrance, and runs a frame loop that walks the figure (click, or the keys), moves the third-person camera (drag, wheel, pinch, keys) and draws. Everything it decides with is in the
// pure modules (layout, walk, controls); this file is the glue to three.js and the DOM. It draws the plan at one instant (P3: the static floor); the motion of the run is P4.

const HEAD = 1.3; // metres: the point the camera looks at, on the figure
const SKY = new Color(PALETTE.sky);

const walkingKeys = new Set(["w", "a", "s", "d", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

/** The figure: a plain operator in a pale coat, with a head. No likeness of any product's character. */
const buildAvatar = (disposables: (BufferGeometry | Material)[]): Group => {
  const figure = new Group();
  const coat = new MeshStandardMaterial({ color: 0x3d6fa5, roughness: 0.7 });
  const skin = new MeshStandardMaterial({ color: 0xf0c8a6, roughness: 0.8 });
  const body = new CapsuleGeometry(0.21, 0.72, 4, 12);
  const head = new SphereGeometry(0.17, 16, 12);
  disposables.push(coat, skin, body, head);
  const torso = new Mesh(body, coat);
  torso.position.y = 0.58;
  torso.castShadow = true;
  const face = new Mesh(head, skin);
  face.position.y = 1.24;
  face.castShadow = true;
  // a pale clipboard held in front (the figure faces -z), so that the way it faces can be seen
  const board = new BoxGeometry(0.3, 0.26, 0.04);
  const paper = new MeshStandardMaterial({ color: 0xf7f9fb, roughness: 0.6 });
  disposables.push(board, paper);
  const clip = new Mesh(board, paper);
  clip.position.set(0, 0.72, -0.25);
  figure.add(torso, face, clip);
  return figure;
};

export const mountScene = ({ host, layout, plan, tier, at, reducedMotion }: SceneOptions): Scene => {
  const canvas = document.createElement("canvas");
  canvas.className = "plant-canvas";
  host.appendChild(canvas);
  const renderer = new WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(tier === "high" ? Math.min(window.devicePixelRatio || 1, 2) : 1);
  renderer.shadowMap.enabled = tier === "high";

  const gl = renderer.getContext();
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  const name = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));

  const scene = new ThreeScene();
  scene.background = SKY;
  scene.fog = new Fog(PALETTE.sky, 60, 160);
  scene.add(new HemisphereLight(0xffffff, 0xc9d4dc, 1.6));
  const sun = new DirectionalLight(0xffffff, 1.6);
  const span = Math.max(layout.width, layout.depth);
  sun.position.set(layout.width * 0.75, span * 0.8, layout.depth * 1.15); // from the south, over the shoulder of a walker who enters there: the faces toward the camera are lit
  sun.target.position.set(layout.width / 2, 0, layout.depth / 2);
  sun.castShadow = tier === "high";
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -span * 0.65, right: span * 0.65, top: span * 0.65, bottom: -span * 0.65, near: 1, far: span * 3 });
  sun.shadow.camera.updateProjectionMatrix();
  scene.add(sun, sun.target);

  const built = buildThings(layout, plan, at);
  const room = buildRoom(layout);
  scene.add(room, built.group);

  const disposables = [...built.disposables];
  const avatar = buildAvatar(disposables);
  scene.add(avatar);
  const marker = new Mesh(new RingGeometry(0.24, 0.32, 28).rotateX(-Math.PI / 2), new MeshBasicMaterial({ color: PALETTE.accent }));
  marker.visible = false;
  marker.position.y = 0.03;
  const halo = new Mesh(new RingGeometry(0.9, 1.0, 40).rotateX(-Math.PI / 2), new MeshBasicMaterial({ color: PALETTE.accent }));
  halo.visible = false;
  halo.position.y = 0.04;
  disposables.push(marker.geometry, marker.material, halo.geometry, halo.material);
  scene.add(marker, halo);

  const camera = new PerspectiveCamera(50, 1, 0.1, 300);
  const labels = buildLabels(host, layout, plan);

  // the state of the walker and the view
  let position: Point = { ...layout.entrance };
  let facing = 0;
  let path: Point[] | null = null;
  let view: View = DEFAULT_VIEW;
  let lookAt: Point | null = null; // an object the camera was brought to, until the walker moves again
  let eye: Point = position; // what the camera follows, smoothed
  const keys = new Set<string>();
  let walked = 0;

  const ray = new Raycaster();
  const floor = new Plane(new Vector3(0, 1, 0), 0);
  const hit = new Vector3();
  const ndc = new Vector2();

  const walkTo = (p: Point): void => {
    path = pathOf(layout, position, p);
    const end = path[path.length - 1] as Point;
    marker.position.set(end.x, 0.03, end.z);
    marker.visible = path.length > 1;
    halo.visible = false;
    lookAt = null;
  };

  const handlers = {
    click(x: number, y: number) {
      const w = canvas.clientWidth || 1;
      const h = canvas.clientHeight || 1;
      ndc.set((x / w) * 2 - 1, -(y / h) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      if (!ray.ray.intersectPlane(floor, hit)) return;
      walkTo({ x: Math.min(layout.width, Math.max(0, hit.x)), z: Math.min(layout.depth, Math.max(0, hit.z)) });
    },
    look(dx: number, dy: number) {
      view = drag(view, dx, dy);
    },
    zoom(delta: number) {
      view = zoom(view, delta);
    },
    key(name: string, down: boolean): boolean {
      if (walkingKeys.has(name)) {
        if (down) keys.add(name);
        else keys.delete(name);
        return true;
      }
      if (!down) return false;
      if (name === "q" || name === "e") view = turn(view, name === "e" ? 1 : -1);
      else if (name === "r" || name === "f") view = tilt(view, name === "r" ? 1 : -1);
      else if (name === "+" || name === "=") view = zoom(view, -120);
      else if (name === "-" || name === "_") view = zoom(view, 120);
      else return false;
      return true;
    },
  };
  const stopListening = listen(canvas, handlers);

  const resize = (): void => {
    const w = Math.max(1, host.clientWidth);
    const h = Math.max(1, host.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();

  let last = performance.now();
  let raf = 0;
  let calls = "";
  const frame = (now: number): void => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;

    const direction = keyDirection(keys, view.yaw);
    let moving = false;
    if (direction.x !== 0 || direction.z !== 0) {
      path = null;
      marker.visible = false;
      lookAt = null;
      halo.visible = false;
      position = stepTo(layout, position, direction.x * SPEED * dt, direction.z * SPEED * dt);
      facing = heading(direction);
      moving = true;
    } else if (path) {
      const before = position;
      const step = advance(path, SPEED * dt);
      position = step.position;
      path = step.done ? null : step.rest;
      if (step.done) marker.visible = false;
      if (position.x !== before.x || position.z !== before.z) facing = heading({ x: position.x - before.x, z: position.z - before.z });
      moving = !step.done;
    }
    walked = moving ? walked + dt : 0;

    const goal = lookAt ?? position;
    const ease = reducedMotion ? 1 : 1 - Math.exp(-9 * dt);
    eye = { x: eye.x + (goal.x - eye.x) * ease, z: eye.z + (goal.z - eye.z) * ease };
    const cam = lifted(layout, cameraAt(view, eye, HEAD));
    camera.position.set(cam.position.x, cam.position.y, cam.position.z);
    camera.lookAt(cam.target.x, cam.target.y, cam.target.z);

    avatar.position.set(position.x, reducedMotion ? 0 : Math.abs(Math.sin(walked * 9)) * 0.05, position.z);
    avatar.rotation.y = -facing;
    labels.update(camera, canvas.clientWidth || 1, canvas.clientHeight || 1);
    renderer.render(scene, camera);
    const n = String(renderer.info.render.calls);
    if (n !== calls) {
      calls = n;
      host.dataset.plantCalls = n;
    }
  };
  host.dataset.plantObjects = JSON.stringify(built.objects);
  raf = requestAnimationFrame(frame);

  const where = (key: string): { at: Point; radius: number } | null => {
    const [kind, id] = key.split(":", 2);
    if (kind === "reactor") {
      const v = layout.vessels[plan.units.findIndex((u) => u.id === id)];
      return v ? { at: v, radius: 0.9 } : null;
    }
    if (kind === "analyzer") {
      const a = layout.analyzers[plan.analyzers.findIndex((x) => x.id === id)];
      return a ? { at: a, radius: 1.4 } : null;
    }
    if (kind === "hall") {
      const h = layout.halls.find((x) => x.architecture === id);
      return h ? { at: { x: h.footprint.x + h.footprint.w / 2, z: h.footprint.z + h.footprint.d / 2 }, radius: 3 } : null;
    }
    return null;
  };

  return {
    renderer: name,
    objects: built.objects,
    focus(key: string) {
      const target = where(key);
      if (!target) return;
      lookAt = target.at;
      view = { ...view, dist: Math.min(Math.max(target.radius * 5, 6), 18) };
      halo.position.set(target.at.x, 0.04, target.at.z);
      halo.scale.setScalar(target.radius);
      halo.visible = true;
    },
    dispose() {
      cancelAnimationFrame(raf);
      stopListening();
      observer.disconnect();
      labels.dispose();
      for (const d of disposables) d.dispose();
      scene.traverse((o) => {
        const mesh = o as Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const material = mesh.material as Material | Material[] | undefined;
        for (const m of Array.isArray(material) ? material : material ? [material] : []) {
          (m as MeshStandardMaterial).map?.dispose();
          m.dispose();
        }
      });
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
};
