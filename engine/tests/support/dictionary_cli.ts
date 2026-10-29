// Child-process entry of the data dictionary tests (tests/test_data_dictionary.py; prompts/20 Step 9): node engine/tests/support/dictionary_cli.ts
// Runs the recorders, the validation rules, the review step and the export on hand-built streams (every architecture, several variants) and on the default scenario at the small size,
// and prints one JSON document: for every table the columns that were emitted with the types seen, whether a null was seen and the few distinct values of a text column; the states
// seen; the state transitions performed, with their role; the transition table of the code; every key that occurs anywhere in the recorded or exported output.
// Run directly by Node (native type stripping), so it imports modules with explicit .ts extensions only.
import { ANALYTE_UNITS, EXPORT_FIELDS } from "../../src/export/columns.ts";
import { exportPackage } from "../../src/export/package.ts";
import { exportRows } from "../../src/export/rows.ts";
import type { ObservableEvent } from "../../src/observe.ts";
import { contextAsOf } from "../../src/record/asof.ts";
import { record } from "../../src/record/recorder.ts";
import { review } from "../../src/record/review.ts";
import { MACHINES, ROLES } from "../../src/record/transitions.ts";
import type { Transition } from "../../src/record/transitions.ts";
import type { QualificationInput, RecordedDataset, RecorderInput } from "../../src/record/types.ts";
import { validate } from "../../src/record/validate.ts";
import { VALID_QUALIFICATIONS, byTime } from "./cell_stream.ts";
import { CONFIGS } from "./cells.ts";
import { REVIEW } from "./review_setup.ts";
import { SENSORS, STREAM, WITH_CONFLICT, WITH_HARVEST, WITH_REPLAY, WITH_SKIP } from "./record_fixture.ts";
import { assemble } from "./sc_run.ts";
import { SMALL, runOf } from "./scenarios.ts";

interface Seen {
  types: Set<string>;
  values: Set<string>;
}
const tables = new Map<string, Map<string, Seen>>();
const keys = new Set<string>();
const log: Transition[] = [];

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
const take = (ds: RecordedDataset): void => {
  for (const t of TABLES) for (const row of ds[t]) add(t, row);
  for (const series of ds.historian.series) add("historian_series", series);
  for (const row of ds.historian.late) add("historian_value", row);
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

// the default scenario at the small size through the production assembly (injection, recording, rules, review): the states and findings of a real run
const run = runOf("default", { seed: 1, settings: SMALL });
const out = assemble(run, "default", CONFIGS.slice(0, 3).map((c) => c.config), SMALL.horizon_days as number);
for (const ds of Object.values(out.datasets)) {
  take(ds);
  exported(ds);
}

const summary = Object.fromEntries(
  [...tables].map(([t, cols]) => [t, Object.fromEntries([...cols].map(([c, s]) => [c, { types: [...s.types].sort(), values: s.values.size <= 16 ? [...s.values].sort() : [] }]))]),
);
const performed = [...new Map(log.map((t) => [`${t.entity}|${t.from}|${t.to}|${t.by}`, t])).values()].sort((a, b) => `${a.entity}${a.from}${a.to}${a.by}`.localeCompare(`${b.entity}${b.from}${b.to}${b.by}`));
console.log(JSON.stringify({ tables: summary, performed, transition_table: MACHINES, roles: ROLES, export_fields: EXPORT_FIELDS, analyte_units: ANALYTE_UNITS, keys: [...keys].sort() }));
