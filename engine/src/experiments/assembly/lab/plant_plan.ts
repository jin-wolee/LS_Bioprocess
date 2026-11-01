import type { L3Window } from "../../../analysis.ts";
import type { ObservableEvent } from "../../../observe.ts";
import { unitIdOf } from "../../../process.ts";
import type { ScenarioConfig } from "../../../scenario.ts";
import type { PlanRecord } from "./plant_records.ts";
import { scenarioDoc } from "./setup.ts";
import type { LabData } from "./setup.ts";
import type { RunSpec } from "./spec.ts";

// The scene plan (docs/design/plant_ui.md section 4.1): what the page draws of one seed, as plain data. It is built from the observable events only (`ObservableEvent` has no hidden field in its
// type, so no code below can read one) and from the scenario's own configuration (the roster, the windows, the profile ids); it carries no sensor tick, no value of a result, no true state and no
// verdict. Times are integer seconds of the run, the true instants of the physical events; indices point into the arrays of the same plan. Break-out items (lots, equipment, confirming samples)
// are the business of the break-out scenes (P7) and are not in it yet.

const DAY = 86400;

export interface LayoutSpec {
  bays: { size: number; profile: string }[];
  /** In the order of the plan's `analyzers`. */
  analyzers: { profile: string; group: string }[];
  architectures: string[];
}

export interface PlanVisit {
  analyzer: number;
  queued_s: number;
  started_s: number;
  run_started_s: number;
  ended_s: number;
  attempt: number;
  qc: string | null;
  setup_s: number;
}

export interface ScenePlan {
  schema_version: "1";
  seed: number;
  horizon_s: number;
  layout: LayoutSpec;
  units: { id: string; bay: number; slot: number; profile: string; batch: string | null; start_s: number | null; end_s: number | null }[];
  analyzers: { id: string; profile: string; group: string }[];
  staff: { id: string; on_duty: [number, number][] }[];
  samples: { id: string; unit: number; operator: number | null; planned_s: number; drawn_s: number | null; arrived_s: number | null; label: string | null; kind: "routine" | "confirm"; skipped: boolean; visits: PlanVisit[] }[];
  marks: { t: number; unit: number; kind: string; source: "rule" | "scheduled" | "scripted" | null; item: string | null }[];
  windows: { analyzer: number; kind: "qc" | "maintenance" | "closed"; from_s: number; to_s: number }[];
  records: PlanRecord[];
}

/** The shape of the run for `layoutOf`: the bays with their profiles (the spec's list, the scenario's list, or the scenario's one profile), the analyzers, the record halls. */
export const layoutSpec = (data: LabData, spec: RunSpec, cfg: ScenarioConfig, architectures: readonly string[]): LayoutSpec => {
  const { reactors, baySize } = cfg.process;
  const doc = scenarioDoc(data, spec.scenario);
  const bays = Math.ceil(reactors / baySize);
  const listed = spec.bay_profiles ?? (doc.bay_profiles as string[] | undefined);
  return {
    bays: Array.from({ length: bays }, (_, k) => ({ size: Math.min(baySize, reactors - k * baySize), profile: listed?.[k] ?? (doc.profiles.bioreactor as string) })),
    analyzers: cfg.analysis.instruments.map((x) => ({ profile: x.profile, group: cfg.analysis.route[x.stage]?.group as string })),
    architectures: [...architectures],
  };
};

/** The ids of the samples the plan lists, in plain string order (the ids are zero-padded); the cards of the halls point into this order. */
export const plannedIds = (events: readonly ObservableEvent[]): string[] =>
  events.flatMap((e) => (e.type === "sample_planned" ? [e.sample_id] : [])).sort();

/** The roster as shift intervals (A098, A201): the first shift from the opening to the shift change on a weekday, the second from the shift change to the closing, a weekend of the first shift's first operators until the weekend closing. */
const staffOf = (cfg: ScenarioConfig, operators: readonly string[]): ScenePlan["staff"] => {
  const s = cfg.sampling;
  const days = Math.ceil(cfg.process.horizon_s / DAY);
  return operators.map((id, i) => {
    const shift = Math.floor(i / s.opsPerShift);
    const place = i % s.opsPerShift;
    const on_duty: [number, number][] = [];
    for (let d = 0; d < days; d++) {
      const weekend = d % 7 >= 5;
      if (weekend && !(shift === 0 && place < s.weekendOps)) continue;
      const to = weekend ? s.endWeekend_s : shift === 0 ? s.shiftChange_s : s.endWeekday_s;
      on_duty.push([d * DAY + (shift === 0 ? s.start_s : s.shiftChange_s), d * DAY + to]);
    }
    return { id, on_duty };
  });
};

type VisitParts = Partial<Omit<PlanVisit, "attempt">> & { attempt: number };

export interface PlanInput {
  seed: number;
  cfg: ScenarioConfig;
  events: readonly ObservableEvent[];
  operators: readonly string[];
  windows: readonly L3Window[];
  layout: LayoutSpec;
  records: PlanRecord[];
}

export const scenePlan = ({ seed, cfg, events, operators, windows, layout, records }: PlanInput): ScenePlan => {
  const horizon_s = cfg.process.horizon_s;
  const analyzers = cfg.analysis.instruments.map((x, i) => ({ id: x.id, profile: x.profile, group: (layout.analyzers[i] as { group: string }).group }));
  const analyzerIndex = new Map(analyzers.map((a, i) => [a.id, i]));
  const { reactors, baySize } = cfg.process;

  const start = new Map<string, { t: number; batch: string }>();
  const end = new Map<string, number>();
  const planned = new Map<string, { unit_id: string; t: number }>();
  const drawn = new Map<string, { t: number; operator: string | null }>();
  const received = new Map<string, number>();
  const labels = new Map<string, string>();
  const visits = new Map<string, Map<string, VisitParts>>();
  const marks: { event: ObservableEvent; unit_id: string }[] = [];
  const visit = (e: { request_id: string; attempt: number; visit: number }): VisitParts => {
    const of = visits.get(e.request_id) ?? new Map<string, VisitParts>();
    visits.set(e.request_id, of);
    const key = `${String(e.attempt).padStart(4, "0")}/${String(e.visit).padStart(4, "0")}`;
    const parts = of.get(key) ?? { attempt: e.attempt };
    of.set(key, parts);
    return parts;
  };

  for (const e of events) {
    switch (e.type) {
      case "inoculation": start.set(e.unit_id, { t: e.t, batch: e.batch_id }); break;
      case "process_event":
        if (e.kind === "harvest" || e.kind === "unit_stopped") end.set(e.unit_id, e.t);
        marks.push({ event: e, unit_id: e.unit_id });
        break;
      case "signal_observed": case "deviation_opened": marks.push({ event: e, unit_id: e.unit_id }); break;
      case "sample_planned": planned.set(e.sample_id, { unit_id: e.unit_id, t: e.t }); break;
      case "sample_drawn": drawn.set(e.sample_id, { t: e.t, operator: e.operator_id }); break;
      case "draw_skipped_volume_budget": drawn.set(e.sample_id, { t: e.t, operator: null }); break; // the instant the operator reached the vessel; no tube follows
      case "sample_received": received.set(e.sample_id, e.t); break;
      case "label_bound": labels.set(e.sample_id, e.method); break;
      case "request_queued": visit(e).queued_s = e.t; break;
      case "visit_started": Object.assign(visit(e), { started_s: e.t, setup_s: e.setup_s, analyzer: analyzerIndex.get(e.analyzer) as number }); break;
      case "run_started": visit(e).run_started_s = e.t; break;
      case "qc_result": visit(e).qc = e.outcome; break;
      case "visit_finished": visit(e).ended_s = e.t; break;
      default: break;
    }
  }

  const units: ScenePlan["units"] = Array.from({ length: reactors }, (_, i) => {
    const id = unitIdOf(i);
    const bay = Math.floor(i / baySize) + 1;
    return { id, bay, slot: i % baySize, profile: (layout.bays[bay - 1] as { profile: string }).profile, batch: start.get(id)?.batch ?? null, start_s: start.get(id)?.t ?? null, end_s: end.get(id) ?? null };
  });
  const unitIndex = new Map(units.map((u, i) => [u.id, i]));
  const staff = staffOf(cfg, operators);
  const staffIndex = new Map(staff.map((s, i) => [s.id, i]));

  const samples = plannedIds(events).map((id): ScenePlan["samples"][number] => {
    const p = planned.get(id) as { unit_id: string; t: number };
    const d = drawn.get(id);
    const tube = received.has(id);
    return {
      id,
      unit: unitIndex.get(p.unit_id) as number,
      operator: d?.operator == null ? null : (staffIndex.get(d.operator) ?? null),
      planned_s: p.t,
      drawn_s: d?.t ?? null,
      arrived_s: received.get(id) ?? null,
      label: labels.get(id) ?? null,
      kind: "routine",
      skipped: d !== undefined && !tube,
      visits: [...(visits.get(id) ?? new Map<string, VisitParts>()).entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([key, v]) => {
        const { analyzer, queued_s, started_s, run_started_s, ended_s, setup_s } = v;
        if (analyzer === undefined || queued_s === undefined || started_s === undefined || run_started_s === undefined || ended_s === undefined || setup_s === undefined) {
          throw new Error(`scene plan: visit ${key} of ${id} is incomplete in the log (queued, started, run started and finished are all needed)`);
        }
        return { analyzer, queued_s, started_s, run_started_s, ended_s, attempt: v.attempt, qc: v.qc ?? null, setup_s };
      }),
    };
  });

  return {
    schema_version: "1",
    seed,
    horizon_s,
    layout,
    units,
    analyzers,
    staff,
    samples,
    marks: marks.map(({ event: e, unit_id }) => ({
      t: e.t,
      unit: unitIndex.get(unit_id) as number,
      kind: e.type === "process_event" ? e.kind : e.type,
      source: e.type === "process_event" ? e.source : null,
      item: e.type === "process_event" ? (e.lot_id ?? e.equipment_id ?? null) : null,
    })),
    windows: windows.filter((w) => w.start_s < horizon_s).map((w) => ({ analyzer: analyzerIndex.get(w.analyzer) as number, kind: w.kind ?? "qc", from_s: w.start_s, to_s: w.end_s })),
    records,
  };
};
