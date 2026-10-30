import { describe, expect, it } from "vitest";
import { parseKey } from "../../src/evaluate/answer_key.ts";
import { detection } from "../../src/evaluate/detection.ts";
import { keyFile } from "../../src/experiments/assembly/key_file.ts";
import type { ObservableEvent, ObservableSensorSeries } from "../../src/observe.ts";
import { tagSeries } from "../../src/raw/controller_series.ts";
import { requestOfTarget } from "../../src/record/validate.ts";
import type { ValidationFindingRow } from "../../src/record/types.ts";
import { casesOf, runCase } from "../support/raw_fixtures.ts";
import { controllerCases, runControllerCase } from "../support/controller_fixtures.ts";
import { WORLD, emptyDataset } from "../support/eval_fixture.ts";

// S2f F8: three latent defects on the controller side. Hand-typed streams, fixtures and findings (test-only values).

describe("S2f F8a: a unit with a second temperature shift makes the logger fail", () => {
  const sensors = (unit: string): ObservableSensorSeries => ({ unit_id: unit, signal: "temperature", t0_s: 28800, cadence_s: 60, n: 3, pv: [37, 37, 33] });
  const shift = (unit: string, t: number, amount: number): ObservableEvent => ({ type: "process_event", t, unit_id: unit, batch_id: `B-${unit}`, kind: "temperature_shift", source: "scheduled", amount, amount_unit: "C" });
  const SP = { pH: 7, DO: 30, temperature: 37 };

  it("Given two shifts on U01 (to 33 C and later to 31 C) When the series are built Then it fails, naming the unit and both instants, and no set point is guessed", () => {
    expect(() => tagSeries([sensors("U01")], [shift("U01", 28920, 33), shift("U01", 29000, 31)], SP)).toThrow(/U01.*second temperature shift.*28920.*29000/);
  });
  it("Given one shift on each of two units Then both set points follow their own shift (each unit has one batch)", () => {
    const sp = tagSeries([sensors("U01"), sensors("U02")], [shift("U01", 28920, 33), shift("U02", 28860, 35)], SP).filter((s) => s.role === "SP");
    expect(sp.map((s) => [s.unit, [0, 1, 2].map((j) => s.at(j))])).toEqual([["U01", [37, 37, 33]], ["U02", [37, 35, 35]]]);
  });
  it("Given the second shift is on a unit whose sensors this call does not log (another bay) Then it fails too: the stream breaks the one-batch-per-unit rule wherever the unit sits", () => {
    expect(() => tagSeries([sensors("U01")], [shift("U01", 28920, 33), shift("U02", 28860, 35), shift("U02", 29000, 31)], SP)).toThrow(/U02.*second temperature shift/);
  });
});

describe("S2f F8b: a replayed controller file whose stamps are unresolved is a no-op, as on the analyzer side", () => {
  // the second family writes local wall-clock text; an entry with no zone leaves every stamp unresolved (VR-024, RQ1). The fixture has three data rows.
  const unresolved = controllerCases("ctrl_bench", "process").find((c) => /without a zone/.test(c.name));
  if (!unresolved) throw new Error("no unresolved-stamp case in ctrl_bench/process");
  const twice = (flags: { ingest_idempotency: boolean }) => runControllerCase("ctrl_bench", "process", { ...unresolved, after: ["process"], flags });
  const states = (o: { raw_records: { state: string; rule_id: string | null }[] }) => o.raw_records.map((r) => [r.state, r.rule_id]);

  it("Given the file is parsed once with ingest_idempotency on Then every row is quarantined (VR-024), as before", () => {
    const once = runControllerCase("ctrl_bench", "process", { ...unresolved, flags: { ingest_idempotency: true } });
    expect(states(once.last)).toEqual([["quarantined", "VR-024"], ["quarantined", "VR-024"], ["quarantined", "VR-024"]]);
  });
  it("Given the same file arrives again with ingest_idempotency on Then every row of the copy is a no-op (VR-008) and no VR-024 finding is raised again", () => {
    const { outputs, last } = twice({ ingest_idempotency: true });
    expect(states(last)).toEqual([["no_op", "VR-008"], ["no_op", "VR-008"], ["no_op", "VR-008"]]);
    expect(outputs[0]?.findings.map((f) => f.rule)).toEqual(["VR-024", "VR-024", "VR-024"]);
    expect(last.findings.map((f) => [f.rule, f.action, f.status])).toEqual([["VR-008", "no-op", "resolved"], ["VR-008", "no-op", "resolved"], ["VR-008", "no-op", "resolved"]]);
  });
  it("Given the same replay with ingest_idempotency off Then every copy is quarantined again (no keys: a replay is more rows)", () => {
    expect(states(twice({ ingest_idempotency: false }).last)).toEqual([["quarantined", "VR-024"], ["quarantined", "VR-024"], ["quarantined", "VR-024"]]);
  });
  it("Given the analyzer side in the same case (an entry with no zone, the same file twice, ingest_idempotency on) Then its copy is a no-op too: the two sides agree", () => {
    const c = casesOf("allinone_csv", "clean").find((x) => /without a zone/.test(x.name));
    if (!c) throw new Error("no unresolved-stamp case in allinone_csv/clean");
    const { last } = runCase("allinone_csv", "clean", { ...c, after: ["clean"] });
    expect(last.raw_records.map((r) => [r.state, r.rule_id])).toEqual([["no_op", "VR-008"], ["no_op", "VR-008"], ["no_op", "VR-008"]]);
  });
});

describe("S2f F8c: a finding on a controller source event is no flag of a request-level error type", () => {
  const finding = (rule: string, target: string): ValidationFindingRow => ({ rule, target, severity: "error", action: "quarantine", status: "open" });
  const NONE = parseKey(keyFile({ engine_version: "t", scenario_id: "hand", seed: 7 }, { T: { materialised: [], not_modelled: [] } }), "T");
  const score = (target: string) => detection(WORLD, { ...emptyDataset({ ingest_idempotency: true }), validation_finding: [finding("VR-008b", target)] }, NONE, []).by_type.duplicate_replay;
  const r = (num: number, den: number) => expect.objectContaining({ num, den, value: den === 0 ? null : num / den });

  it.each([
    "source_event:U01.pH.PV|2030-01-07T08:00:00+00:00",
    "source_event:U01|pH Hi/Lo|unacknowledged|2030-01-07 09:00:00",
    "source_event:AN-1|07/01/2030 09:10:00|U01-D01-1|glucose",
  ])("Given a VR-008b finding on %s Then it resolves to no request", (target) => {
    expect(requestOfTarget(emptyDataset({ ingest_idempotency: true }), target)).toBeNull();
  });
  it("Given an analyzer source event, analyzer/request/attempt/visit/analyte Then the request is its second part", () => {
    expect(requestOfTarget(emptyDataset(), "source_event:AN-1/S4/2/1/glucose")).toBe("S4");
  });
  it("Given one VR-008b finding on a controller tag and a stamp, and no realised duplicate Then no flag is raised: nothing is counted for the rule, the precision has no denominator (not a 0 of 1) and the false-alarm rate is 0 of 4", () => {
    expect(score("source_event:U01.pH.PV|2030-01-07T08:00:00+00:00")).toMatchObject({ by_detector: { "VR-008b": 0 }, precision: r(0, 0), false_alarm: r(0, 4) });
  });
  it("Given the same finding on an analyzer source event of the clean request S1 Then it is a flag: counted for the rule, precision 0 of 1, false alarm 1 of 4", () => {
    expect(score("source_event:AN-1/S1/1/1/glucose")).toMatchObject({ by_detector: { "VR-008b": 1 }, precision: r(0, 1), false_alarm: r(1, 4) });
  });
});
