import type { ScenePlan } from "../protocol.ts";
import { boardId } from "./board.ts";
import { hallsAt } from "./halls_at.ts";

// What the HUD, the objects list and the text alternative say about a scene plan (docs/design/plant_ui.md sections 3.2 and 9). Pure functions of the plan and of seconds of the run: no clock of the
// page, no three.js. What is where at an instant is `sceneAt` (scene_at.ts), the one source; the clock reading, the roster and the lists of objects are here.

const DAY = 86400;

/** The clock reading of an instant: the day of the run (day 0 is a Monday, spec 2.1) and the time of day. */
export const clockOf = (t: number): { day: number; time: string } => {
  const day = Math.floor(t / DAY);
  const s = t - day * DAY;
  const two = (n: number): string => String(n).padStart(2, "0");
  return { day, time: `${two(Math.floor(s / 3600))}:${two(Math.floor((s % 3600) / 60))}` };
};

/** The plan's start: the opening of the first staffed window (day 0 begins at midnight and nobody is on the floor until the first shift opens); 0 when the roster is empty. */
export const startInstant = (plan: ScenePlan): number => {
  const opens = plan.staff.flatMap((s) => s.on_duty.map(([from]) => from));
  return opens.length === 0 ? 0 : Math.min(...opens);
};

/** Whether an instant is inside one of the shifts: a shift is on from its first second and off at its last. The one predicate of the roster, for the HUD (`onDuty`) and for the figures of the scene (`sceneAt`). */
export const onShift = (shifts: readonly (readonly [number, number])[], t: number): boolean => shifts.some(([from, to]) => from <= t && t < to);

/** The operators whose shift contains the instant. */
export const onDuty = (plan: ScenePlan, t: number): string[] => plan.staff.filter((s) => onShift(s.on_duty, t)).map((s) => s.id);

export interface HallRow {
  architecture: string;
  /** How many flags the architecture has on. */
  flags: number;
  /** The cards on its shelves at the instant (shown). */
  cards: number;
  /** Of those, the cards the record says are available (knowable); always 0 where the architecture stores no availability. */
  knowable: number;
}

export const hallRowsAt = (plan: ScenePlan, t: number): HallRow[] => hallsAt(plan, t).map((h) => ({ architecture: h.architecture, flags: h.flags_on.length, cards: h.shown, knowable: h.knowable }));

export type ObjectKind = "reactor" | "analyzer" | "staff" | "hall" | "board" | "flags";

export interface PlantObject {
  kind: ObjectKind;
  /** `reactor:U01`, `analyzer:AN-1`, `staff:OP-01`, `hall:a_manual`, `board:B1`, `flags:board`: what the scene and the list name an object by. */
  key: string;
  id: string;
  /** The index into the plan's `units`, `analyzers`, `staff`, the architectures of its layout or its bays. */
  index: number;
}

/** The objects of interest, in the order of the list: the reactors, the analyzers, the staff, the record halls (one for each architecture of the layout, so the list agrees with the floor before every hall has arrived), the sampling boards (one for each bay, P6a) and the flags board (one, P6b). */
export const objectsOf = (plan: ScenePlan): PlantObject[] => [
  ...plan.units.map((u, index): PlantObject => ({ kind: "reactor", key: `reactor:${u.id}`, id: u.id, index })),
  ...plan.analyzers.map((a, index): PlantObject => ({ kind: "analyzer", key: `analyzer:${a.id}`, id: a.id, index })),
  ...plan.staff.map((s, index): PlantObject => ({ kind: "staff", key: `staff:${s.id}`, id: s.id, index })),
  ...plan.layout.architectures.map((architecture, index): PlantObject => ({ kind: "hall", key: `hall:${architecture}`, id: architecture, index })),
  ...plan.layout.bays.map((_, index): PlantObject => ({ kind: "board", key: `board:${boardId(index)}`, id: boardId(index), index })),
  { kind: "flags", key: "flags:board", id: "flags", index: 0 },
];

export const countsOf = (objects: readonly PlantObject[]): Record<ObjectKind, number> => ({
  reactor: objects.filter((o) => o.kind === "reactor").length,
  analyzer: objects.filter((o) => o.kind === "analyzer").length,
  staff: objects.filter((o) => o.kind === "staff").length,
  hall: objects.filter((o) => o.kind === "hall").length,
  board: objects.filter((o) => o.kind === "board").length,
  flags: objects.filter((o) => o.kind === "flags").length,
});

/** What a click or a button can pick, to open a panel and to step between the events of (section 3.4): a reactor, an analyzer, an operator or a sample. The index is into the plan's `units`, `analyzers`, `staff` or `samples`. */
export type PickKind = "reactor" | "analyzer" | "staff" | "sample";
export interface Picked {
  kind: PickKind;
  index: number;
}

const LISTS = { reactor: "units", analyzer: "analyzers", staff: "staff", sample: "samples" } as const;
const PICK_KINDS = Object.keys(LISTS) as PickKind[];

/** The key of a picked object, as `data-plant-pick` and the objects list name it: the kind and the id of the plan (`reactor:U01`, `sample:U10-D08-1`). */
export const keyOf = (plan: ScenePlan, p: Picked): string => `${p.kind}:${(plan[LISTS[p.kind]][p.index] as { id: string }).id}`;

/** The pick a key names, or null for a key the plan does not hold or of a kind that is not a pick (a hall opens the record panel, not an object panel). */
export const pickedOfKey = (plan: ScenePlan, key: string): Picked | null => {
  const at = key.indexOf(":");
  const kind = key.slice(0, at) as PickKind;
  if (at < 0 || !PICK_KINDS.includes(kind)) return null;
  const index = (plan[LISTS[kind]] as { id: string }[]).findIndex((x) => x.id === key.slice(at + 1));
  return index < 0 ? null : { kind, index };
};
