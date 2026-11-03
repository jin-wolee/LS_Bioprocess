import { PerspectiveCamera, Plane, Raycaster, Vector2, Vector3 } from "three";
import { DEFAULT_VIEW, cameraAt, drag, followGoal, lifted, tilt, turn, zoom } from "../controls.ts";
import type { View } from "../controls.ts";
import { focusOf } from "../focus.ts";
import type { Point } from "../layout.ts";
import { pickNearest, targetsAt } from "../pick.ts";
import { itemPoint } from "../pick_items.ts";
import type { Hit } from "../pick.ts";
import type { Scene, SceneOptions } from "../scene_types.ts";
import { sceneAt } from "../scene_at.ts";
import type { SceneState } from "../scene_at.ts";
import type { Picked } from "../view.ts";
import { RING, buildAvatar, buildRings } from "./avatar.ts";
import { buildRoom } from "./floor.ts";
import { listen } from "./input.ts";
import { buildBoards } from "./boards.ts";
import { buildFlagsBoard } from "./flags.ts";
import { buildItems } from "./items.ts";
import { buildLabels } from "./labels.ts";
import { buildMotion } from "./motion.ts";
import { buildOverlay } from "./overlay.ts";
import { buildShelves } from "./shelves.ts";
import { buildThings } from "./shapes.ts";
import { buildStage, disposeStage } from "./stage.ts";
import { buildWalker } from "./walker.ts";

export { releaseStage } from "./stage.ts";

// The scene of the plant (docs/design/plant_ui.md sections 2, 3 and 9): the one module that makes a WebGL renderer. It builds the room and the things from the layout, puts a plain operator figure
// at the entrance, and runs a frame loop that walks the figure (click, or the keys), moves the third-person camera (drag, wheel, pinch, keys) and draws. Everything it decides with is in the
// pure modules (layout, walk, controls, scene_at); this file is the glue to three.js and the DOM. Its frame loop is the one place that passes wall seconds to the clock of the run, and the scene it
// draws is `sceneAt` at the instant the clock reads (P4).

const HEAD = 1.3; // metres: the point the camera looks at, on the figure

const walkingKeys = new Set(["w", "a", "s", "d", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

export const mountScene = ({ host, layout, plan, tier, playback, reducedMotion, lens: initialLens, flags, onPick, onPickObject, onPickCell, onFollowEnd }: SceneOptions): Scene => {
  const stage = buildStage(host, layout, tier);
  const { canvas, renderer, scene, hemi, sun } = stage;

  const built = buildThings(layout);
  const { room, glass } = buildRoom(layout);
  scene.add(room, built.group);

  const disposables = [...built.disposables];
  const avatar = buildAvatar(disposables);
  scene.add(avatar);
  const { marker, halo, ring } = buildRings(disposables);
  scene.add(marker, halo, ring);

  const camera = new PerspectiveCamera(50, 1, 0.1, 300);
  const labels = buildLabels(host, layout, plan);
  const boards = buildBoards(plan, labels);
  const flagsBoard = buildFlagsBoard(layout, plan, flags, scene, labels, disposables);
  const motion = buildMotion(layout, plan, built, { scene, hemi, sun, glass }, labels, disposables);
  scene.add(motion.group);
  // a break-out case (P7c): the rack, the stations and the shelf, the links, the tape and the confirming tubes, and the overlay of the event; null for every other run
  const items = buildItems(host, layout, plan, scene, labels, initialLens, disposables);
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

  // the walker (walker.ts) and the state of the view
  const walker = buildWalker(layout, marker);
  let view: View = DEFAULT_VIEW;
  let lookAt: Point | null = null; // an object the camera was brought to, until the walker moves again
  let eye: Point = walker.position; // what the camera follows, smoothed

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
    if (p.kind === "lot" || p.kind === "equipment" || p.kind === "confirm") return itemPoint(plan, layout, p);
    const tube = state.tubes.find((x) => x.sample === p.index);
    return tube ? { x: tube.x, z: tube.z } : null;
  };

  const walkTo = (p: Point): void => {
    endFollow();
    walker.walkTo(p);
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
      const cell = flagsBoard.pick(ray.ray);
      const cards: Hit<Picked | { card: true } | { cell: true }>[] = [...(card ? [{ what: { card: true as const }, t: card.distance }] : []), ...(cell ? [{ what: { cell: true as const }, t: cell.distance }] : [])];
      const o = ray.ray.origin;
      const d = ray.ray.direction;
      const nearest = pickNearest<Picked | { card: true } | { cell: true }>({ origin: [o.x, o.y, o.z], dir: [d.x, d.y, d.z] }, targetsAt(plan, layout, state), cards);
      if (nearest && "card" in nearest.what && card) {
        endFollow();
        return onPick(card.architecture, card.sample);
      }
      if (nearest && "cell" in nearest.what && cell) {
        endFollow();
        return onPickCell(cell.hall, cell.flag);
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
        if (down) walker.keys.add(name);
        else walker.keys.delete(name);
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
      boards.update(t);
      const tubes = String(state.tubes.length);
      if (host.dataset.plantTubes !== tubes) host.dataset.plantTubes = tubes;
      // the camera follows the tube it was told to: every reading of the clock while the run plays, and, under reduced motion, only when the paused clock is moved (a cut, section 9); while the tube is not on the floor the camera stays where it was
      const goal = followGoal(following === null ? undefined : state.tubes.find((x) => x.sample === following), reducedMotion, playback.get().playing);
      if (goal) lookAt = goal;
    }
    shelves.update(t);
    overlay.update(t);
    items?.update(t);

    // held keys walk the figure and cancel a click's path, a follow and the halo
    if (walker.step(dt, view.yaw) === "keys") {
      endFollow();
      lookAt = null;
      halo.visible = false;
    }

    const goal = lookAt ?? walker.position;
    const ease = reducedMotion ? 1 : 1 - Math.exp(-9 * dt);
    eye = { x: eye.x + (goal.x - eye.x) * ease, z: eye.z + (goal.z - eye.z) * ease };
    const cam = lifted(layout, cameraAt(view, eye, HEAD));
    camera.position.set(cam.position.x, cam.position.y, cam.position.z);
    camera.lookAt(cam.target.x, cam.target.y, cam.target.z);

    avatar.position.set(walker.position.x, reducedMotion ? 0 : Math.abs(Math.sin(walker.walked * 9)) * 0.05, walker.position.z);
    avatar.rotation.y = -walker.facing;
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
  const objects = { ...built.objects, staff: plan.staff.length, flags: 1, ...items?.objects };
  host.dataset.plantObjects = JSON.stringify(objects);
  raf = requestAnimationFrame(frame);

  return {
    renderer: stage.name,
    objects,
    focus(key: string) {
      const target = focusOf(plan, layout, key, pointOf);
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
    setBreakout: (data) => items?.setBreakout(data),
    setWords: (words) => items?.setWords(words),
    setHalls(records) {
      shelves.setHalls(records);
      flagsBoard.setHalls(records);
      items?.setHalls(records);
    },
    setLens(architecture) {
      shelves.setLens(architecture);
      overlay.setLens(architecture);
      items?.setLens(architecture);
    },
    dispose() {
      cancelAnimationFrame(raf);
      stopListening();
      observer.disconnect();
      labels.dispose();
      for (const d of disposables) if (!("isMaterial" in d)) d.dispose(); // the materials stay: disposing the last one of a program deletes the program (stage.ts)
      disposeStage(stage);
    },
  };
};
