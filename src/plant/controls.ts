import type { Layout, Point } from "./layout.ts";

// The state of the camera and the keys of the plant (docs/design/plant_ui.md section 3.4), as a plain object and pure functions of it: drag to look, wheel to zoom, the keys that walk, turn and
// tilt. No three.js, so Vitest runs them without WebGL. The camera is third person, orbits the walker, is limited in zoom (4 to 40 m) and in pitch, and is never below the floor or inside a vessel.
// Yaw 0 is a camera south of the walker looking north (z decreases); x runs east; angles are in radians. The numbers here are view constants, not domain numbers.

export interface View {
  yaw: number;
  /** The angle of the camera above the horizontal through the walker's head. */
  pitch: number;
  /** Metres from the walker's head to the camera. */
  dist: number;
}

export const LIMITS = { dist: [4, 40], pitch: [0.17, 1.3] } as const;
export const DEFAULT_VIEW: View = { yaw: 0, pitch: 0.55, dist: 14 };

const DRAG = 0.005; // radians a pixel
const WHEEL = 0.0015; // log-scale of the distance a unit of wheel delta
const STEP = 0.12; // radians a key press (and a repeat)
const clamp = (v: number, [lo, hi]: readonly [number, number]): number => Math.min(hi, Math.max(lo, v));

export const drag = (v: View, dx: number, dy: number): View => ({ ...v, yaw: v.yaw - dx * DRAG, pitch: clamp(v.pitch + dy * DRAG, LIMITS.pitch) });
export const zoom = (v: View, delta: number): View => ({ ...v, dist: clamp(v.dist * Math.exp(delta * WHEEL), LIMITS.dist) });
export const turn = (v: View, direction: 1 | -1): View => ({ ...v, yaw: v.yaw + direction * STEP });
export const tilt = (v: View, direction: 1 | -1): View => ({ ...v, pitch: clamp(v.pitch + direction * STEP, LIMITS.pitch) });

/**
 * What a key does to the view, as a function of the view, or null for a key that is not a look key: Q and E turn, R tilts up and T tilts down, plus and minus zoom. One key has one meaning (P8a):
 * `F` is the follow of a picked sample (keys.ts) and is no tilt, so the look never claims it.
 */
export const lookKey = (name: string): ((v: View) => View) | null => {
  switch (name) {
    case "q": return (v) => turn(v, -1);
    case "e": return (v) => turn(v, 1);
    case "r": return (v) => tilt(v, 1);
    case "t": return (v) => tilt(v, -1);
    case "+": case "=": return (v) => zoom(v, -120);
    case "-": case "_": return (v) => zoom(v, 120);
    default: return null;
  }
};

/**
 * How much bigger than life a tube is drawn with the camera `dist` metres from the walker (P8a): its own size from 9 m in, and then in proportion to the distance, up to twice, so that a tube of 0.2 m
 * by 0.42 m is not a few pixels at the default camera (14 m: 14/9 of its size) and is true to size where the reader looks closely, where the slots of a lane are 0.2 m apart.
 */
export const tubeScale = (dist: number): number => Math.min(2, Math.max(1, dist / 9));

/**
 * The share of the way to its goal that the camera goes in one frame of `dt` wall seconds (section 3.5): the whole way for a reader who prefers reduced motion, so the camera cuts to what a step of the
 * tour (or a click on the objects list) brings it to; otherwise it eases, 1 - e^(-9 dt) of the way.
 */
export const easeOf = (reducedMotion: boolean, dt: number): number => (reducedMotion ? 1 : 1 - Math.exp(-9 * dt));

export interface Camera {
  position: { x: number; y: number; z: number };
  target: { x: number; y: number; z: number };
}

/** The camera for a view, orbiting a walker at `at` whose head is `head` metres above the floor. */
export const cameraAt = (v: View, at: Point, head: number): Camera => ({
  position: { x: at.x + Math.sin(v.yaw) * Math.cos(v.pitch) * v.dist, y: head + Math.sin(v.pitch) * v.dist, z: at.z + Math.cos(v.yaw) * Math.cos(v.pitch) * v.dist },
  target: { x: at.x, y: head, z: at.z },
});

/** The camera kept above the floor and above whatever it would stand inside (a plinth with its vessels, the bench, a hall wall): 0.4 m over the top of it. */
export const lifted = (l: Layout, c: Camera): Camera => {
  const { x, z } = c.position;
  let y = Math.max(c.position.y, 0.5);
  for (const o of l.obstacles) if (x > o.x && x < o.x + o.w && z > o.z && z < o.z + o.d) y = Math.max(y, o.h + 0.4);
  return y === c.position.y ? c : { ...c, position: { ...c.position, y } };
};

/**
 * Where the camera goes to when it follows a tube at a new reading of the clock (section 3.4): the tube's place. Under reduced motion (section 9) there is no follow while the clock plays: the camera
 * cuts to the tube only when the clock is paused (a step, a seek), so it never glides along with the play. Null: stay where it was (the tube is not on the floor, or reduced motion while playing).
 */
export const followGoal = (tube: Point | undefined, reducedMotion: boolean, playing: boolean): Point | null => (tube && (!reducedMotion || !playing) ? { x: tube.x, z: tube.z } : null);

const KEYS = { forward: ["w", "ArrowUp"], back: ["s", "ArrowDown"], left: ["a", "ArrowLeft"], right: ["d", "ArrowRight"] } as const;
const held = (keys: ReadonlySet<string>, names: readonly string[]): number => (names.some((k) => keys.has(k)) ? 1 : 0);

/** The unit direction on the floor that the held keys ask for, relative to the camera's yaw (W walks away from the camera); zero when no key is held or two cancel. */
export const keyDirection = (keys: ReadonlySet<string>, yaw: number): Point => {
  const ahead = held(keys, KEYS.forward) - held(keys, KEYS.back);
  const side = held(keys, KEYS.right) - held(keys, KEYS.left);
  const x = -Math.sin(yaw) * ahead + Math.cos(yaw) * side;
  const z = -Math.cos(yaw) * ahead - Math.sin(yaw) * side;
  const len = Math.hypot(x, z);
  return len < 1e-9 ? { x: 0, z: 0 } : { x: x / len || 0, z: z / len || 0 };
};

/** The angle a figure faces when it walks in a direction: 0 is north, a quarter turn is east. */
export const heading = (d: Point): number => Math.atan2(d.x, -d.z);
