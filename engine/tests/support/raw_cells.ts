import { anchorEpoch } from "../../src/calendar.ts";
import { entryConfigFor } from "../../src/experiments/assembly/raw_setup.ts";
import { rawPath } from "../../src/experiments/assembly/raw_path.ts";
import type { RawPathOutput, RawSetup } from "../../src/experiments/assembly/raw_path.ts";
import type { EntryError } from "../../src/inject/entry.ts";
import type { ObservableEvent } from "../../src/observe.ts";
import type { Profile } from "../../src/profiles.ts";
import type { CapturePath } from "../../src/raw/types.ts";
import type { Architecture } from "../../src/record/architecture.ts";
import { record } from "../../src/record/recorder.ts";
import type { RecordedDataset } from "../../src/record/types.ts";
import { requestOfTarget, validate } from "../../src/record/validate.ts";
import type { RuleConfig } from "../../src/record/validate.ts";
import { BASE, VALID_QUALIFICATIONS, byTime, inoculation, sampleWithRun } from "./cell_stream.ts";
import { CONFIGS } from "./cells.ts";
import { DIALECTS } from "./raw_run.ts";
import { lookup } from "./scenarios.ts";

// The forced-error cells of the matrix rows marked (raw) and (manual) (spec section 5; prompts/20 Step 6): one hand-built stream of one sample per row, one error forced through
// the device settings, the adapter's belief or the transcription step, run through A, B, C and each single-flag ablation of C once per capture path. This module runs a row and
// names what happened; the expected cells are typed by hand in raw_cell_tables.ts from the matrix, the rule catalogue and the evaluability of each rule. Test-only values throughout.
// A row reads "not_applicable" on the path where its class cannot arise (never zero); the harness shows why: nothing is parsed on manual_transcription and no entry is typed on adapter_ingest.

export type RawCell = "prevented" | "invisible" | "not_applicable" | `detected:${string}`;

export interface RawCellRow {
  name: string;
  /** The path where the class arises: a (raw) row on adapter_ingest, a (manual) row on manual_transcription. */
  arises: CapturePath;
  events: ObservableEvent[];
  setup: Partial<RawSetup>;
  rules: RuleConfig;
  /** The rules whose findings on the request count as evidence for this row. */
  evidence: readonly string[];
  /** Did the error arise in this run? Read from the capture step's output. */
  realised: (r: RawPathOutput) => boolean;
}

const ALLINONE = lookup("analyzer", "allinone_atline") as Profile;
const BASE_SETUP = (anchor: string, over: Partial<RawSetup> = {}): RawSetup => ({
  dialects: DIALECTS, anchor_epoch_s: anchorEpoch(anchor), zone_offset_s: 0, default_dilution: 1, export_at: () => 120000,
  visits: [{ dialect: "allinone_csv", analytes: ["glucose"], run_s: 270 }], ...over,
});

/** One sample S1 on U1, drawn at `drawn`, its run starting `hold` s later and taking 300 s. The measurement instant is drawn + hold + 300. */
const stream = (drawn: number, hold: number, value: number, analyte = "glucose"): ObservableEvent[] =>
  byTime([...BASE, inoculation("U1"), ...sampleWithRun("S1", "U1", drawn, hold, value, { analyte })]);

const RULES: RuleConfig = { hold_limit_s: 1800, late_tolerance_s: 600 };
const measuredAt = (r: RawPathOutput): number | undefined => r.events.find((e) => e.type === "result_measured" && e.request_id === "S1")?.t;
const DAYFIRST = { order: "day_first" as const, separator: "-" as const };
const MONTHFIRST = { date_order: "month_first" as const, date_separator: "-" as const };
const forced = (...e: EntryError[]): Partial<RawSetup> => ({ entry: { forced: e } });

export const RAW_ROWS: RawCellRow[] = [
  // timestamp misread (RQ2, RQ3): a device that writes day-first read by an entry pinned to month-first; intended January 8 09:11:40 (119500 s) is read as August 1
  { name: "timestamp misread: the misread instant lies later than receipt", arises: "adapter_ingest", events: stream(119000, 200, 4.2), rules: RULES, evidence: ["VR-002", "VR-003", "VR-004", "VR-024"],
    setup: BASE_SETUP("2030-01-07", { devices: { "AN-1": DAYFIRST }, beliefs: { "AN-1": MONTHFIRST } }), realised: (r) => measuredAt(r) !== undefined && measuredAt(r) !== 119500 },
  // anchor October 7: intended October 8 09:11:40 (119500 s) is read as August 10, 58 days before the anchor: earlier than the draw (119000 s)
  { name: "timestamp misread: the misread instant lies before the draw", arises: "adapter_ingest", events: stream(119000, 200, 4.2), rules: RULES, evidence: ["VR-002", "VR-003", "VR-004", "VR-024"],
    setup: BASE_SETUP("2030-10-07", { devices: { "AN-1": DAYFIRST }, beliefs: { "AN-1": MONTHFIRST } }), realised: (r) => measuredAt(r) !== undefined && measuredAt(r) !== 119500 },
  // RQ3: the counter writes the minute; 09:16:40 (33400 s) is stored as 09:16:00 (33360 s), 40 s early, still between the draw (33000 s) and receipt (120000 s)
  { name: "timestamp misread: a minute-truncated stamp still between the draw and receipt", arises: "adapter_ingest", events: stream(33000, 100, 12.5, "vcd"), rules: RULES, evidence: ["VR-002", "VR-003", "VR-004", "VR-024"],
    setup: BASE_SETUP("2030-01-07", { visits: [{ dialect: "counter_csv", analytes: ["vcd"], run_s: 130 }] }), realised: (r) => measuredAt(r) === 33360 },
  { name: "timestamp misread: the order cannot be pinned", arises: "adapter_ingest", events: stream(119000, 200, 4.2), rules: RULES, evidence: ["VR-002", "VR-003", "VR-004", "VR-024"],
    setup: BASE_SETUP("2030-01-07", { devices: { "AN-1": DAYFIRST }, beliefs: { "AN-1": { date_order: "unknown", date_separator: "-" } } }), realised: (r) => r.outputs.some((o) => o.raw_records.some((x) => x.rule_id === "VR-024")) },
  // unit implied by instrument settings, changed (RQ7)
  { name: "unit changed: a units row shows another dimension", arises: "adapter_ingest", events: stream(1000, 100, 4.2), rules: RULES, evidence: ["VR-005", "VR-006"],
    setup: BASE_SETUP("2030-01-07", { devices: { "AN-1": { units_row: true, unit_texts: { glucose: "mmol/L" } } } }), realised: (r) => r.key.files.some((f) => f.rows.some((k) => k.quirks.includes("RQ7"))) },
  { name: "unit changed: no units row, same dimension, plausible value", arises: "adapter_ingest", events: stream(1000, 100, 4.2), rules: RULES, evidence: ["VR-005", "VR-006"],
    setup: BASE_SETUP("2030-01-07", { devices: { "AN-1": { unit_texts: { glucose: "mmol/L" } } } }), realised: (r) => r.key.files.some((f) => f.rows.some((k) => k.quirks.includes("RQ7"))) },
  // viability shown in per mille (test-only unit): 970 for 97 percent, no units row, so the entry assumes percent and the value is impossible
  { name: "unit changed: no units row, an impossible value", arises: "adapter_ingest", events: stream(1000, 100, 970, "viability"), rules: RULES, evidence: ["VR-005", "VR-006"],
    setup: BASE_SETUP("2030-01-07", { visits: [{ dialect: "allinone_csv", analytes: ["viability"], run_s: 270 }], devices: { "AN-1": { unit_texts: { viability: "per mille" } } } }), realised: (r) => r.key.files.some((f) => f.rows.some((k) => k.quirks.includes("RQ7"))) },
  // result transcription error typed from the screen or printout
  { name: "transcription: a wrong digit, a plausible value", arises: "manual_transcription", events: stream(1000, 100, 5.1), rules: RULES, evidence: ["VR-005", "VR-006", "VR-013"],
    setup: BASE_SETUP("2030-01-07", forced({ kind: "value", request_id: "S1", analyte: "glucose", typed_value: 1.5 })), realised: (r) => r.key.entry_errors.length === 1 },
  { name: "transcription: a wrong digit, an impossible value", arises: "manual_transcription", events: stream(1000, 100, 97, "viability"), rules: RULES, evidence: ["VR-005", "VR-006", "VR-013"],
    setup: BASE_SETUP("2030-01-07", { visits: [{ dialect: "allinone_csv", analytes: ["viability"], run_s: 270 }], ...forced({ kind: "value", request_id: "S1", analyte: "viability", typed_value: 977 }) }), realised: (r) => r.key.entry_errors.length === 1 },
  { name: "transcription: a unit slip to another dimension", arises: "manual_transcription", events: stream(1000, 100, 5.1), rules: RULES, evidence: ["VR-005", "VR-006", "VR-013"],
    setup: BASE_SETUP("2030-01-07", forced({ kind: "unit", request_id: "S1", analyte: "glucose", typed_unit: "mmol/L" })), realised: (r) => r.key.entry_errors.length === 1 },
  { name: "transcription: a dilution factor of 3, which the method does not offer", arises: "manual_transcription", events: stream(1000, 100, 5.1), rules: RULES, evidence: ["VR-005", "VR-006", "VR-013"],
    setup: BASE_SETUP("2030-01-07", forced({ kind: "dilution", request_id: "S1", analyte: "glucose", typed_dilution: 3 })), realised: (r) => r.key.entry_errors.length === 1 },
  { name: "transcription: the dilution factor left out", arises: "manual_transcription", events: stream(1000, 100, 5.1), rules: RULES, evidence: ["VR-005", "VR-006", "VR-013"],
    setup: BASE_SETUP("2030-01-07", forced({ kind: "dilution", request_id: "S1", analyte: "glucose", typed_dilution: null })), realised: (r) => r.key.entry_errors.length === 1 },
];

export interface RawRan {
  cell: RawCell;
  out: RawPathOutput;
  ds: RecordedDataset;
}

/** Run one row through one configuration on one path: capture step, recorder, validation rules. No truth, no key reader, no evaluator. */
export const runRaw = (row: RawCellRow, config: Architecture, path: CapturePath): RawRan => {
  const setup = { ...BASE_SETUP("2030-01-07"), ...row.setup };
  const out = rawPath({ setup, seed: 5, architecture: config, path, events: row.events, received_at: {} });
  const recorded = record({ events: out.events, sensors: [], received_at: out.received_at, qualifications: VALID_QUALIFICATIONS, capture: out.capture }, config);
  const withRaw: RecordedDataset = out.tables ? { ...recorded, raw: out.tables } : recorded;
  const { dataset } = validate(withRaw, { ...row.rules, entry: entryConfigFor(ALLINONE, DIALECTS) });
  if (path !== row.arises) return { cell: "not_applicable", out, ds: dataset };
  if (!row.realised(out)) return { cell: "prevented", out, ds: dataset };
  const evidence = [...new Set(dataset.validation_finding.filter((f) => f.action !== "no-op" && row.evidence.includes(f.rule) && concerns(dataset, f.target, "S1")).map((f) => f.rule))].sort();
  return { cell: evidence.length === 0 ? "invisible" : `detected:${evidence.join("+")}`, out, ds: dataset };
};

const concerns = (ds: RecordedDataset, target: string, request: string): boolean => (target.startsWith("source_event:") ? target.includes(`|${request}|`) : requestOfTarget(ds, target) === request);

export const cellsOfRaw = (row: RawCellRow, path: CapturePath): RawCell[] => CONFIGS.map((c) => runRaw(row, c.config, path).cell);
