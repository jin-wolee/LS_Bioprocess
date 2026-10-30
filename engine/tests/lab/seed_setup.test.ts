import { describe, expect, it } from "vitest";
import { runSeed } from "../../src/experiments/assembly/run_seed.ts";
import { architecturesNamed, comparedWith, labSeed, materialisedOf } from "../../src/experiments/assembly/lab/seed_setup.ts";
import type { RunSpec } from "../../src/experiments/assembly/lab/spec.ts";
import type { ForcedError } from "../../src/inject/types.ts";
import { labData } from "../support/lab_data.ts";
import { keyErrors } from "../support/sc_run.ts";
import { SMALL } from "../support/scenarios.ts";

// S3e: the set-up of one seed that the lineage view and the challenge share (lab/seed_setup.ts). The injector's realised list that the lab reads (`materialisedOf`) must be the list the answer
// key is written from, whose JSON `runSeed` returns: the two are compared here, with production rates and with a forced error. The records the reveal compares are A, B and C in order, then the
// shown ablation.

const data = labData();
const spec: RunSpec = { schema_version: "1", scenario: "default", settings: SMALL, architectures: [], seeds: [41] };
const ids = ["a_manual", "b_lims_lite", "c_context", "c_context_minus_system_issued_id"];

describe("materialisedOf", () => {
  it("Given production rates Then the list of each architecture equals the errors of the answer key that runSeed wrote", () => {
    const { input } = labSeed(data, spec, 41, architecturesNamed(data, ids));
    const out = runSeed(input);
    const mine = materialisedOf(input);
    for (const id of ids) expect(mine[id], id).toEqual(keyErrors(out.key_text, id));
    expect(Object.keys(mine)).toEqual(ids);
  }, 60_000);

  it("Given a forced error Then the list of each architecture still equals the key, and the error is in the architectures that do not prevent it", () => {
    const { input, run } = labSeed(data, spec, 41, architecturesNamed(data, ids));
    const drawn = run.events.flatMap((e) => (e.type === "sample_drawn" ? [e.sample_id] : []));
    const plant: ForcedError = { type: "label_error", sample_id: drawn[1] as string, detail: { as_id: drawn[2] as string } };
    const forced = { ...input, forced: [plant] };
    const out = runSeed(forced);
    const mine = materialisedOf(forced);
    for (const id of ids) expect(mine[id], id).toEqual(keyErrors(out.key_text, id));
    const has = (id: string): boolean => (mine[id] ?? []).some((m) => m.type === "label_error" && m.sample_id === plant.sample_id);
    expect(ids.map(has)).toEqual([true, false, false, true]); // system_issued_id prevents it in B and C
  }, 60_000);
});

describe("comparedWith", () => {
  it("Given a preset Then the records compared are A, B and C", () => {
    expect(comparedWith(data, "b_lims_lite").map((a) => a.id)).toEqual(["a_manual", "b_lims_lite", "c_context"]);
  });

  it("Given an ablation of C Then the three presets and then that ablation", () => {
    expect(comparedWith(data, "c_context_minus_audit_trail").map((a) => a.id)).toEqual(["a_manual", "b_lims_lite", "c_context", "c_context_minus_audit_trail"]);
  });
});
