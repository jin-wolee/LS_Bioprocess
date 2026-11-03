// Child-process entry of the data dictionary tests (tests/test_data_dictionary.py; docs/prompts/20 Step 9): node engine/tests/support/dictionary_cli.ts
// Runs the recorders, the validation rules, the review step and the export on hand-built streams (every architecture, several variants) and on the default scenario at the small size,
// and prints one JSON document: for every table the columns that were emitted with the types seen, whether a null was seen and the few distinct values of a text column; the states
// seen; the state transitions performed, with their role; the transition table of the code; every key that occurs anywhere in the recorded or exported output.
// Run directly by Node (native type stripping), so it imports modules with explicit .ts extensions only.
import "./require_node_flags.ts"; // ADR-0016: exits 2 without the Node flags of the engine, before any engine module loads
import { ANALYTE_UNITS, EXPORT_FIELDS } from "../../src/export/columns.ts";
import { exportPackage } from "../../src/export/package.ts";
import { exportRows } from "../../src/export/rows.ts";
import type { ObservableEvent } from "../../src/observe.ts";
import { contextAsOf } from "../../src/record/asof.ts";
import { record } from "../../src/record/recorder.ts";
import { review } from "../../src/record/review.ts";
import { investigate, signalsOf } from "../../src/record/investigate/investigate.ts";
import { MACHINES, ROLES } from "../../src/record/transitions.ts";
import type { Transition } from "../../src/record/transitions.ts";
import type { QualificationInput, RecordedDataset, RecorderInput } from "../../src/record/types.ts";
import { validate } from "../../src/record/validate.ts";
import { VALID_QUALIFICATIONS, byTime } from "./cell_stream.ts";
import { FX12A, FX12A_MASTER, FX12A_SPARE, FX12E, FX12E_MASTER, H } from "./breakout_streams.ts";
import { CONFIGS } from "./cells.ts";
import { FX12M_I, FX12M_II, FX12M_MASTER } from "./fx12m_streams.ts";
import { REVIEW } from "./review_setup.ts";
import { SENSORS, STREAM, WITH_CONFLICT, WITH_HARVEST, WITH_REPLAY, WITH_SKIP } from "./record_fixture.ts";
import { runSeed } from "../../src/experiments/assembly/run_seed.ts";
import { adapterEntry } from "../../src/ingest/adapters/entry.ts";
import { parseFile } from "../../src/ingest/parse.ts";
import { newStore } from "../../src/ingest/store.ts";
import { runScenario } from "../../src/run.ts";
import { rawConfigOf, rawInputOf } from "./raw_run.ts";
import { dialectOf } from "./raw_fixtures.ts";
import { assemble } from "./sc_run.ts";
import { SMALL, runOf } from "./scenarios.ts";

interface Seen {
  types: Set<string>;
  values: Set<string>;
}
const tables = new Map<string, Map<string, Seen>>();
const keys = new Set<string>();
const log: Transition[] = [];
const logged = new Map<string, { entity: string; from: string; to: string }>();

const kind = (v: unknown): string =>
  v === null ? "null" : Array.isArray(v) || ArrayBuffer.isView(v) ? "array" : typeof v === "number" ? (Number.isInteger(v) ? "integer" : "number") : typeof v === "object" ? "object" : typeof v;

const add = (table: string, row: object): void => {
  const t = tables.get(table) ?? new Map<string, Seen>();
  tables.set(table, t);
  for (const [k, v] of Object.entries(row)) {
    const s = t.get(k) ?? { types: new Set<string>(), values: new Set<string>() };
    t.set(k, s);
    s.types.add(kind(v));
    if (typeof v === "string") s.values.add(v);
  }
};

/** Every key of a JSON-like value at any depth (typed arrays are values, not objects with keys). */
const walk = (v: unknown): void => {
  if (v === null || typeof v !== "object" || ArrayBuffer.isView(v)) return;
  if (Array.isArray(v)) return v.forEach(walk);
  for (const [k, x] of Object.entries(v)) {
    keys.add(k);
    walk(x);
  }
};

const TABLES = ["sample", "analysis_request", "run", "instrument_state", "result", "audit_event", "qualification", "source_event", "validation_finding", "ingest_conflict", "batch", "process_event"] as const;
const BREAKOUT_TABLES = ["material_lot", "equipment", "lineage_edge", "deviation", "quality_hold"] as const;
const take = (ds: RecordedDataset): void => {
  for (const t of TABLES) for (const row of ds[t]) add(t, row);
  for (const t of BREAKOUT_TABLES) for (const row of ds[t] ?? []) add(t, row);
  for (const series of ds.historian.series) add("historian_series", series);
  for (const row of ds.historian.late) add("historian_value", row);
  // S2e1: the raw-side tables of an adapter_ingest dataset (data_model section 16.1)
  for (const t of ["adapter", "raw_file", "raw_record", "parse_error", "alarm_event", "batch_phase_record"] as const) for (const row of ds.raw?.[t] ?? []) add(t, row);
  // S2e2: the transitions the controller logs carry (the alarm and phase machines of data_model 16.5 are checked against what was parsed)
  for (const r of ds.raw?.alarm_event ?? []) logged.set(`alarm_event|${r.from_state}|${r.to_state}`, { entity: "alarm_event", from: r.from_state, to: r.to_state });
  for (const r of ds.raw?.batch_phase_record ?? []) logged.set(`batch_phase_record|${r.from_state}|${r.to_state}`, { entity: "batch_phase_record", from: r.from_state, to: r.to_state });
  add("dataset", ds);
  walk(ds);
};

const AS_OF = 20000;
const META = { seed: 7, engine_version: "0.1.0", schema_version: "1", horizon_s: AS_OF, context_as_of: AS_OF, ledger_ids: ["A046"], dictionary: { path: "docs/design/data_dictionary.yaml", version: "1" } };
const exported = (ds: RecordedDataset): void => {
  const pkg = exportPackage(ds, META);
  for (const row of exportRows(ds, { context_as_of: AS_OF })) add("export_result", row);
  walk(pkg.datapackage);
  for (const f of pkg.datapackage.resources[0]?.schema.fields ?? []) keys.add(f.name);
  for (const h of (pkg.files["results.csv"] as string).split("\n")[0]?.split(",") ?? []) keys.add(h);
};

// S3 drawn after it was measured: VR-002 (sampled_at later than measured_at) quarantines it, which the review releases (A214)
const LATE_DRAW: ObservableEvent[] = byTime(STREAM.map((e) => (e.type === "sample_drawn" && e.sample_id === "S3" ? { ...e, t: 10500 } : e)));
const PLAN: RecorderInput["plan"] = { controls: { S1: "CTL-1", S2: "CTL-1" }, containers: { S1: "closed", S2: "open" } };
const VARIANTS: { events: ObservableEvent[]; qualifications: QualificationInput[] }[] = [
  { events: STREAM, qualifications: [] }, // no qualification record: VR-015 holds, the review releases
  { events: STREAM, qualifications: VALID_QUALIFICATIONS },
  { events: WITH_REPLAY, qualifications: VALID_QUALIFICATIONS },
  { events: WITH_CONFLICT, qualifications: VALID_QUALIFICATIONS },
  { events: WITH_HARVEST, qualifications: VALID_QUALIFICATIONS },
  { events: WITH_SKIP, qualifications: VALID_QUALIFICATIONS },
  { events: LATE_DRAW, qualifications: VALID_QUALIFICATIONS },
];
for (const v of VARIANTS) {
  for (const c of CONFIGS) {
    const recorded = record({ events: v.events, sensors: SENSORS, plan: PLAN, qualifications: v.qualifications }, c.config, log);
    const validated = validate(recorded, { hold_limit_s: 1800, late_tolerance_s: 600, clock_tolerance_s: 600 }, log);
    take(validated.dataset); // held and quarantined rows exist between the rules and the review
    const reviewed = review(validated.dataset, REVIEW, log);
    take(reviewed);
    exported(reviewed);
    for (const r of reviewed.result) {
      const ctx = contextAsOf(reviewed, r, AS_OF);
      if (ctx) add("process_context", ctx);
    }
  }
}

// break-out batches 3 to 5 (data_model 15.6): FX12a, FX12e and the two mycoplasma variants of FX12m as hand-built streams, recorded under every architecture with the master data of their topology, then
// the rules and the review (batch 3) and, on the record as recorded, the investigation (batch 4: holds, retro-flag versions, the states that follow). The decision settings are those of 11.8.4: d1 2 h,
// d2 4 h, the assumed lag the default of the type (12 h bacterial, 48 h mycoplasma) and the review of the S2 review step. The export is not run on these datasets: a confirming result has a test and no
// unit, and export/rows.ts is outside these batches.
const DECISIONS = { decision_delay_s: H(2), conclusion_delay_s: H(4), review: REVIEW };
for (const [events, breakout, assumed_lag_s] of [[FX12A, FX12A_MASTER, H(12)], [FX12A, FX12A_SPARE, H(12)], [FX12E, FX12E_MASTER, H(12)], [FX12M_I, FX12M_MASTER, H(48)], [FX12M_II, FX12M_MASTER, H(48)]] as const) {
  for (const c of CONFIGS) {
    const recorded = record({ events, sensors: [], qualifications: VALID_QUALIFICATIONS, breakout }, c.config, log);
    const validated = validate(recorded, { hold_limit_s: 3600, late_tolerance_s: 600, clock_tolerance_s: 900 }, log);
    take(validated.dataset);
    take(review(validated.dataset, REVIEW, log));
    take(investigate(recorded, signalsOf(events), { ...DECISIONS, assumed_lag_s }, log).dataset);
  }
}

// the default scenario at the small size through the production assembly (injection, recording, rules, review): the states and findings of a real run
const run = runOf("default", { seed: 1, settings: SMALL });
const out = assemble(run, "default", CONFIGS.slice(0, 3).map((c) => c.config), SMALL.horizon_days as number);
for (const ds of Object.values(out.datasets)) {
  take(ds);
  exported(ds);
}

// S2e1: the raw device layer: the default scenario at the small size on each capture path (the new columns of result, the capture member of the dataset, the raw tables), and a
// truncated file for the dead letter (parse_error)
for (const path of ["manual_transcription", "adapter_ingest"] as const) {
  const config = rawConfigOf("default", { seed: 1, settings: SMALL }, { capture_path: path });
  for (const ds of Object.values(runSeed(rawInputOf(runScenario(config), config, "default", CONFIGS.slice(0, 3).map((c) => c.config), SMALL.horizon_days as number)).datasets)) take(ds);
}
// S2e2: two bays of two units, one on each controller family, with a hand-given alarm on each (test-only values: AL-1 goes unacknowledged, acknowledged by op1 and normal; the production
// run emits no alarm log). The raw tables then hold alarm events and batch phase records of both families, and the historian holds the parsed rows.
{
  const config = rawConfigOf("default", { seed: 1, settings: { reactor_count: 4, bay_size: 2, cohort_size: 4, horizon_days: 8, production_days: 6 } });
  const input = rawInputOf(runScenario(config), config, "two-bays", CONFIGS.slice(0, 3).map((c) => c.config), 8);
  const alarm = (unit: string, from: string, to: string, ts: number, actor: string | null) => ({ unit, alarm_id: "AL-1", tag: "pH.PV", severity: 500, from, to, ts, actor });
  const hand = ["U01", "U03"].flatMap((u) => [alarm(u, "normal", "unacknowledged", 40000, null), alarm(u, "unacknowledged", "acknowledged", 40300, "op1"), alarm(u, "acknowledged", "normal", 41200, null)]);
  if (!input.raw?.controller) throw new Error("no controller setup");
  for (const ds of Object.values(runSeed({ ...input, raw: { ...input.raw, controller: { ...input.raw.controller, forced: { alarms: hand } } } }).datasets)) take(ds);
}
const truncated = "synthetic, modeled on public documentation; not a real instrument file\nSample ID,Date Time\nS1,2030-01-07 09:10:00\nS2,2030-01-07";
const parsed = parseFile(truncated, { entry: adapterEntry(dialectOf("allinone_csv"), { instrument: "AN-1", required_analytes: [] }), file_name: "x.csv", raw_file_id: "RF0", received_at: 0, anchor_epoch_s: 0, flags: { ingest_idempotency: true, append_only_versions: true }, store: newStore() });
for (const e of parsed.parse_errors) add("parse_error", e);

const summary = Object.fromEntries(
  [...tables].map(([t, cols]) => [t, Object.fromEntries([...cols].map(([c, s]) => [c, { types: [...s.types].sort(), values: s.values.size <= 16 ? [...s.values].sort() : [] }]))]),
);
const performed = [...new Map(log.map((t) => [`${t.entity}|${t.from}|${t.to}|${t.by}`, t])).values()].sort((a, b) => `${a.entity}${a.from}${a.to}${a.by}`.localeCompare(`${b.entity}${b.from}${b.to}${b.by}`));
console.log(JSON.stringify({ tables: summary, performed, logged: [...logged.values()].sort((a, b) => `${a.entity}${a.from}${a.to}`.localeCompare(`${b.entity}${b.from}${b.to}`)), transition_table: MACHINES, roles: ROLES, export_fields: EXPORT_FIELDS, analyte_units: ANALYTE_UNITS, keys: [...keys].sort() }));
