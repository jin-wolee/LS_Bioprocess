import type { PlanVisit, ScenePlan } from "../protocol.ts";

// A scene plan typed by hand for the tests of the motion (docs/design/plant_ui.md section 4): one bay of two reactors, two analyzers in one group, one record hall, two operators. Every
// instant is a round number so that the expected positions of the tests are hand arithmetic on the metres of the layout (see scene_at.test.ts for the arithmetic). Not a run of the engine.
//
//   U01 runs from 1000 s to a harvest at 9000 s, U02 from 2000 s to a stop at 12000 s. OP-01 is on duty from 0 to 20000 s, OP-02 from 10000 to 30000 s.
//   AN-2 is in maintenance from 2000 to 3300 s, AN-1 has a quality-control window from 0 to 1500 s and is closed from 20000 to 30000 s.
//   Eight samples; the indices are those of the list below (the last was added for a rerun with no wait).

const visit = (analyzer: number, queued_s: number, started_s: number, run_started_s: number, ended_s: number, attempt: number, qc: string, extra: Partial<PlanVisit> = {}): PlanVisit => ({
  analyzer, queued_s, started_s, run_started_s, ended_s, attempt, qc, setup_s: run_started_s - started_s, diluted: false, ...extra,
});

type Sample = ScenePlan["samples"][number];
const sample = (id: string, unit: number, operator: number | null, drawn_s: number, arrived_s: number | null, label: string | null, visits: PlanVisit[], skipped = false): Sample => ({
  id, unit, operator, planned_s: drawn_s - 10, drawn_s, arrived_s, label, kind: "routine", skipped, visits,
});

export const handPlan = (): ScenePlan => ({
  schema_version: "1",
  seed: 1,
  horizon_s: 40000,
  layout: {
    bays: [{ size: 2, profile: "bench_manual" }],
    analyzers: [{ profile: "allinone_atline", group: "AIO" }, { profile: "allinone_atline", group: "AIO" }],
    architectures: ["a_manual"],
  },
  units: [
    { id: "U01", bay: 1, slot: 0, profile: "bench_manual", batch: "B-U01", start_s: 1000, end_s: 9000 },
    { id: "U02", bay: 1, slot: 1, profile: "bench_manual", batch: "B-U02", start_s: 2000, end_s: 12000 },
  ],
  analyzers: [{ id: "AN-1", profile: "allinone_atline", group: "AIO" }, { id: "AN-2", profile: "allinone_atline", group: "AIO" }],
  staff: [{ id: "OP-01", on_duty: [[0, 20000]] }, { id: "OP-02", on_duty: [[10000, 30000]] }],
  samples: [
    sample("U01-D00-1", 0, 0, 2000, 2700, "handwritten", [visit(0, 2700, 2700, 2700, 2970, 1, "qc_passed")]),
    sample("U01-D00-2", 0, 0, 2200, 2900, "issued_at_draw", [visit(0, 2900, 3240, 3240, 3510, 1, "qc_passed")]),
    sample("U01-D00-3", 0, 0, 3000, 3700, "handwritten", [visit(0, 3700, 3700, 3700, 3970, 1, "qc_failed"), visit(1, 3970, 4240, 4240, 4510, 2, "qc_passed")]),
    sample("U01-D00-4", 0, 0, 8000, 8700, "preprinted_barcode", [visit(0, 8700, 8700, 8700, 8970, 1, "qc_passed")]),
    sample("U02-D00-1", 1, 0, 2100, 2800, "preprinted_barcode", [visit(0, 2800, 2970, 2970, 3240, 1, "qc_passed")]),
    sample("U02-D00-2", 1, null, 5000, null, null, [], true),
    sample("U02-D00-3", 1, 1, 11000, 11700, "issued_at_draw", [visit(1, 11700, 11700, 11820, 12090, 1, "qc_passed", { diluted: true })]),
    // no operator in the log, so no figure walks to it; a rerun that starts the second the first run ends, on the other analyzer
    sample("U02-D00-4", 1, null, 14000, 14700, "handwritten", [visit(0, 14700, 14700, 14700, 14970, 1, "qc_failed"), visit(1, 14970, 14970, 14970, 15240, 2, "qc_passed")]),
  ],
  marks: [
    { t: 3000, unit: 0, kind: "feed", source: "rule", item: null },
    { t: 3500, unit: 1, kind: "feed", source: "scripted", item: null },
    { t: 3600, unit: 0, kind: "temperature_shift", source: "scheduled", item: null },
    { t: 4000, unit: 0, kind: "alarm", source: "rule", item: null },
    { t: 7000, unit: 1, kind: "signal_observed", source: null, item: null },
    { t: 7500, unit: 1, kind: "deviation_opened", source: null, item: null },
    { t: 9000, unit: 0, kind: "harvest", source: "scheduled", item: null },
    { t: 12000, unit: 1, kind: "unit_stopped", source: "scripted", item: null },
  ],
  windows: [
    { analyzer: 0, kind: "qc", from_s: 0, to_s: 1500 },
    { analyzer: 1, kind: "maintenance", from_s: 2000, to_s: 3300 },
    { analyzer: 0, kind: "closed", from_s: 20000, to_s: 30000 },
  ],
  calibrations: [{ analyzer: 0, t: 5000 }],
  records: [],
});

/** The index of a sample of the hand plan by its id. */
export const indexOf = (plan: ScenePlan, id: string): number => {
  const i = plan.samples.findIndex((s) => s.id === id);
  if (i < 0) throw new Error(`no sample ${id} in the plan`);
  return i;
};
