import { BoxGeometry, CapsuleGeometry, Color, DirectionalLight, Fog, Group, HemisphereLight, Mesh, MeshBasicMaterial, MeshStandardMaterial, PerspectiveCamera, Plane, Raycaster, RingGeometry, Scene as ThreeScene, SphereGeometry, Vector2, Vector3, WebGLRenderer } from "three";
import type { BufferGeometry, Material } from "three";
import { DEFAULT_VIEW, cameraAt, drag, followGoal, heading, keyDirection, lifted, tilt, turn, zoom } from "../controls.ts";
import type { View } from "../controls.ts";
import type { Point } from "../layout.ts";
import { pickNearest, targetsAt } from "../pick.ts";
import type { Hit } from "../pick.ts";
import type { Scene, SceneOptions } from "../scene_types.ts";
import { sceneAt } from "../scene_at.ts";
import type { SceneState } from "../scene_at.ts";
import { pickedOfKey } from "../view.ts";
import type { Picked } from "../view.ts";
import { SPEED, advance, pathOf, stepTo } from "../walk.ts";
import { PALETTE, buildRoom } from "./floor.ts";
import { listen } from "./input.ts";
import { buildLabels } from "./labels.ts";
import { buildMotion } from "./motion.ts";
import { buildOverlay } from "./overlay.ts";
import { buildShelves } from "./shelves.ts";
import { buildThings } from "./shapes.ts";

// The scene of the plant (docs/design/plant_ui.md sections 2, 3 and 9): the one module that makes a WebGL renderer. It builds the room and the things from the layout, puts a plain operator figure
// at the entrance, and runs a frame loop that walks the figure (click, or the keys), moves the third-person camera (drag, wheel, pinch, keys) and draws. Everything it decides with is in the
// pure modules (layout, walk, controls, scene_at); this file is the glue to three.js and the DOM. Its frame loop is the one place that passes wall seconds to the clock of the run, and the scene it
// draws is `sceneAt` at the instant the clock reads (P4).

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

/** The size of the ring on the floor about a picked object, in metres. */
const RING = { reactor: 0.85, analyzer: 1.3, staff: 0.5, sample: 0.4 } as const;

export const mountScene = ({ host, layout, plan, tier, playback, reducedMotion, lens: initialLens, onPick, onPickObject, onFollowEnd }: SceneOptions): Scene => {
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
  const hemi = new HemisphereLight(0xffffff, 0xc9d4dc, 1.6);
  scene.add(hemi);
  const sun = new DirectionalLight(0xffffff, 1.6);
  const span = Math.max(layout.width, layout.depth);
  sun.position.set(layout.width * 0.75, span * 0.8, layout.depth * 1.15); // from the south, over the shoulder of a walker who enters there: the faces toward the camera are lit
  sun.target.position.set(layout.width / 2, 0, layout.depth / 2);
  sun.castShadow = tier === "high";
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -span * 0.65, right: span * 0.65, top: span * 0.65, bottom: -span * 0.65, near: 1, far: span * 3 });
  sun.shadow.camera.updateProjectionMatrix();
  scene.add(sun, sun.target);

  const built = buildThings(layout);
  const { room, glass } = buildRoom(layout);
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
  // the ring on the floor about the object the panel shows: it follows the object while it moves
  const ring = new Mesh(new RingGeometry(0.9, 1.0, 40).rotateX(-Math.PI / 2), new MeshBasicMaterial({ color: PALETTE.accent }));
  ring.visible = false;
  disposables.push(marker.geometry, marker.material, halo.geometry, halo.material, ring.geometry, ring.material);
  scene.add(marker, halo, ring);

  const camera = new PerspectiveCamera(50, 1, 0.1, 300);
  const labels = buildLabels(host, layout, plan);
  const motion = buildMotion(layout, plan, built, { scene, hemi, sun, glass }, labels, disposables);
  scene.add(motion.group);
  let drawn = Number.NaN; // the clock reading `motion` was last written for
  // the record halls: the cards on the shelves, the lens and the card a click meets (shelves.ts)
  const shelves = buildShelves(host, layout, plan, motion, labels, initialLens);
  // the truth overlay (P5b): the placeholders on the rails of the halls, built when the page hands over the Worker's answer
  const overlay = buildOverlay(host, layout, plan, motion.group, labels, initialLens);

  // the object the panel shows, the tube the camera follows, and the state of the floor at the clock reading last drawn
  let picked: Picked | null = null;
  let following: number | null = null;
  let state: SceneState = sceneAt(plan, playback.get().t);
  const endFollow = (): void => {
    if (following === null) return;
    following = null;
    delete host.dataset.plantFollowNdc;
    onFollowEnd();
  };

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
  const projected = new Vector3();
  /** Where a picked object stands on the floor at the clock reading last drawn, or null (an operator off duty, a tube that has left the floor). */
  const pointOf = (p: Picked): Point | null => {
    if (p.kind === "reactor") return layout.vessels[p.index] ?? null;
    if (p.kind === "analyzer") return layout.analyzers[p.index] ?? null;
    if (p.kind === "staff") {
      const s = state.staff[p.index];
      return s?.on_duty ? { x: s.x, z: s.z } : null;
    }
    const tube = state.tubes.find((x) => x.sample === p.index);
    return tube ? { x: tube.x, z: tube.z } : null;
  };

  const walkTo = (p: Point): void => {
    endFollow();
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
      // the nearest thing along the ray: a vessel, an analyzer, a figure on duty, a tube, or a card on a shelf (the arithmetic of P5a, compared by its distance along the ray); a click that meets none walks
      const card = shelves.pick(ray.ray);
      const cards: Hit<Picked | { card: true }>[] = card ? [{ what: { card: true }, t: card.distance }] : [];
      const o = ray.ray.origin;
      const d = ray.ray.direction;
      const nearest = pickNearest<Picked | { card: true }>({ origin: [o.x, o.y, o.z], dir: [d.x, d.y, d.z] }, targetsAt(plan, layout, state), cards);
      if (nearest && "card" in nearest.what && card) {
        endFollow();
        return onPick(card.architecture, card.sample);
      }
      if (nearest && "kind" in nearest.what) {
        endFollow();
        return onPickObject(nearest.what);
      }
      if (!ray.ray.intersectPlane(floor, hit)) return;
      walkTo({ x: Math.min(layout.width, Math.max(0, hit.x)), z: Math.min(layout.depth, Math.max(0, hit.z)) });
    },
    look(dx: number, dy: number) {
      endFollow();
      view = drag(view, dx, dy);
    },
    zoom(delta: number) {
      endFollow();
      view = zoom(view, delta);
    },
    key(name: string, down: boolean): boolean {
      if (walkingKeys.has(name)) {
        if (down) keys.add(name);
        else keys.delete(name);
        return true;
      }
      if (!down) return false;
      // F follows a picked sample (the page handles the key); with none picked it tilts, as before
      if (name === "f" && picked?.kind === "sample") return false;
      if (["q", "e", "r", "f", "+", "=", "-", "_"].includes(name)) endFollow();
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

    // the clock of the run: wall seconds in, and the scene written again only when the reading changed
    playback.tick(dt);
    const t = playback.get().t;
    if (t !== drawn) {
      drawn = t;
      state = sceneAt(plan, t);
      motion.update(state);
      const tubes = String(state.tubes.length);
      if (host.dataset.plantTubes !== tubes) host.dataset.plantTubes = tubes;
      // the camera follows the tube it was told to: every reading of the clock while the run plays, and, under reduced motion, only when the paused clock is moved (a cut, section 9); while the tube is not on the floor the camera stays where it was
      const goal = followGoal(following === null ? undefined : state.tubes.find((x) => x.sample === following), reducedMotion, playback.get().playing);
      if (goal) lookAt = goal;
    }
    shelves.update(t);
    overlay.update(t);

    const direction = keyDirection(keys, view.yaw);
    let moving = false;
    if (direction.x !== 0 || direction.z !== 0) {
      endFollow();
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
    // the ring on the floor about the picked object, where it is now; and, while the camera follows a tube, where that tube is on the screen (-1 to 1 on both axes is inside the view)
    const at = picked === null ? null : pointOf(picked);
    ring.visible = at !== null;
    if (at) {
      ring.position.set(at.x, 0.05, at.z);
      ring.scale.setScalar(RING[(picked as Picked).kind]);
    }
    const followed = following === null ? undefined : state.tubes.find((x) => x.sample === following);
    if (followed) {
      projected.set(followed.x, followed.y + 0.2, followed.z).project(camera);
      const where = `[${projected.x.toFixed(3)},${projected.y.toFixed(3)}]`;
      if (host.dataset.plantFollowNdc !== where) host.dataset.plantFollowNdc = where;
    }
    labels.update(camera, canvas.clientWidth || 1, canvas.clientHeight || 1);
    renderer.render(scene, camera);
    const n = String(renderer.info.render.calls);
    if (n !== calls) {
      calls = n;
      host.dataset.plantCalls = n;
    }
  };
  // what the scene built, by kind: the figures of the staff are one for each operator of the plan
  const objects = { ...built.objects, staff: plan.staff.length };
  host.dataset.plantObjects = JSON.stringify(objects);
  raf = requestAnimationFrame(frame);

  const where = (key: string): { at: Point; radius: number; pitch?: number } | null => {
    const [kind, id] = key.split(":", 2);
    if (kind === "staff" || kind === "sample") {
      // a thing that moves: where it stands at the clock reading last drawn
      const found = pickedOfKey(plan, key);
      const at = found === null ? null : pointOf(found);
      return at ? { at, radius: kind === "staff" ? 0.9 : 0.7 } : null;
    }
    if (kind === "reactor") {
      const v = layout.vessels[plan.units.findIndex((u) => u.id === id)];
      return v ? { at: v, radius: 0.9 } : null;
    }
    if (kind === "analyzer") {
      const a = layout.analyzers[plan.analyzers.findIndex((x) => x.id === id)];
      return a ? { at: a, radius: 1.4 } : null;
    }
    if (kind === "hall") {
      // close to the shelves and level with them: the cards are a few centimetres wide
      const h = layout.halls.find((x) => x.architecture === id);
      return h ? { at: { x: h.footprint.x + h.footprint.w / 2, z: h.footprint.z + h.footprint.d / 2 }, radius: 1.2, pitch: 0.2 } : null;
    }
    return null;
  };

  return {
    renderer: name,
    objects,
    focus(key: string) {
      const target = where(key);
      if (!target) return;
      endFollow();
      lookAt = target.at;
      view = { ...view, dist: Math.min(Math.max(target.radius * 5, 6), 18), ...(target.pitch !== undefined && { pitch: target.pitch }) };
      halo.position.set(target.at.x, 0.04, target.at.z);
      halo.scale.setScalar(target.radius);
      halo.visible = true;
    },
    setPick(next) {
      picked = next;
      if (next === null || next.kind !== "sample") endFollow();
    },
    setFollow(sample) {
      if (sample === null) {
        following = null;
        delete host.dataset.plantFollowNdc;
        return;
      }
      following = sample;
      const tube = state.tubes.find((x) => x.sample === sample);
      if (tube) lookAt = { x: tube.x, z: tube.z };
      view = { ...view, dist: Math.min(view.dist, 9) };
      halo.visible = false;
    },
    setOverlay: overlay.set,
    setHalls: shelves.setHalls,
    setLens(architecture) {
      shelves.setLens(architecture);
      overlay.setLens(architecture);
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
