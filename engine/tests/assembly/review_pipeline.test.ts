import { describe, expect, it } from "vitest";
import { NOW } from "../../src/evaluate/query.ts";
import { rosterOf } from "../../src/experiments/assembly/from_run.ts";
import { runSeed } from "../../src/experiments/assembly/run_seed.ts";
import { resultsAsOf } from "../../src/record/asof.ts";
import type { RecordedDataset } from "../../src/record/types.ts";
import { A, B, C, seedInput } from "../support/eval_fixture.ts";
import { REVIEW, ROSTER } from "../support/review_setup.ts";
import { configOf } from "../support/scenarios.ts";

// The review inside the assembly (data_model section 7, "Review step and VR-012"): record, validate, review, evaluate. The hand world of eval_fixture.ts: the first run of S2
// fails QC (3.2, held 1000 s) and its rerun (3.4) waited 3500 s against a 1800 s limit; every stamp is before 08:00 of day 0, so a held row is reviewed at 28800.

describe("The roster comes from the scenario, not from a constant of the engine", () => {
  it("Given the default scenario Then rosterOf gives the numbers of A201 typed by hand: 08:00, 13:00, 18:00 on weekdays and 14:00 on a weekend", () => {
    expect(rosterOf(configOf("default").sampling)).toEqual(ROSTER);
  });
});

describe("The pipeline of one seed ends in the review", () => {
  const out = runSeed(seedInput({ architectures: [A, B, C] }));
  const rowsOf = (id: string, request: string) => (out.datasets[id] as RecordedDataset).result.filter((r) => r.request_id === request);
  it("Given C Then both attempts of S2 are rejected (failed QC; hold time above the limit), reviewed at Monday 08:00, values kept", () => {
    expect(rowsOf("C", "S2").map((r) => [r.version, r.state, r.value, r.reviewed_at])).toEqual([[1, "rejected", 3.2, 28800], [2, "rejected", 3.4, 28800]]);
  });
  it("Given A (no flags) Then the rerun overwrote the failed attempt and nothing of S2 is held: VR-010 needs two_clocks", () => {
    expect(rowsOf("A", "S2").map((r) => [r.state, r.value, r.reviewed_at])).toEqual([[null, 3.4, null]]);
  });
  it("Given B (no versions: system_issued_id, ingest_idempotency, audit_trail) Then, as in A, the rerun overwrote the failed attempt and nothing of S2 is held", () => {
    expect(rowsOf("B", "S2").map((r) => [r.version, r.state, r.value])).toEqual([[1, null, 3.4]]);
  });
  it("Given C minus two_clocks (versions on, no VR-010) Then the failed first attempt is rejected and the rerun stands", () => {
    const noClocks = { ...C, id: "C_no_clocks", flags: { ...C.flags, two_clocks: false } };
    const run = runSeed(seedInput({ architectures: [noClocks] }));
    expect((run.datasets.C_no_clocks as RecordedDataset).result.filter((r) => r.request_id === "S2").map((r) => [r.version, r.state, r.value])).toEqual([[1, "rejected", 3.2], [2, null, 3.4]]);
  });
  it("Given the read at the end of the run Then C shows no result for S2, B shows its rerun, A shows its overwritten row", () => {
    const shown = (id: string) => resultsAsOf(out.datasets[id] as RecordedDataset, NOW).filter((r) => r.request_id === "S2").map((r) => r.value);
    expect(shown("C")).toEqual([]);
    expect(shown("B")).toEqual([3.4]);
    expect(shown("A")).toEqual([3.4]);
  });
  it("Given the same input again Then the output is identical: the review is deterministic", () => {
    const again = runSeed(seedInput({ architectures: [A, B, C] }));
    expect(again.key_text).toBe(out.key_text);
    expect(again.cells).toEqual(out.cells);
  });
});

describe("The review settings are an input of the seed", () => {
  it("Given the next day as the review timing Then a held row of C is reviewed on Tuesday 08:00 (115200) and the outcome is the same", () => {
    const out = runSeed(seedInput({ architectures: [C], review: { ...REVIEW, timing: "next_day_start" } }));
    expect(out.datasets.C?.result.filter((r) => r.request_id === "S2").map((r) => [r.state, r.reviewed_at])).toEqual([["rejected", 115200], ["rejected", 115200]]);
  });
});
