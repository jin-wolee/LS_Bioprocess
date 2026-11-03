import { describe, expect, it } from "vitest";
import { evaluationSettings } from "../../src/evaluate/config.ts";
import { seedInputFromRun } from "../../src/experiments/assembly/from_run.ts";
import { runSeed } from "../../src/experiments/assembly/run_seed.ts";
import { parseArchitecture } from "../../src/record/architecture.ts";
import { loadProfile } from "../../src/profiles.ts";
import { canonicalJson, logHash } from "../../src/trace.ts";
import { readJson } from "../support/paths.ts";
import { SMALL, lookup, runOf } from "../support/scenarios.ts";
import { makeEvalAjv, validates } from "../support/eval_schemas.ts";
import { REVIEW } from "../support/review_setup.ts";

// S2b: one truth run through the injector, three recorders, the validation rules and the evaluator (scenario default at a small size; seed 1).
// Structural relations only (00 section 2 item 8): nothing here asserts a size or an ordering of the architectures.

const run = runOf("default", { settings: SMALL });
const staff = loadProfile(lookup("staff", "experienced"), "staff").params;
const evaluation = evaluationSettings(readJson("data", "scenarios", "evaluation", "default.json"));
const architectures = ["a_manual", "b_lims_lite", "c_context"].map((n) => parseArchitecture(readJson("data", "scenarios", "architectures", `${n}.json`)));
const requests = run.events.filter((e) => e.type === "sample_drawn" || e.type === "draw_skipped_volume_budget").length;
const input = seedInputFromRun(run, { scenario_id: "default-small", staff, evaluation, architectures, days: 8, review: REVIEW });

describe("One truth run, three architectures", () => {
  const before = structuredClone(run.events);
  const hashBefore = logHash(run.events);
  const out = runSeed(input);

  it("Given the run Then the truth log is byte-identical after the injector, the recorders and the evaluator (same hash, same events)", async () => {
    expect(await logHash(run.events)).toBe(await hashBefore);
    expect(run.events).toEqual(before);
  });

  it("Then there is one cell per architecture, each with the same request count as the truth log, the refused draws included", () => {
    expect(out.cells.map((c) => c.architecture)).toEqual(["a_manual", "b_lims_lite", "c_context"]);
    expect(requests).toBeGreaterThan(30);
    for (const c of out.cells) expect(c.n_requests).toBe(requests);
  });

  it("Then the truth quantities (holding time, turnaround, utilisation) are the same in every architecture", () => {
    const [a, b, c] = out.cells.map((x) => x.metrics);
    for (const m of [b, c]) {
      expect(m?.holding_time).toEqual(a?.holding_time);
      expect(m?.turnaround).toEqual(a?.turnaround);
      expect(m?.utilisation).toEqual(a?.utilisation);
    }
  });

  it("Then every cell validates against data/schemas/metrics.schema.json and the key file against data/schemas/answer_key.schema.json", () => {
    const ajv = makeEvalAjv();
    for (const c of out.cells) expect(validates(ajv, "metrics", c), JSON.stringify(ajv.errors)).toBe(true);
    expect(validates(ajv, "answer_key", JSON.parse(out.key_text)), JSON.stringify(ajv.errors)).toBe(true);
  });

  it("Then the key lists every architecture, carries the run's seed and reports the unmodelled types, never a number for them", () => {
    const key = JSON.parse(out.key_text) as { seed: number; scenario_id: string; architectures: Record<string, { not_modelled: string[]; errors: { type: string }[] }> };
    expect([key.seed, key.scenario_id]).toEqual([1, "default-small"]);
    expect(Object.keys(key.architectures)).toEqual(["a_manual", "b_lims_lite", "c_context"]);
    for (const a of Object.values(key.architectures)) {
      expect(a.not_modelled).toEqual(["unit_rekey", "clock_offset", "duplicate_replay"]);
      expect(a.errors.map((e) => e.type)).not.toContain("unit_rekey");
    }
  });

  it("Then the same run gives the same key text and the same cells (determinism)", () => {
    const again = runSeed(input);
    expect(again.key_text).toBe(out.key_text);
    expect(canonicalJson(again.cells)).toBe(canonicalJson(out.cells));
  });

  it("Then the validation rules that have no tolerance in the ledger are listed as not evaluable in the production settings (VR-003, VR-004)", () => {
    for (const c of out.cells) expect(c.metrics.detection.not_evaluable.map((n) => n.rule)).toEqual(expect.arrayContaining(["VR-003", "VR-004"]));
  });
});

describe("Label errors at a rate of one (test-only): the flag decides where the mechanism exists", () => {
  const all = Object.fromEntries(run.operators.map((o) => [o.operator_id, 1]));
  const out = runSeed({ ...input, label_rate_by_operator: all });
  const count = (arch: string) => (JSON.parse(out.key_text) as { architectures: Record<string, { errors: { type: string }[] }> }).architectures[arch]?.errors.filter((e) => e.type === "label_error").length;
  it("Given a probability of one for every sampler Then every drawn sample of the manual architecture is mislabelled, and none where the system issues the id (B and C)", () => {
    const drawn = run.events.filter((e) => e.type === "sample_drawn").length;
    expect([count("a_manual"), count("b_lims_lite"), count("c_context")]).toEqual([drawn, 0, 0]);
  });
});
