import type { ScenePlan } from "../protocol.ts";
import { heading } from "./controls.ts";
import { METRES } from "./layout.ts";
import type { Layout, Point } from "./layout.ts";
import { lengthOf } from "./walk.ts";

// The view constants of the scene, the shape of its state and the places on the floor that the layout does not give (the tray of the intake lanes, the ports of the analyzers, the rack, the home
// stations of the staff, the slots of a lane). Everything the log does not give is in `LOOK`, in simulated seconds and metres: not a domain number, so it carries no ledger id
// (docs/design/plant_ui.md section 4.2). Pure: no clock, no three.js.

export const LOOK = {
  /** How long a feed pulse, an alarm beacon, a signal beacon and the volume-cap tag stay lit after their instant. */
  feed_s: 1200,
  alarm_s: 1800,
  signal_s: 1800,
  cap_s: 1800,
  /** How long the QC lamp, the result slip and the calibration card stay up after the instant that raised them. */
  verdict_s: 600,
  slip_s: 600,
  card_s: 900,
  /** The tube in the operator's hand at the vessel; the operator's stay there at most; the walking pace of the staff in metres for each simulated second. */
  hand_s: 60,
  stay_s: 60,
  walk_mps: 0.06,
  /** The glide of a tube from its slot into an analyzer at `visit_started`, and from the analyzer to the rack (or back to the lane for a rerun). */
  enter_s: 60,
  leave_s: 120,
  /** The floor light outside the staffed window and the time it takes to fall to it. */
  dim: 0.35,
  ramp_s: 1800,
  /** The slots of an intake lane: the distance between two in a row and between rows. The home stations of the staff on the aisle: the first one's distance from the entrance and the step. */
  slot_pitch: 0.2,
  row_pitch: 0.15,
  home_x: 1.6,
  home_step: 0.8,
  /** Heights of a tube in metres: in the hand, on the carrier, in the lane, at the port of an analyzer, at the rack. */
  level: { hand: 1.05, carrier: 0.8, lane: 0.72, port: 1.22, rack: 1.0 },
} as const;

export type VesselLamp = "idle" | "running" | "harvested" | "stopped";
export type AnalyzerLamp = "idle" | "setup" | "run" | "qc" | "maintenance" | "closed";
export type TubePhase = "hand" | "transport" | "wait" | "enter" | "setup" | "run" | "leave";
export type StaffMode = "idle" | "walking" | "at_vessel";
export type WindowKind = ScenePlan["windows"][number]["kind"];

export interface VesselState {
  lamp: VesselLamp;
  /** A temperature shift has happened: the jacket stays tinted. */
  shifted: boolean;
  /** A feed pulse in progress: whether the feed was scripted by the reader, and how far through the pulse (0 to 1). */
  feed: { scripted: boolean; progress: number } | null;
  beacon: "alarm" | "signal" | null;
  /** A deviation has been opened on the unit: its tag stays. */
  deviation: boolean;
  /** A draw on the unit was skipped within the last `LOOK.cap_s`: the volume-cap tag. */
  capTag: boolean;
}

export interface AnalyzerState {
  lamp: AnalyzerLamp;
  /** The sign it wears: a window of the plan is open on it. */
  sign: WindowKind | null;
  /** How far through the run bar (0 to 1) while it runs; null while it sets up or does not run. */
  progress: number | null;
  /** The QC outcome of the visit that finished last, for `LOOK.verdict_s` after it, as the plan holds it. */
  verdict: string | null;
  slip: boolean;
  calibration: boolean;
  /** The index of the sample inside. */
  tube: number | null;
  /** The tubes waiting in the intake lane of its group. */
  queue: number;
}

export interface TubeState {
  /** The index into the plan's `samples`. */
  sample: number;
  phase: TubePhase;
  x: number;
  y: number;
  z: number;
  /** The direction of travel while it rides, as `heading` of controls.ts; 0 otherwise. */
  heading: number;
  /** The place in the queue (0 is the next to enter) while it waits in its slot; null otherwise. */
  rank: number | null;
  label: string | null;
  /** This visit is a later attempt of the sample: the ring. */
  rerun: boolean;
  diluted: boolean;
}

export interface StaffState {
  on_duty: boolean;
  x: number;
  z: number;
  heading: number;
  mode: StaffMode;
  /** The index of the sample whose tube is in the hand. */
  carrying: number | null;
}

export interface SceneState {
  t: number;
  /** Inside the staffed window (the union of the shifts). */
  lit: boolean;
  /** The floor light, 1 inside the window and falling to `LOOK.dim` over `LOOK.ramp_s` outside it. */
  daylight: number;
  vessels: VesselState[];
  analyzers: AnalyzerState[];
  staff: StaffState[];
  tubes: TubeState[];
}


// ---- geometry of the things the layout does not place ------------------------------------------------------

/** The z of the tray of the intake lanes: the lane drawn in front of the bench. */
export const trayZ = (l: Layout): number => l.bench.z + l.bench.d + 0.45;
/** The length of a lane's tray in metres: 2.4 m for each analyzer it serves, less 0.4 m. */
export const laneLength = (lane: { analyzers: readonly number[] }): number => lane.analyzers.length * METRES.analyzerPitch - 0.4;

/** The tube of an analyzer stands on the front strip of the bench, at its door. */
export const portOf = (l: Layout, analyzer: number): Point => ({ x: (l.analyzers[analyzer] as { x: number }).x, z: l.bench.z + l.bench.d - 0.1 });
/** The rack at the east end of the bench. */
export const rackOf = (l: Layout): Point => ({ x: l.bench.x + l.bench.w + 0.6, z: l.bench.z + l.bench.d / 2 });
export const homeOf = (l: Layout, operator: number): Point => ({ x: l.entrance.x + LOOK.home_x + LOOK.home_step * operator, z: l.entrance.z });

/** The place of slot `k` of a lane: slots fan out from the middle of the tray (front, right, left, right ...) in rows toward the aisle. */
export const slotPoint = (l: Layout, laneIndex: number, k: number): Point => {
  const lane = l.lanes[laneIndex] as { x: number; analyzers: number[] };
  const perRow = Math.max(3, Math.floor(laneLength(lane) / LOOK.slot_pitch + 1e-9) - 1);
  const j = k % perRow;
  const offset = j === 0 ? 0 : j % 2 === 1 ? (j + 1) / 2 : -j / 2;
  return { x: lane.x + offset * LOOK.slot_pitch, z: trayZ(l) - LOOK.row_pitch + Math.floor(k / perRow) * LOOK.row_pitch };
};

export const lerp = (a: number, b: number, f: number): number => a + (b - a) * f;
export const lerpPoint = (a: Point, b: Point, f: number): Point => ({ x: lerp(a.x, b.x, f), z: lerp(a.z, b.z, f) });

/** The place a fraction `f` of the way along a path, and the direction of the stretch it is on. */
export const locate = (path: readonly Point[], f: number): Point & { heading: number } => {
  const first = path[0] as Point;
  const total = lengthOf(path);
  if (path.length < 2 || total === 0) return { x: first.x, z: first.z, heading: 0 };
  let left = Math.min(1, Math.max(0, f)) * total;
  for (let k = 1; k < path.length; k++) {
    const a = path[k - 1] as Point;
    const b = path[k] as Point;
    const leg = Math.hypot(b.x - a.x, b.z - a.z);
    if (left <= leg || k === path.length - 1) {
      const u = leg === 0 ? 0 : Math.min(1, left / leg);
      return { x: lerp(a.x, b.x, u), z: lerp(a.z, b.z, u), heading: heading({ x: b.x - a.x, z: b.z - a.z }) };
    }
    left -= leg;
  }
  return { x: first.x, z: first.z, heading: 0 };
};

