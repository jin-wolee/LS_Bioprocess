import type { ScenePlan } from "../protocol.ts";
import { hallsAt } from "./halls_at.ts";
import { sceneAt } from "./scene_at.ts";
import { NEWEST, confirmOf, equipmentOf, lotOf } from "./panels_items.ts";
import type { ConfirmPanel, EquipmentPanel, LotPanel } from "./panels_items.ts";
import type { AnalyzerLamp, StaffMode, TubePhase, VesselLamp } from "./scene_at.ts";
import type { Picked } from "./view.ts";

// The content of the panel of a picked object (docs/design/plant_ui.md section 3.2, "As built in P5b"): a pure function of the plan, the clock instant and the hall the lens reads. It shows what the
// plan holds at that instant: a count is a count of the plan's rows with an instant not later than `t`, a time that has not come yet is null, and a draw the volume budget skipped is not a sample (it
// has no tube and no operator). Nothing here is a metric and nothing is truth: the qualification is whether the lens record keeps one, and the record's own fields come from `plant_record`.

/** How many of the newest rows a panel lists: the count says the rest. */
export { NEWEST };

type Sample = ScenePlan["samples"][number];

/** A sample listed by a panel: its index into the plan, its id and the instant that put it there (a draw, or the end of a visit). */
export interface Listed {
  sample: number;
  id: string;
  at_s: number;
}

export interface ReactorPanel {
  kind: "reactor";
  id: string;
  bay: number;
  profile: string;
  batch: string | null;
  status: VesselLamp;
  started_s: number | null;
  ended_s: number | null;
  /** The samples drawn on it so far (a skipped draw left no sample). */
  drawn: number;
  newest: Listed[];
}

export interface SamplePanel {
  kind: "sample";
  id: string;
  unit: string;
  operator: string | null;
  label: string | null;
  /** The phase of its tube now; `planned` before the draw, `skipped` for a draw the volume budget refused, `gone` once the tube has left the floor. */
  phase: TubePhase | "planned" | "skipped" | "gone";
  planned_s: number | null;
  drawn_s: number | null;
  arrived_s: number | null;
  /** The visits that have been queued, with the instants that have come; the QC outcome once the visit has ended. */
  visits: { analyzer: string; attempt: number; queued_s: number; started_s: number | null; run_started_s: number | null; ended_s: number | null; qc: string | null }[];
  /** The lens hall stands a card of the sample at this instant (the panel reads the record only then). */
  card: boolean;
}

export interface AnalyzerPanel {
  kind: "analyzer";
  id: string;
  profile: string;
  group: string;
  lamp: AnalyzerLamp;
  /** The sample inside now. */
  inside: string | null;
  /** The samples waiting in the intake lane of its group, the front first. */
  lane: string[];
  finished: number;
  newest: (Listed & { qc: string | null })[];
  /** The windows open now, and the next one to come. */
  windows: { kind: string; from_s: number; to_s: number; open: boolean }[];
}

export interface StaffPanel {
  kind: "staff";
  id: string;
  on_duty: boolean;
  mode: StaffMode;
  drawn: number;
  newest: Listed[];
  /** The lens record keeps the qualification in force with each draw (`audit_trail`); null while the lens hall has not arrived. */
  qualification: boolean | null;
}

/** P7c: and in a break-out case a lot, an equipment item or a confirming sample (panels_items.ts). */
export type Panel = ReactorPanel | SamplePanel | AnalyzerPanel | StaffPanel | LotPanel | EquipmentPanel | ConfirmPanel;

const upTo = (at: number | null, t: number): number | null => (at !== null && at <= t ? at : null);

/** The samples that satisfy `own`, drawn by `t`, newest first (by draw, then by sample), as listed rows. */
const drawnBy = (plan: ScenePlan, t: number, own: (s: Sample) => boolean): Listed[] =>
  plan.samples
    .map((s, sample) => ({ s, sample }))
    .filter(({ s }) => !s.skipped && s.drawn_s !== null && s.drawn_s <= t && own(s))
    .sort((a, b) => (b.s.drawn_s as number) - (a.s.drawn_s as number) || b.sample - a.sample)
    .map(({ s, sample }) => ({ sample, id: s.id, at_s: s.drawn_s as number }));

const reactorOf = (plan: ScenePlan, index: number, t: number): ReactorPanel => {
  const u = plan.units[index] as ScenePlan["units"][number];
  const drawn = drawnBy(plan, t, (s) => s.unit === index);
  return {
    kind: "reactor", id: u.id, bay: u.bay, profile: u.profile, batch: u.batch, status: sceneAt(plan, t).vessels[index]?.lamp ?? "idle",
    started_s: upTo(u.start_s, t), ended_s: upTo(u.end_s, t), drawn: drawn.length, newest: drawn.slice(0, NEWEST),
  };
};

const sampleOf = (plan: ScenePlan, index: number, t: number, lens: string): SamplePanel => {
  const s = plan.samples[index] as Sample;
  const tube = sceneAt(plan, t).tubes.find((x) => x.sample === index);
  const drawn = s.drawn_s !== null && s.drawn_s <= t;
  const phase = tube ? tube.phase : !drawn ? "planned" : s.skipped ? "skipped" : "gone";
  const card = hallsAt(plan, t).find((h) => h.architecture === lens)?.cards.some((c) => c.sample === index) ?? false;
  return {
    kind: "sample", id: s.id, unit: (plan.units[s.unit] as ScenePlan["units"][number]).id,
    operator: s.operator === null ? null : (plan.staff[s.operator] as ScenePlan["staff"][number]).id, label: s.label, phase,
    planned_s: upTo(s.planned_s, t), drawn_s: upTo(s.drawn_s, t), arrived_s: upTo(s.arrived_s, t),
    visits: s.visits.filter((v) => v.queued_s <= t).map((v) => {
      const ended = upTo(v.ended_s, t);
      return { analyzer: (plan.analyzers[v.analyzer] as ScenePlan["analyzers"][number]).id, attempt: v.attempt, queued_s: v.queued_s, started_s: upTo(v.started_s, t), run_started_s: upTo(v.run_started_s, t), ended_s: ended, qc: ended === null ? null : v.qc };
    }),
    card,
  };
};

const analyzerOf = (plan: ScenePlan, index: number, t: number): AnalyzerPanel => {
  const a = plan.analyzers[index] as ScenePlan["analyzers"][number];
  const state = sceneAt(plan, t);
  const inside = state.analyzers[index]?.tube ?? null;
  // the tubes waiting in the lane of its group, in the order they will enter (rank 0 first)
  const lane = state.tubes
    .filter((x) => x.phase === "wait" && x.rank !== null && plan.analyzers[(plan.samples[x.sample] as Sample).visits[0]?.analyzer ?? -1]?.group === a.group)
    .sort((x, y) => (x.rank as number) - (y.rank as number))
    .map((x) => (plan.samples[x.sample] as Sample).id);
  const finished = plan.samples
    .flatMap((s, sample) => s.visits.filter((v) => v.analyzer === index && v.ended_s <= t).map((v) => ({ sample, id: s.id, at_s: v.ended_s, qc: v.qc })))
    .sort((x, y) => y.at_s - x.at_s || y.sample - x.sample);
  const own = plan.windows.filter((w) => w.analyzer === index);
  const open = own.filter((w) => w.from_s <= t && t < w.to_s).map((w) => ({ kind: w.kind, from_s: w.from_s, to_s: w.to_s, open: true }));
  const next = own.filter((w) => w.from_s > t).sort((x, y) => x.from_s - y.from_s)[0];
  return {
    kind: "analyzer", id: a.id, profile: a.profile, group: a.group, lamp: state.analyzers[index]?.lamp ?? "idle",
    inside: inside === null ? null : (plan.samples[inside] as Sample).id, lane, finished: finished.length, newest: finished.slice(0, NEWEST),
    windows: [...open, ...(next ? [{ kind: next.kind, from_s: next.from_s, to_s: next.to_s, open: false }] : [])],
  };
};

const staffOf = (plan: ScenePlan, index: number, t: number, lens: string): StaffPanel => {
  const s = plan.staff[index] as ScenePlan["staff"][number];
  const now = sceneAt(plan, t).staff[index];
  const drawn = drawnBy(plan, t, (x) => x.operator === index);
  const hall = plan.records.find((r) => r.architecture === lens);
  return { kind: "staff", id: s.id, on_duty: now?.on_duty ?? false, mode: now?.mode ?? "idle", drawn: drawn.length, newest: drawn.slice(0, NEWEST), qualification: hall ? hall.flags_on.includes("audit_trail") : null };
};

/** The panel of a picked object at the instant `t`, for the record hall `lens` (the one the record panel reads). */
export const panelOf = (plan: ScenePlan, pick: Picked, t: number, lens: string): Panel => {
  switch (pick.kind) {
    case "reactor": return reactorOf(plan, pick.index, t);
    case "sample": return sampleOf(plan, pick.index, t, lens);
    case "analyzer": return analyzerOf(plan, pick.index, t);
    case "staff": return staffOf(plan, pick.index, t, lens);
    case "lot": return lotOf(plan, pick.index, t, lens);
    case "equipment": return equipmentOf(plan, pick.index, t, lens);
    case "confirm": return confirmOf(plan, pick.index, t);
  }
};
