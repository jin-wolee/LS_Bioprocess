import { beforeAll, describe, expect, it } from "vitest";
import { anchorEpoch } from "../../src/calendar.ts";
import { entryConfigFor } from "../../src/experiments/assembly/raw_setup.ts";
import { rawPath } from "../../src/experiments/assembly/raw_path.ts";
import type { RawPathOutput, RawSetup } from "../../src/experiments/assembly/raw_path.ts";
import { physicalIds } from "../../src/experiments/assembly/physical_ids.ts";
import { runSeed } from "../../src/experiments/assembly/run_seed.ts";
import type { SeedOutput } from "../../src/experiments/assembly/run_seed.ts";
import { transcribe, transposeDigits } from "../../src/inject/entry.ts";
import type { ObservableEvent } from "../../src/observe.ts";
import type { Profile } from "../../src/profiles.ts";
import { parseArchitecture } from "../../src/record/architecture.ts";
import { record } from "../../src/record/recorder.ts";
import type { CapturePath } from "../../src/raw/types.ts";
import { validate } from "../../src/record/validate.ts";
import { runScenario } from "../../src/run.ts";
import { logHash } from "../../src/trace.ts";
import { BASE, VALID_QUALIFICATIONS, byTime, inoculation, sampleWithRun } from "../support/cell_stream.ts";
import { readJson } from "../support/paths.ts";
import { DIALECTS, rawConfigOf, rawInputOf } from "../support/raw_run.ts";
import { SMALL, lookup } from "../support/scenarios.ts";

// Step 6: the transcription step of manual_transcription and the sample taken through both paths (spec section 5, "Capture path"; test-only values and ids). C's flags (all eight on).
// Instants are seconds of the scenario, day 0 the synthetic Monday 2030-01-07.

const C = parseArchitecture(readJson("scenarios", "architectures", "c_context.json"));
const ALLINONE = lookup("analyzer", "allinone_atline") as Profile;

// Three hand-built glucose results of an all-in-one analyzer: S1 4.2, S2 5.1, S3 6.0 g/L, drawn at 1100, 1200, 1300 by OP-1, measured 400 s after a 100 s wait
const events = byTime([...BASE, inoculation("U1"), ...sampleWithRun("S1", "U1", 1100, 100, 4.2), ...sampleWithRun("S2", "U1", 1200, 100, 5.1), ...sampleWithRun("S3", "U1", 1300, 100, 6.0)]);
const setup = (over: Partial<RawSetup> = {}): RawSetup => ({
  dialects: DIALECTS, anchor_epoch_s: anchorEpoch("2030-01-07"), zone_offset_s: 0, default_dilution: 1, export_at: () => 5000, visits: [{ dialect: "allinone_csv", analytes: ["glucose"], run_s: 270 }],
  entry: { forced: [{ kind: "value", request_id: "S2", analyte: "glucose", typed_value: 1.5 }, { kind: "unit", request_id: "S3", analyte: "glucose", typed_unit: "mmol/L" }] }, ...over,
});
const through = (path: CapturePath): { out: RawPathOutput; rows: Record<string, unknown>[]; findings: string[][] } => {
  const out = rawPath({ setup: setup(), seed: 9, architecture: C, path, events, received_at: {}, physical: physicalIds(events, events) });
  const ds = validate({ ...record({ events: out.events, sensors: [], received_at: out.received_at, qualifications: VALID_QUALIFICATIONS, capture: out.capture }, C), ...(out.tables && { raw: out.tables }) }, { hold_limit_s: 1800, entry: entryConfigFor(ALLINONE, DIALECTS) }).dataset;
  return {
    out,
    rows: ds.result.map((r) => ({ id: r.request_id, value: r.value, unit: r.unit_ucum, path: r.capture_path, entered_by: r.entered_by, raw_ref: r.raw_ref, state: r.state })),
    findings: ds.validation_finding.filter((f) => f.action !== "no-op").map((f) => [f.rule, f.target.replace("result:", "")]),
  };
};

describe("one sample through both paths (an all-in-one file of three rows, C's flags)", () => {
  let adapter: ReturnType<typeof through>;
  let manual: ReturnType<typeof through>;
  beforeAll(() => { adapter = through("adapter_ingest"); manual = through("manual_transcription"); });

  it("Given row 1 is clean (4.2 g/L) Then both paths give the same canonical value and unit", () => {
    expect([adapter.rows[0], manual.rows[0]].map((r) => [r?.value, r?.unit])).toEqual([[4.2, "g/L"], [4.2, "g/L"]]);
  });
  it("Given adapter_ingest Then row 1 has capture_path adapter_ingest, a raw_ref to the file and line, no entered_by and no finding", () => {
    expect(adapter.rows[0]).toMatchObject({ path: "adapter_ingest", entered_by: null, raw_ref: { raw_file_id: "RF1", line_no: 3 }, state: null });
    expect(adapter.findings).toEqual([]);
  });
  it("Given manual_transcription Then row 1 has capture_path manual_transcription, entered_by OP-1 (audit_trail is on), no raw_ref and no finding", () => {
    expect(manual.rows[0]).toMatchObject({ path: "manual_transcription", entered_by: "OP-1", raw_ref: null, state: null });
  });
  it("Given row 2 (5.1 g/L) with a forced digit transposition Then the typed value is 1.5 and no finding is raised, while the parsed value is the file's 5.1", () => {
    expect([manual.rows[1]?.value, adapter.rows[1]?.value]).toEqual([1.5, 5.1]);
    expect(manual.findings.filter(([, id]) => id !== "R3")).toEqual([]);
  });
  it("Given row 3 (6.0 g/L) with a forced unit slip to mmol/L Then VR-005 quarantines the typed row and keeps its value", () => {
    expect(manual.rows[2]).toMatchObject({ value: 6, unit: "mmol/L", state: "quarantined" });
    expect(manual.findings).toEqual([["VR-005", "R3"]]);
  });
  it("Given the same row 3 on adapter_ingest Then the unit comes from the entry (no units row), g/L, and the row loads with no finding", () => {
    expect(adapter.rows[2]).toMatchObject({ value: 6, unit: "g/L", state: null });
  });
  it("Given both paths Then the three files are emitted from the same draws: the same text, the same key rows and the same opportunities", () => {
    expect(manual.out.files.map((f) => f.text)).toEqual(adapter.out.files.map((f) => f.text));
    expect(manual.out.key.opportunities).toEqual(adapter.out.key.opportunities);
  });
  it("Given the forced entry errors Then the key of the manual path lists them with the intended and the typed value, and the adapter path lists none", () => {
    expect(manual.out.key.entry_errors).toEqual([
      { request_id: "S2", analyte: "glucose", kind: "value", intended: 5.1, typed: 1.5 }, { request_id: "S3", analyte: "glucose", kind: "unit", intended: "g/L", typed: "mmol/L" },
    ]);
    expect(adapter.out.key.entry_errors).toEqual([]);
  });
});

describe("the transcription step", () => {
  const input = { seed: 3, events, physical: physicalIds(events, events), unit_text: { glucose: "g/L" }, ucum_of: { "g/L": "g/L", "mmol/L": "mmol/L" }, default_dilution: 1 };
  it("Given a wrong digit is the pair of the first two digits swapped Then 5.1 is typed as 1.5, 12.5 as 21.5, 0.8 as 8 (leading 0 and 8 swap), and a one-digit value stays", () => {
    expect([transposeDigits(5.1), transposeDigits(12.5), transposeDigits(0.8), transposeDigits(6)]).toEqual([1.5, 21.5, 8, 6]);
  });
  it("Given a test-only rate of 1 When the opportunities materialise Then every row with two digits is typed transposed (4.2 as 2.4, 5.1 as 1.5) and 6.0, one digit, is typed as it was", () => {
    const t = transcribe({ ...input, rate: 1 });
    expect(t.events.filter((e): e is Extract<ObservableEvent, { type: "result_measured" }> => e.type === "result_measured").map((e) => e.value)).toEqual([2.4, 1.5, 6]);
    expect(t.applied.map((a) => [a.request_id, a.intended, a.typed])).toEqual([["S1", 4.2, 2.4], ["S2", 5.1, 1.5]]);
  });
  it("Given a test-only rate of 0 and no forced errors (a production run: no ledger rate) Then nothing is typed wrongly and the class is reported as not modelled", () => {
    const t = transcribe({ ...input, rate: 0 });
    expect(t.applied).toEqual([]);
    expect(rawPath({ setup: setup({ entry: {} }), seed: 9, architecture: C, path: "manual_transcription", events, received_at: {}, physical: physicalIds(events, events) }).key.not_modelled).toEqual(["raw_rq4_overlap", "raw_rq4_replay", "entry_value", "entry_unit", "entry_dilution"]);
  });
  it("Given the draws of the step Then they are keyed per result row with purpose error:result_entry and are the same list on both paths", () => {
    const a = rawPath({ setup: setup(), seed: 9, architecture: C, path: "adapter_ingest", events, received_at: {}, physical: physicalIds(events, events) }).key.opportunities;
    const m = rawPath({ setup: setup(), seed: 9, architecture: C, path: "manual_transcription", events, received_at: {}, physical: physicalIds(events, events) }).key.opportunities;
    expect(m).toEqual(a);
    expect(m.filter((o) => o.purpose === "error:result_entry").map((o) => o.id)).toEqual(["S1/glucose/1", "S2/glucose/1", "S3/glucose/1"]);
    expect(m.filter((o) => o.purpose === "raw:RQ4").length).toBeGreaterThan(0);
    expect(new Set(m.map((o) => o.purpose))).toEqual(new Set(["raw:RQ4", "error:result_entry"]));
  });
});

describe("the truth is the same on both paths, and the ingest metrics are shown on one side only", () => {
  let before: string;
  let after: string;
  const out = {} as Record<CapturePath, SeedOutput>;
  beforeAll(async () => {
    const small = { seed: 1, settings: SMALL };
    for (const path of ["manual_transcription", "adapter_ingest"] as const) {
      const config = rawConfigOf("default", small, { capture_path: path });
      const run = runScenario(config);
      before = await logHash(run.events);
      out[path] = runSeed(rawInputOf(run, config, `default-small-${path}`, [C], 8));
      after = await logHash(run.events);
    }
  }, 120_000);
  it("Given a truth run recorded on each path Then the truth log_hash is the same before and after both, and the keys draw the same opportunities", () => {
    expect(after).toBe(before);
    const draws = (p: CapturePath) => (JSON.parse(out[p].raw?.[C.id]?.key_text ?? "{}") as { opportunities: unknown[] }).opportunities;
    expect(draws("manual_transcription").length).toBeGreaterThan(50);
    expect(draws("manual_transcription")).toEqual(draws("adapter_ingest"));
  });
  it("Given the two paths Then the ingest metrics are 'not applicable' on manual_transcription and reported on adapter_ingest, never zero on one side and a number on the other", () => {
    expect(out.manual_transcription.raw?.[C.id]?.metrics).toEqual({ status: "not_applicable", reason: expect.stringContaining("no file is parsed") });
    // year-first stamps are never ambiguous and no repeat is switched on in the default raw-layer scenario: both classes print "none occurred", never 100 percent
    expect(out.adapter_ingest.raw?.[C.id]?.metrics).toMatchObject({ status: "reported", parse_failure: { status: "reported", num: 0 }, duplicates: { status: "none_occurred" }, ambiguous: { status: "none_occurred" } });
  });
});
