import { ESLint } from "eslint";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decideReadjust } from "../../src/experiments/arms/closed_loop.ts";
import type { ArmOptions } from "../../src/experiments/arms/closed_loop.ts";
import { FLAG_NAMES } from "../../src/record/architecture.ts";
import type { Architecture, FlagName } from "../../src/record/architecture.ts";
import type { RecordedDataset, ResultRow, RunRow, SampleRow } from "../../src/record/types.ts";
import { ROOT } from "../support/paths.ts";

// SC8, the decision code of arms A, B and C (spec 6.2; ruling of the orchestrator on "modelled or excluded"): the arm sees a recorded dataset and a time, nothing else.
// Hand-built record, test-only values (seconds). Each sample has one pH result:
//   S1  closed, drawn 1000, run starts 1300 (hold 300 s),  result at 1500, 7.010
//   S2  open,   drawn 2000, run starts 4400 (hold 2400 s), result at 4600, 7.050   (open container and a hold above the limit of 1800 s)
//   S3  closed, drawn 3000, run starts 3600 (hold 600 s),  result at 3900, 6.980
//   S4  closed, drawn 5000, run starts 7000 (hold 2000 s), result at 7200, 7.020   (closed, hold above the limit)
//   S5  open,   drawn 6000, run starts 6300 (hold 300 s),  result at 6500, 7.060   (open, short hold)
// A, B and C hold the same rows; they differ by their flags (A none, B system_issued_id, ingest_idempotency and audit_trail, C all eight), so only C stores sampled_at and with it a hold time.
// The limit is 1800 s (A046 as test input) and the open-sample offset the modelled variant subtracts is 0.04 (A041 as test input).

const OPTS: ArmOptions = { hold_limit_s: 1800, bias_handling: "exclude", open_offset: 0.04 };
const MODEL: ArmOptions = { ...OPTS, bias_handling: "model" };

const flags = (on: FlagName[]): Architecture["flags"] => Object.fromEntries(FLAG_NAMES.map((f) => [f, on.includes(f)])) as Architecture["flags"];
const C_FLAGS = flags([...FLAG_NAMES]);
const A_FLAGS = flags([]);
const B_FLAGS = flags(["system_issued_id", "ingest_idempotency", "audit_trail"]);

interface S { id: string; container: string | null; drawn: number; started: number; measured: number; value: number }
const SAMPLES: S[] = [
  { id: "S1", container: "closed", drawn: 1000, started: 1300, measured: 1500, value: 7.01 },
  { id: "S2", container: "open", drawn: 2000, started: 4400, measured: 4600, value: 7.05 },
  { id: "S3", container: "closed", drawn: 3000, started: 3600, measured: 3900, value: 6.98 },
  { id: "S4", container: "closed", drawn: 5000, started: 7000, measured: 7200, value: 7.02 },
  { id: "S5", container: "open", drawn: 6000, started: 6300, measured: 6500, value: 7.06 },
];

const dataset = (f: Architecture["flags"], over: { result?: (r: ResultRow) => ResultRow; extra?: ResultRow[]; container?: (c: string | null) => string | null } = {}): RecordedDataset => {
  const two = f.two_clocks;
  const sample: SampleRow[] = SAMPLES.map((s) => ({
    sample_id: s.id, unit_id: "U1", batch_id: "B-U1", keys_fixed_at_write: f.write_time_keys, state: null, sampled_at: two ? s.drawn : null, planned_at: null,
    operator_id: null, qualification_id: null, label_method: null, container: (over.container ?? ((c) => c))(s.container),
  }));
  const run: RunRow[] = SAMPLES.map((s) => ({
    run_id: `${s.id}/1/1`, request_id: s.id, attempt: 1, visit: 1, analyzer_name: "AN-1", instrument_id: null, instrument_state_id: null, started_at: s.started, ended_at: s.measured, qc_outcome: "qc_passed",
  }));
  const result: ResultRow[] = SAMPLES.map((s, i) => ({
    result_id: `R${i + 1}`, request_id: s.id, analyte: "ph", version: 1, run_id: `${s.id}/1/1`, value: s.value, measured_at: s.measured, available_at: f.available_at ? s.measured : null,
    supersedes: null, ingested_at: s.measured, reviewed_at: null, state: null,
  }));
  return {
    architecture: { id: "t", flags: f, labelling: "handwritten" }, sample, analysis_request: [], run, instrument_state: [], result: [...result.map(over.result ?? ((r) => r)), ...(over.extra ?? [])],
    audit_event: [], qualification: [], source_event: [], validation_finding: [], ingest_conflict: [], batch: [], process_event: [], historian: { series: [], late: [] },
  };
};

describe("SC8 arm decision: C excludes a value whose recorded context marks a known bias (default rule)", () => {
  const c = dataset(C_FLAGS);

  it("Given a closed container and a hold of 300 s When C decides at 1600 Then it readjusts onto the value of S1, 7.010", () => {
    expect(decideReadjust(c, 1600, -1, OPTS)).toEqual({ action: "readjust", onto: 7.01, sample_id: "S1", measured_at: 1500 });
  });

  it("Given the newest value is S2 (open container, hold 2400 s) When C decides at 4700 Then it skips the readjustment and names the sample", () => {
    expect(decideReadjust(c, 4700, -1, OPTS)).toEqual({ action: "skip", reason: "known_bias", sample_id: "S2", measured_at: 4600 });
  });

  it("Given a closed container and a hold of 2000 s, above the limit of 1800 s When C decides at 7300 Then it skips", () => {
    expect(decideReadjust(c, 7300, -1, OPTS)).toEqual({ action: "skip", reason: "known_bias", sample_id: "S4", measured_at: 7200 });
  });

  it("Given an open container and a hold of 300 s When C decides at 6600 Then it skips: container open means A041 applies, whatever the hold", () => {
    const only = dataset(C_FLAGS, { result: (r) => (r.request_id === "S5" || r.request_id === "S3" ? r : { ...r, measured_at: 99999, available_at: 99999 }) });
    expect(decideReadjust(only, 6600, -1, OPTS)).toEqual({ action: "skip", reason: "known_bias", sample_id: "S5", measured_at: 6500 });
  });

  it("Given the modelled variant When the newest value is S5 (open, hold 300 s) Then C readjusts onto 7.060 - 0.04 = 7.020", () => {
    const only = dataset(C_FLAGS, { result: (r) => (r.request_id === "S5" || r.request_id === "S3" ? r : { ...r, measured_at: 99999, available_at: 99999 }) });
    const d = decideReadjust(only, 6600, -1, MODEL);
    expect(d.action).toBe("readjust");
    if (d.action === "readjust") expect(d.onto).toBeCloseTo(7.02, 12);
  });

  it("Given the modelled variant When the newest value is S2 (open and a hold above the limit) Then C still skips: the hold bias is not modelled", () => {
    expect(decideReadjust(c, 4700, -1, MODEL)).toEqual({ action: "skip", reason: "known_bias", sample_id: "S2", measured_at: 4600 });
  });
});

describe("SC8 arm decision: one rule for every architecture, each on the fields its record holds (ruling R1)", () => {
  const archs = { A: dataset(A_FLAGS), B: dataset(B_FLAGS), C: dataset(C_FLAGS) };

  it("Given the newest value is S2, taken in an open container When A, B and C decide at 4700 Then each excludes it: the container is recorded by every architecture", () => {
    for (const [name, ds] of Object.entries(archs)) expect(decideReadjust(ds, 4700, -1, OPTS), name).toEqual({ action: "skip", reason: "known_bias", sample_id: "S2", measured_at: 4600 });
  });

  it("Given the newest value is S4, closed container, hold 2000 s above the limit of 1800 s When they decide at 7300 Then only C excludes it: A and B store no hold time and readjust onto 7.020", () => {
    expect(decideReadjust(archs.C, 7300, -1, OPTS)).toEqual({ action: "skip", reason: "known_bias", sample_id: "S4", measured_at: 7200 });
    for (const name of ["A", "B"] as const) expect(decideReadjust(archs[name], 7300, -1, OPTS), name).toEqual({ action: "readjust", onto: 7.02, sample_id: "S4", measured_at: 7200 });
  });

  it("Given a closed container and a hold within the limit (S1) Then all three readjust onto 7.010", () => {
    for (const [name, ds] of Object.entries(archs)) expect(decideReadjust(ds, 1600, -1, OPTS), name).toEqual({ action: "readjust", onto: 7.01, sample_id: "S1", measured_at: 1500 });
  });

  it("Given the modelled option and S5 (open container, hold 300 s) Then A, B and C alike subtract the open-sample offset: 7.060 - 0.04 = 7.020", () => {
    for (const [name, ds] of Object.entries(archs)) {
      const only = { ...ds, result: ds.result.filter((r) => r.request_id === "S5" || r.request_id === "S3") };
      const d = decideReadjust(only, 6600, -1, MODEL);
      expect(d.action, name).toBe("readjust");
      if (d.action === "readjust") expect(d.onto, name).toBeCloseTo(7.02, 12);
    }
  });

  it("Given the modelled option and S2 (open container) Then A and B, which hold no hold time, subtract the offset (7.050 - 0.04 = 7.010) and C, whose hold of 2400 s is above the limit, still skips", () => {
    for (const name of ["A", "B"] as const) {
      const d = decideReadjust(archs[name], 4700, -1, MODEL);
      expect(d.action, name).toBe("readjust");
      if (d.action === "readjust") expect(d.onto, name).toBeCloseTo(7.01, 12);
    }
    expect(decideReadjust(archs.C, 4700, -1, MODEL)).toEqual({ action: "skip", reason: "known_bias", sample_id: "S2", measured_at: 4600 });
  });

  it("Given a record that names no container (the plan names none) Then the container marks nothing and the arm readjusts onto the value", () => {
    const none = dataset(A_FLAGS, { container: () => null });
    expect(decideReadjust(none, 4700, -1, OPTS)).toEqual({ action: "readjust", onto: 7.05, sample_id: "S2", measured_at: 4600 });
  });
});

describe("SC8 arm decision: only recorded, existing, available pH results are read", () => {
  it("Given results measured after the decision time Then they are not read, even by an architecture that reads rows as of now", () => {
    expect(decideReadjust(dataset(A_FLAGS), 1400, -1, OPTS)).toEqual({ action: "none" });
    expect(decideReadjust(dataset(A_FLAGS), 3000, -1, OPTS)).toEqual({ action: "readjust", onto: 7.01, sample_id: "S1", measured_at: 1500 });
  });

  it("Given a result already used (since = its measured_at) Then there is nothing new and no readjustment", () => {
    expect(decideReadjust(dataset(C_FLAGS), 1600, 1500, OPTS)).toEqual({ action: "none" });
    expect(decideReadjust(dataset(C_FLAGS), 4000, 1500, OPTS)).toEqual({ action: "readjust", onto: 6.98, sample_id: "S3", measured_at: 3900 });
  });

  it("Given a rejected or held row Then it is not read", () => {
    const d = dataset(C_FLAGS, { result: (r) => (r.request_id === "S1" ? { ...r, state: "rejected" } : r) });
    expect(decideReadjust(d, 1600, -1, OPTS)).toEqual({ action: "none" });
    const h = dataset(C_FLAGS, { result: (r) => (r.request_id === "S1" ? { ...r, state: "held" } : r) });
    expect(decideReadjust(h, 1600, -1, OPTS)).toEqual({ action: "none" });
  });

  it("Given a row released at a review point after the decision time (available_at 5000) in a record with available_at Then it is read only from 5000", () => {
    const d = dataset(C_FLAGS, { result: (r) => (r.request_id === "S1" ? { ...r, state: "released", available_at: 5000 } : { ...r, measured_at: 99999, available_at: 99999 }) });
    expect(decideReadjust(d, 1600, -1, OPTS)).toEqual({ action: "none" });
    expect(decideReadjust(d, 4999, -1, OPTS)).toEqual({ action: "none" });
    expect(decideReadjust(d, 5000, -1, OPTS)).toEqual({ action: "readjust", onto: 7.01, sample_id: "S1", measured_at: 1500 });
  });

  it("Given results of other analytes Then they are ignored", () => {
    const d = dataset(C_FLAGS, { result: (r) => ({ ...r, analyte: "glucose" }) });
    expect(decideReadjust(d, 9000, -1, OPTS)).toEqual({ action: "none" });
  });

  it("Given the newest of several values Then the one with the latest measured_at is used, not the first in the table", () => {
    expect(decideReadjust(dataset(A_FLAGS), 9000, -1, OPTS)).toEqual({ action: "readjust", onto: 7.02, sample_id: "S4", measured_at: 7200 });
  });
});

describe("SC8 arms zone: the decision code reads recorded data only (eslint zone 3)", () => {
  const dir = join(ROOT, "engine/src/experiments/arms");
  const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
  const messages = async (code: string, file: string): Promise<string[]> => {
    const [result] = await new ESLint({ cwd: ROOT }).lintText(code, { filePath: `${dir}/${file}` });
    return (result?.messages ?? []).filter((m) => m.ruleId === "no-restricted-imports").map((m) => m.message);
  };

  it("Given the files of experiments/arms Then each lints clean of restricted imports", async () => {
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) expect(await messages(readFileSync(`${dir}/${f}`, "utf8"), f), f).toEqual([]);
  });

  it("Given a planted import of a truth module, of the oracle or of the answer key in an arm file Then the zone refuses each", async () => {
    for (const spec of ["../../sampling.ts", "../../stability.ts", "../../process.ts", "../oracle/closed_loop.ts", "../assembly/closed_loop.ts", "../../evaluate/answer_key.ts"]) {
      const found = await messages(`import * as planted from "${spec}";\nexport const x = planted;\n`, "planted.ts");
      expect(found.length, spec).toBeGreaterThanOrEqual(1);
    }
  });
});
