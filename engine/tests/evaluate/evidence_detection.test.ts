import { describe, expect, it } from "vitest";
import { parseKey } from "../../src/evaluate/answer_key.ts";
import { detection } from "../../src/evaluate/detection.ts";
import { EVIDENCE_OF } from "../../src/evaluate/evidence_flags.ts";
import { keyFile } from "../../src/experiments/assembly/key_file.ts";
import { runSeed } from "../../src/experiments/assembly/run_seed.ts";
import type { Metrics } from "../../src/generated/metrics.schema";
import type { MaterialisedError } from "../../src/inject/types.ts";
import { A, B, C, WORLD, emptyDataset, seedInput } from "../support/eval_fixture.ts";
import { makeEvalAjv, validates } from "../support/eval_schemas.ts";

// S2c2, item 3: detection counts the non-rule detections of the matrix by their evidence name (data_model section 7, "Evidence checks"; spec section 5,
// "Notes from S2c1") under the orchestrator ruling of 2026-10-29: evidence raises no alarm, so an evidence detector has a recall (the share of realised
// errors whose request carries the evidence) and no precision and no false-alarm rate: those two read "not applicable", never a number.
// The hand world is that of eval_fixture.ts. Its four requests: S1, S2 (a rerun: attempt 1 read 3.2 and failed QC, attempt 2 read 3.4), S3, and S4 (a draw refused
// by the volume budget). Architecture A has no flag, B has system_issued_id, ingest_idempotency and audit_trail, C has all eight. Expected values are typed by hand.
//   Lost rerun on S2: realised in A and in B (the rerun overwrites, append_only_versions is off), prevented in C. The evidence is the audit event of the result key,
//   which needs audit_trail: A cannot show it, B shows it, C keeps an audit event for the rerun too (every change is audited), but nothing is lost there.

const out = runSeed(seedInput({ architectures: [A, B, C] }));
const [mA, mB, mC] = out.cells.map((c) => c.metrics) as [Metrics["metrics"], Metrics["metrics"], Metrics["metrics"]];
const r = (num: number, den: number) => expect.objectContaining({ num, den, value: den === 0 ? null : num / den });
const NA = "not applicable";

describe("Lost rerun is shown by the audit event (evidence audit_event, flag audit_trail)", () => {
  it("Given A (no audit trail) Then the type is not evaluable, naming the evidence and the flag it needs; 1 realised, nothing counted by detector", () => {
    const d = mA.detection.by_type.lost_rerun;
    expect(d).toMatchObject({ evaluable: false, realised: 1, recall: r(0, 1), precision: NA, false_alarm: NA, by_detector: {} });
    expect(d.reason).toMatch(/audit_event/);
    expect(d.reason).toMatch(/audit_trail/);
  });

  it("Given B (overwrite, audit trail) Then the audit event of S2 shows the realised lost rerun: recall 1 of 1, counted under audit_event; precision and false alarm are not applicable", () => {
    expect(mB.detection.by_type.lost_rerun).toMatchObject({ evaluable: true, reason: null, realised: 1, recall: r(1, 1), precision: NA, false_alarm: NA, by_detector: { audit_event: 1 } });
  });

  it("Given C (versions kept, audit trail) Then nothing is lost: recall has no denominator, the audit event of the ordinary rerun is not counted anywhere, and there is no false alarm to report", () => {
    expect(mC.detection.by_type.lost_rerun).toMatchObject({ evaluable: true, reason: null, realised: 0, recall: r(0, 0), precision: NA, false_alarm: NA, by_detector: { audit_event: 0 } });
  });

  it("Given a key with a lost rerun on S2 and an architecture with audit_trail on but no audit event Then it is evaluable and the recall is 0 of 1: it looked and found nothing", () => {
    const lost: MaterialisedError = { type: "lost_rerun", sample_id: "S2", detail: { attempts: 2 } };
    const key = parseKey(keyFile({ engine_version: "t", scenario_id: "hand", seed: 7 }, { T: { materialised: [lost], not_modelled: [] } }), "T");
    const ds = emptyDataset({ audit_trail: true });
    expect(detection(WORLD, ds, key, []).by_type.lost_rerun).toMatchObject({ evaluable: true, realised: 1, recall: r(0, 1), precision: NA, false_alarm: NA, by_detector: { audit_event: 0 } });
  });

  it("Given the registry Then the audit event is the evidence of lost_rerun and needs the flag audit_trail; no other type has a named evidence", () => {
    expect(Object.keys(EVIDENCE_OF)).toEqual(["lost_rerun"]);
    expect(EVIDENCE_OF.lost_rerun?.map((e) => [e.name, e.needs])).toEqual([["audit_event", "audit_trail"]]);
  });
});

describe("By detector: the rules and the evidence that could run are counted by name", () => {
  it("Given C Then both rules of the label error could run and flagged nothing: VR-009 and VR-014 at 0; VR-010 flagged the S2 rerun once", () => {
    expect(mC.detection.by_type.label_error.by_detector).toEqual({ "VR-009": 0, "VR-014": 0 });
    expect(mC.detection.by_type.feed_in_gap.by_detector).toEqual({ "VR-010": 1 });
  });

  it("Given B Then only VR-014 could run for the label error (VR-009 needs two_clocks); the rule that could not run is not listed with a zero", () => {
    expect(mB.detection.by_type.label_error.by_detector).toEqual({ "VR-014": 0 });
  });

  it("Given A Then no rule of the label error and none of the feed in the gap could run: nothing is listed", () => {
    expect(mA.detection.by_type.label_error.by_detector).toEqual({});
    expect(mA.detection.by_type.feed_in_gap.by_detector).toEqual({});
  });

  it("Given a rule type Then precision and false alarm stay numbers with their denominators (only an evidence detector reads not applicable)", () => {
    expect(mC.detection.by_type.feed_in_gap).toMatchObject({ precision: r(0, 1), false_alarm: r(1, 4) });
  });

  it("Given a type with no rule and no evidence (planned-versus-actual time) Then it stays not evaluable, with the reason that no detector exists", () => {
    const d = mC.detection.by_type.planned_vs_actual;
    expect(d).toMatchObject({ evaluable: false, by_detector: {} });
    expect(d.reason).toMatch(/no rule or evidence/);
  });
});

describe("The metrics schema carries the ruling", () => {
  const ajv = makeEvalAjv();
  it("Then every cell validates against schemas/metrics.schema.json", () => {
    for (const c of out.cells) expect(validates(ajv, "metrics", c), JSON.stringify(ajv.errors)).toBe(true);
  });

  it("Then a number for the precision or the false-alarm rate of the lost rerun is refused, and so is a missing by_detector", () => {
    const withNumber = structuredClone(out.cells[1] as Metrics);
    (withNumber.metrics.detection.by_type.lost_rerun as unknown as Record<string, unknown>).precision = { num: 0, den: 1, denominator: "raised flags of the type", value: 0 };
    expect(validates(ajv, "metrics", withNumber)).toBe(false);
    const noDetector = structuredClone(out.cells[1] as Metrics);
    delete (noDetector.metrics.detection.by_type.feed_in_gap as unknown as Record<string, unknown>).by_detector;
    expect(validates(ajv, "metrics", noDetector)).toBe(false);
  });
});
