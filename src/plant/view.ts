import type { ScenePlan } from "../protocol.ts";

// What the HUD, the objects list and the text alternative say about a scene plan at an instant (docs/design/plant_ui.md sections 3.2 and 9). Pure functions of the plan and of integer seconds of
// the run: no clock of the page, no three.js. P3 draws the plan at its start; P4's `sceneAt` becomes the one source of what is where at an instant, and these answer from the plan until then.

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

/** The operators whose shift contains the instant: a shift is on from its first second and off at its last. */
export const onDuty = (plan: ScenePlan, t: number): string[] => plan.staff.filter((s) => s.on_duty.some(([from, to]) => from <= t && t < to)).map((s) => s.id);

export type UnitStatus = "idle" | "running" | "ended";

/** A reactor is idle before its inoculation (and for ever when it has none), running from it, and ended from its harvest or stop. */
export const statusOf = (unit: ScenePlan["units"][number], t: number): UnitStatus => {
  if (unit.start_s === null || t < unit.start_s) return "idle";
  return unit.end_s !== null && t >= unit.end_s ? "ended" : "running";
};

export type Lamp = "idle" | "qc" | "maintenance" | "closed";

export interface AnalyzerRow {
  id: string;
  profile: string;
  group: string;
  /** The tubes waiting in the intake lane of its group: queued and not yet started. */
  queue: number;
  lamp: Lamp;
}

export const analyzerRowsAt = (plan: ScenePlan, t: number): AnalyzerRow[] => {
  const waiting = (group: string): number =>
    plan.samples.reduce((n, s) => n + s.visits.filter((v) => (plan.analyzers[v.analyzer] as { group: string }).group === group && v.queued_s <= t && t < v.started_s).length, 0);
  return plan.analyzers.map((a, i) => ({
    id: a.id,
    profile: a.profile,
    group: a.group,
    queue: waiting(a.group),
    lamp: plan.windows.find((w) => w.analyzer === i && w.from_s <= t && t < w.to_s)?.kind ?? "idle",
  }));
};

export interface HallRow {
  architecture: string;
  /** How many flags the architecture has on. */
  flags: number;
  /** The cards on its shelves at the instant. */
  cards: number;
}

export const hallRowsAt = (plan: ScenePlan, t: number): HallRow[] =>
  plan.records.map((r) => ({ architecture: r.architecture, flags: r.flags_on.length, cards: r.cards.filter((c) => c.shown_s <= t).length }));

export type ObjectKind = "reactor" | "analyzer" | "hall";

export interface PlantObject {
  kind: ObjectKind;
  /** `reactor:U01`, `analyzer:AN-1`, `hall:a_manual`: what the scene and the list name an object by. */
  key: string;
  id: string;
  /** The index into the plan's `units`, `analyzers` or `records`. */
  index: number;
}

/** The objects of interest, in the order of the list: the reactors, the analyzers, the record halls. */
export const objectsOf = (plan: ScenePlan): PlantObject[] => [
  ...plan.units.map((u, index): PlantObject => ({ kind: "reactor", key: `reactor:${u.id}`, id: u.id, index })),
  ...plan.analyzers.map((a, index): PlantObject => ({ kind: "analyzer", key: `analyzer:${a.id}`, id: a.id, index })),
  ...plan.records.map((r, index): PlantObject => ({ kind: "hall", key: `hall:${r.architecture}`, id: r.architecture, index })),
];

export const countsOf = (objects: readonly PlantObject[]): Record<ObjectKind, number> => ({
  reactor: objects.filter((o) => o.kind === "reactor").length,
  analyzer: objects.filter((o) => o.kind === "analyzer").length,
  hall: objects.filter((o) => o.kind === "hall").length,
});
