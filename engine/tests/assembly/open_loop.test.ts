import { beforeAll, describe, expect, it } from "vitest";
import { inject } from "../../src/inject/inject.ts";
import { labelErrorRate } from "../../src/inject/rates.ts";
import { drawOpportunities } from "../../src/inject/opportunities.ts";
import { observeEvents } from "../../src/observe.ts";
import { runOpenLoop } from "../../src/experiments/assembly/open_loop.ts";
import type { OpenLoopResult } from "../../src/experiments/assembly/open_loop.ts";
import { seedInputFromRun } from "../../src/experiments/assembly/from_run.ts";
import { runSeed } from "../../src/experiments/assembly/run_seed.ts";
import { runScenario } from "../../src/run.ts";
import { canonicalJson, logHash } from "../../src/trace.ts";
import { SMALL, configOf } from "../support/scenarios.ts";
import { makeEvalAjv, validates } from "../support/eval_schemas.ts";
import { ELEVEN, ELEVEN_IDS, STAFF, openLoopInput } from "../support/open_loop_setup.ts";
import { REVIEW } from "../support/review_setup.ts";

// S2c2, experiment 1 (spec section 6.1): one truth run per seed, shared by A, B, C and the eight ablations of C. Structural relations only
// (00 section 2 item 8): nothing here asserts a size, a sign or an ordering of a metric. Seeds are test-only values.

const SEEDS = [11, 12];
const input = openLoopInput(SEEDS);
const truthOf = (seed: number) => runScenario({ ...input.scenario, seed });

describe("Open loop: one truth run per seed, eleven architectures", () => {
  let out: OpenLoopResult;
  beforeAll(async () => {
    out = await runOpenLoop(input);
  });

  it("Given two seeds Then the result lists the seeds in order, and per seed one cell for each of the eleven architectures in the order of the list", () => {
    expect(out.seeds).toEqual(SEEDS);
    expect(out.outcomes.map((o) => o.seed)).toEqual(SEEDS);
    for (const o of out.outcomes) {
      expect(o.cells.map((c) => c.architecture)).toEqual(ELEVEN_IDS);
      for (const c of o.cells) expect(c.seed).toBe(o.seed);
    }
  });

  it("Then every architecture of a seed sees the same number of requests as the truth log (refused draws included)", () => {
    for (const o of out.outcomes) {
      const requests = truthOf(o.seed).events.filter((e) => e.type === "sample_drawn" || e.type === "draw_skipped_volume_budget").length;
      expect(requests).toBeGreaterThan(30);
      for (const c of o.cells) expect(c.n_requests, `${c.architecture} seed ${o.seed}`).toBe(requests);
    }
  });

  it("Then every cell validates against schemas/metrics.schema.json and every key against schemas/answer_key.schema.json", () => {
    const ajv = makeEvalAjv();
    for (const o of out.outcomes) {
      for (const c of o.cells) expect(validates(ajv, "metrics", c), JSON.stringify(ajv.errors)).toBe(true);
      expect(validates(ajv, "answer_key", JSON.parse(o.key_text)), JSON.stringify(ajv.errors)).toBe(true);
    }
  });

  it("Then the same input gives the same hashes, keys and cells (determinism)", async () => {
    const again = await runOpenLoop(input);
    expect(canonicalJson(again)).toBe(canonicalJson(out));
  });

  it("Given the run is repeated with the architectures in the reverse order Then each architecture has the same cell and the same key slice (no state passes between architectures)", async () => {
    const reversed = await runOpenLoop({ ...input, architectures: [...ELEVEN].reverse() });
    for (const [i, o] of reversed.outcomes.entries()) {
      const forward = out.outcomes[i];
      expect(o.truth_log_hash).toBe(forward?.truth_log_hash);
      for (const c of o.cells) expect(canonicalJson(c), `${c.architecture} seed ${o.seed}`).toBe(canonicalJson(forward?.cells.find((x) => x.architecture === c.architecture)));
      const keys = (text: string | undefined) => (JSON.parse(text ?? "{}") as { architectures: Record<string, unknown> }).architectures;
      expect(keys(o.key_text)).toEqual(keys(forward?.key_text));
    }
  });
});

describe("Open loop: the truth log_hash is identical across all eleven architectures, for every seed", () => {
  it("Given each architecture alone Then its truth log_hash equals that of the eleven together and that of an independent run of the scenario", async () => {
    const together = await runOpenLoop(input);
    for (const [i, seed] of SEEDS.entries()) {
      const independent = await logHash(truthOf(seed).events);
      expect(together.outcomes[i]?.truth_log_hash).toBe(independent);
      for (const arch of ELEVEN) {
        const alone = await runOpenLoop({ ...input, architectures: [arch] });
        expect(alone.outcomes[i]?.truth_log_hash, `${arch.id} seed ${seed}`).toBe(independent);
      }
    }
  }, 30_000); // explicit timeout (S2d rework R1): about 2 s in a quiet run

  it("Given two different seeds Then the truth log_hash differs (the check is not a constant)", async () => {
    const [a, b] = (await runOpenLoop(input)).outcomes;
    expect(a?.truth_log_hash).not.toBe(b?.truth_log_hash);
  });
});

describe("Open loop: the error opportunities are common to all architectures", () => {
  // Test-only rate: 300 per 1000 for every sampler, so that realised label errors exist in the small run (the ledger rate A047 would give about one per seed).
  const high = { ...STAFF, label_error_per_1000: { value: 300, unit: "per 1000", ref: "A047" } };
  const rate = 0.3;

  it("Given a label error that exists only without system_issued_id Then A and C minus system_issued_id realise exactly the samples whose common draw is below the rate, with the neighbouring tube as content; the other nine realise none", async () => {
    const seed = SEEDS[0] as number;
    const drawn = truthOf(seed).events.flatMap((e) => (e.type === "sample_drawn" ? [e.sample_id] : []));
    // hand rule of the injector (spec section 5, S2b): a sample is mislabelled when u < rate; the label then reads the next draw, else the previous one
    const expected = drawn.flatMap((id, i) => {
      const u = (drawOpportunities(seed, id).find((o) => o.type === "label_error") as { u: number }).u;
      const neighbour = drawn[i + 1] ?? drawn[i - 1];
      return u < rate && neighbour !== undefined ? [{ sample_id: id, as_id: neighbour }] : [];
    });
    expect(expected.length).toBeGreaterThan(5);
    const out = await runOpenLoop(openLoopInput([seed], { staff: high }));
    const key = JSON.parse(out.outcomes[0]?.key_text ?? "{}") as { architectures: Record<string, { errors: { type: string; sample_id: string; detail: { as_id: string } }[] }> };
    const labels = (arch: string) => (key.architectures[arch]?.errors ?? []).filter((e) => e.type === "label_error").map((e) => ({ sample_id: e.sample_id, as_id: e.detail.as_id }));
    for (const id of ELEVEN_IDS) expect(labels(id), id).toEqual(id === "a_manual" || id === "c_context_minus_system_issued_id" ? expected : []);
  });
});

describe("Open loop: detection never re-draws and never re-measures", () => {
  const seed = SEEDS[0] as number;
  const run = truthOf(seed);
  const seedInput = seedInputFromRun(run, { scenario_id: "default-small", staff: STAFF, evaluation: input.evaluation, architectures: ELEVEN, days: 8, review: REVIEW });

  it("Given the pipeline ran Then the observable events, the sensors and the truth handed to it are unchanged", () => {
    const before = structuredClone({ events: seedInput.events, sensors: seedInput.sensors, truth: seedInput.truth.events });
    runSeed(seedInput);
    expect({ events: seedInput.events, sensors: seedInput.sensors, truth: seedInput.truth.events }).toEqual(before);
  });

  it("Given the pipeline ran Then the key of each architecture is what the injector alone returns for it (recording, validation and the evaluator add nothing to it)", () => {
    const key = JSON.parse(runSeed(seedInput).key_text) as { architectures: Record<string, { errors: unknown[] }> };
    const events = observeEvents(run.events);
    for (const arch of ELEVEN) {
      const alone = inject({ seed, architecture: arch, events, label_rate_by_operator: Object.fromEntries(run.operators.map((o) => [o.operator_id, labelErrorRate(STAFF)])) });
      expect(canonicalJson(key.architectures[arch.id]?.errors), arch.id).toBe(canonicalJson(alone.materialised));
    }
  });
});

describe("Open loop: the small scenario really is the default scenario at a smaller size", () => {
  it("Then the scenario id of the cells is the one of the scenario config", async () => {
    const out = await runOpenLoop(input);
    expect(out.scenario_id).toBe(configOf("default", { settings: SMALL }).scenario_id);
    expect(out.outcomes[0]?.cells[0]?.scenario_id).toBe("default");
  });
});
