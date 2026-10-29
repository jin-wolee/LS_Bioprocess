import { beforeAll, describe, expect, it } from "vitest";
import { runSeed } from "../src/experiments/assembly/run_seed.ts";
import type { SeedOutput } from "../src/experiments/assembly/run_seed.ts";
import { contextAsOf } from "../src/record/asof.ts";
import type { ScenarioRun } from "../src/run.ts";
import { CONFIGS } from "./support/cells.ts";
import { eventsOf, inputOf, keyErrors, mixedUp } from "./support/sc_run.ts";
import { runOf } from "./support/scenarios.ts";

// SC3 Feed in the gap (spec 7, 6.1): which timestamp should the join use? scenarios/sc03_feed_in_gap.json scripts a bolus feed at 09:00 (A102) on twelve
// reactors on days 3 and 4 while the routine decision stays at 10:00 (A050, A194). Structural relations only (prompts/20 Step 4): the count of samples with a
// feed in the gap equals a count made independently from the truth log; the architecture that joins by the measured time attaches post-feed context to
// exactly those samples; the one that joins by the draw time with keys fixed at write attaches none. Nothing is asserted about how many samples there are.
//
// The gap here runs from the draw to the first measurement (draw < feed <= measured_at), as in spec 6.1 ("between draw and measurement"): a feed during the
// 270 s run itself changes the joined context as well, so an interval that stopped at run.started_at (prompts/20 Step 4) would miss it. The narrower
// interval is counted too, in the last test, as a subset.

const A = CONFIGS[0];
const C = CONFIGS[2];

interface Fact {
  sample: string;
  unit: string;
  batch: string;
  drawn: number;
  started: number;
  measured: number;
  /** Feeds of the sample's batch at or before the draw, and at or before the measurement (truth log). */
  epoch_at_draw: number;
  epoch_at_measurement: number;
  /** A feed of the batch with draw < t <= measurement. */
  feed_in_gap: boolean;
  /** A feed of the batch with draw <= t <= run start (the interval of prompts/20 Step 4). */
  feed_before_run: boolean;
  rerun: boolean;
}

/** Facts from the truth log alone: no recorder, no injector, no evaluator. */
const factsOf = (run: ScenarioRun): Fact[] => {
  const feeds = eventsOf(run, "process_event").filter((e) => e.kind === "feed");
  const rerun = new Set(eventsOf(run, "rerun_requested").map((e) => e.request_id));
  const first = <T extends { request_id: string; t: number }>(events: T[]): Map<string, number> => {
    const m = new Map<string, number>();
    for (const e of events) if (!m.has(e.request_id) || e.t < (m.get(e.request_id) as number)) m.set(e.request_id, e.t);
    return m;
  };
  const measured = first(eventsOf(run, "result_measured"));
  const started = first(eventsOf(run, "run_started"));
  return eventsOf(run, "sample_drawn").flatMap((d) => {
    const m = measured.get(d.sample_id);
    const s = started.get(d.sample_id);
    if (m === undefined || s === undefined) return [];
    const own = feeds.filter((f) => f.unit_id === d.unit_id && f.batch_id === d.batch_id).map((f) => f.t);
    return [{
      sample: d.sample_id, unit: d.unit_id, batch: d.batch_id, drawn: d.t, started: s, measured: m,
      epoch_at_draw: own.filter((t) => t <= d.t).length, epoch_at_measurement: own.filter((t) => t <= m).length,
      feed_in_gap: own.some((t) => t > d.t && t <= m), feed_before_run: own.some((t) => t >= d.t && t <= s), rerun: rerun.has(d.sample_id),
    }];
  });
};

describe("SC3 feed in the gap", () => {
  let facts: Fact[];
  let out: SeedOutput;
  const key = (arch: string) => keyErrors(out.key_text, arch);
  /** The context of a sample's first stored result, joined as the architecture joins; samples that were rerun (a rerun moves the measured time) or mislabelled are left out. */
  const contexts = (arch: string) => {
    const ds = out.datasets[arch];
    const skip = mixedUp(out.key_text, arch);
    return facts.filter((f) => !f.rerun && !skip.has(f.sample)).flatMap((f) => {
      const row = ds?.result.find((r) => r.request_id === f.sample);
      const ctx = ds && row ? contextAsOf(ds, row, Number.MAX_SAFE_INTEGER) : null;
      return ctx ? [{ fact: f, ctx }] : [];
    });
  };

  beforeAll(() => {
    const run = runOf("sc03_feed_in_gap", { seed: 1 });
    facts = factsOf(run);
    out = runSeed(inputOf(run, "sc03_feed_in_gap", [(A as (typeof CONFIGS)[number]).config, (C as (typeof CONFIGS)[number]).config], 21));
  }, 120_000);

  it("Given the scripted feeds When the truth log is scanned Then some samples have a feed between draw and measurement and most do not", () => {
    const gap = facts.filter((f) => f.feed_in_gap).length;
    expect(gap).toBeGreaterThan(0);
    expect(gap).toBeLessThan(facts.length);
  });

  it("Then the injector's count of feed-in-the-gap errors for A equals the count made from the truth log, sample by sample", () => {
    const fromKey = key("a_manual").filter((e) => e.type === "feed_in_gap").map((e) => e.sample_id).sort();
    expect(fromKey).toEqual(facts.filter((f) => f.feed_in_gap).map((f) => f.sample).sort());
  });

  it("Then C, which stores sampled_at, has no feed-in-the-gap error at all (the join uses the draw time)", () => {
    expect(key("c_context").filter((e) => e.type === "feed_in_gap")).toEqual([]);
  });

  it("When A joins by measured_at Then post-feed context (a feed epoch above the epoch at the draw) is attached to exactly the samples with a feed in the gap", () => {
    const rows = contexts("a_manual");
    expect(rows.length).toBeGreaterThan(100);
    expect(rows.every((r) => r.ctx.join_basis === "measured_at" && r.ctx.join_time === r.fact.measured)).toBe(true);
    expect(rows.filter((r) => r.ctx.feed_epoch > r.fact.epoch_at_draw).map((r) => r.fact.sample).sort()).toEqual(rows.filter((r) => r.fact.feed_in_gap).map((r) => r.fact.sample).sort());
    expect(rows.every((r) => r.ctx.feed_epoch === r.fact.epoch_at_measurement)).toBe(true);
  });

  it("When C joins by sampled_at with keys fixed at write Then no sample gets post-feed context: every feed epoch is the epoch at the draw", () => {
    const rows = contexts("c_context");
    expect(rows.length).toBeGreaterThan(100);
    expect(rows.every((r) => r.ctx.join_basis === "sampled_at" && r.ctx.join_time === r.fact.drawn)).toBe(true);
    expect(rows.filter((r) => r.ctx.feed_epoch > r.fact.epoch_at_draw)).toEqual([]);
    expect(rows.every((r) => r.ctx.feed_epoch === r.fact.epoch_at_draw)).toBe(true);
  });

  it("Then the narrower interval of the brief (draw to run start) adds no sample whose context changes: what it counts beyond the gap is a feed at the draw instant, which both epochs include", () => {
    const outside = facts.filter((f) => f.feed_before_run && !f.feed_in_gap);
    expect(outside.every((f) => f.epoch_at_draw === f.epoch_at_measurement)).toBe(true);
  });
});
