import { describe, expect, it } from "vitest";
import { sampleRecordOf } from "../../src/experiments/assembly/lab/lineage.ts";
import type { RecordedDataset, ResultRow, RunRow } from "../../src/record/types.ts";
import { emptyDataset } from "../support/eval_fixture.ts";

// Audit A1, finding F3 (2026-11-02; simulation_spec section 2.3): a run over range at the last dilution ends `over_range_unresolved`, and every result of it has no value in the record.
// The lineage view and the plant's record panel show the record's rows, and a null there means "not stored"; a result with no value is a stored fact, so its value field says so
// (`no_value`), and the page draws it with its own words. Rows typed by hand.

const run = (attempt: number, qc_outcome: RunRow["qc_outcome"]): RunRow => ({
  run_id: `S1/${attempt}/1`, request_id: "S1", attempt, visit: 1, analyzer_name: "AN-1", instrument_id: null, instrument_state_id: null, started_at: 100 * attempt, ended_at: 100 * attempt + 50, qc_outcome,
});
const result = (attempt: number, value: number | null): ResultRow => ({
  result_id: `R${attempt}`, request_id: "S1", analyte: "lactate", version: attempt, run_id: `S1/${attempt}/1`, value, measured_at: 100 * attempt + 50, available_at: null,
  supersedes: attempt > 1 ? `R${attempt - 1}` : null, ingested_at: null, reviewed_at: null, state: null,
});

describe("F3 in the lineage view: a result with no value", () => {
  // Attempt 1 over range (value 7.5 recorded, superseded), attempt 2 over range at the last dilution: no value. The value field of R2 is null with `no_value`; R1 keeps its value.
  const ds: RecordedDataset = { ...emptyDataset({ append_only_versions: true }), run: [run(1, "over_range"), run(2, "over_range_unresolved")], result: [result(1, 7.5), result(2, null)] };
  const nodes = sampleRecordOf(ds, "S1").nodes;
  const valueOf = (id: string) => nodes.find((n) => n.id === `result:${id}`)?.fields.find((f) => f.name === "value");

  it("Given the result of an over_range_unresolved run Then its value field is null and marked no_value; the earlier version keeps its number and no mark", () => {
    expect(valueOf("R2")).toEqual({ name: "value", value: null, no_value: true });
    expect(valueOf("R1")).toEqual({ name: "value", value: 7.5 });
  });

  it("Then the run of it shows its outcome, and a column the record does not store stays a plain null", () => {
    expect(nodes.find((n) => n.id === "run:S1/2/1")?.fields.find((f) => f.name === "qc_outcome")).toEqual({ name: "qc_outcome", value: "over_range_unresolved" });
    expect(nodes.find((n) => n.id === "result:R2")?.fields.find((f) => f.name === "available_at")).toEqual({ name: "available_at", value: null });
  });
});
