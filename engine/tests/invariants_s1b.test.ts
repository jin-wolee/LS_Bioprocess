import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { Event } from "../src/generated/event.schema";
import { observe } from "../src/observe.ts";
import { runScenario } from "../src/run.ts";
import { sensorTickEvents } from "../src/sensors.ts";
import type { SensorSeries } from "../src/sensors.ts";
import { canonicalJsonl, logHash } from "../src/trace.ts";
import { ENGINE_NODE_FLAGS } from "./support/node_flags.ts";
import { ROOT } from "./support/paths.ts";
import { configOf, lookup, rawScenario } from "./support/scenarios.ts";
import { loadScenario } from "../src/scenario.ts";
import { runWorkers } from "./invariants_s1b_workers.ts";

const SEEDS = Array.from({ length: 200 }, (_, i) => i + 1);
const violations: Record<string, Map<number, string[]>> = {};

describe("I1-I10 on the default scenario, 200 seeds", () => {
  beforeAll(async () => {
    const ranges = ["001_050", "051_100", "101_150", "151_200"];
    const commands = ranges.map((range) => [
      ...ENGINE_NODE_FLAGS, join(ROOT, "engine", "tests", `invariants_s1b_seeds_${range}.ts`),
    ]);
    const outputs = await runWorkers(commands, ROOT, 840_000);
    const results = outputs.map((output) => JSON.parse(output) as Record<string, [number, string[]][]>);
    for (const result of results) {
      for (const [name, entries] of Object.entries(result)) {
        const map = violations[name] ??= new Map<number, string[]>();
        for (const [seed, errors] of entries) map.set(seed, errors);
      }
    }
  }, 900_000);

  for (const [name, title] of [
    ["I1", "no analyzer double occupancy"],
    ["I2", "conservation: runs equal visits plus reruns, one final pass per visit, and every sample ends in exactly one terminal state with the counts reconciled"],
    ["I3", "a produced result is never mutated; a rerun adds a new attempt"],
    ["I3b", "the engine does not write into its input, and a second run gives a byte-identical log (I9 in one process)"],
    ["I4", "time is monotone over the whole chain: planned, sampled, received, queued, run start, run end"],
    ["I5", "no run intersects a window (QC, maintenance and closed hours)"],
    ["I6", "queue discipline equals the policy definition, recomputed independently"],
    ["I7", "keyed-RNG independence: reruns and other samples never change a sample's draws (L2 and L3)"],
    ["I8", "observation contract over the L1, L2 and L3 events: hidden fields never reach the recorder-visible stream"],
    ["I10", "the volume budget is never exceeded"],
  ] as const) {
    it(`${name} ${title}: 200 seeds, no violation`, () => {
      const map = violations[name] as Map<number, string[]>;
      expect(map.size).toBe(SEEDS.length);
      const bad = [...map].filter(([, v]) => v.length > 0).map(([s, v]) => `seed ${s}: ${v[0]}`);
      expect(bad.slice(0, 5)).toEqual([]);
    });
  }
});

describe("I9 across two Node processes", () => {
  it.each([1, 17, 200])("seed %i: two child processes print the same log_hash, and it equals the hash computed here", async (seed) => {
    const cli = join(ROOT, "engine", "tests", "support", "scenario_hash_cli.ts");
    const run = (): string => execFileSync(process.execPath, [...ENGINE_NODE_FLAGS, cli, String(seed)], { cwd: ROOT, encoding: "utf8" }).trim();
    const first = run();
    expect(run()).toBe(first);
    expect(first).toBe(await logHash(runScenario({ ...configOf("default"), seed }).events));
  }, 120_000);

  it("a different seed gives a different hash", async () => {
    const a = await logHash(runScenario({ ...configOf("default"), seed: 1 }).events);
    const b = await logHash(runScenario({ ...configOf("default"), seed: 2 }).events);
    expect(a).not.toBe(b);
  }, 60_000);
});

describe("I10 on a profile where the cap binds", () => {
  it("Given the micro-scale profile Then the budget skips draws and the cumulative volume of drawn samples never exceeds 33 percent of 12.5 mL", () => {
    const micro = loadScenario({ ...rawScenario("default"), profiles: { bioreactor: "micro_mini_parallel", analyzer: "allinone_atline", staff: "experienced" } }, lookup);
    let skips = 0;
    for (const seed of SEEDS.slice(0, 20)) {
      const r = runScenario({ ...micro, seed });
      skips += r.events.filter((e) => e.type === "draw_skipped_volume_budget").length;
      const per = new Map<string, number>();
      for (const e of r.events) if (e.type === "sample_drawn") per.set(e.unit_id, (per.get(e.unit_id) ?? 0) + e.volume_ul);
      for (const [u, v] of per) expect(v, `${u} seed ${seed}`).toBeLessThanOrEqual(0.33 * 12500 + 1e-6);
    }
    expect(skips).toBeGreaterThan(100);
  }, 300_000);
});

describe("I11 feedback defaults to false and the truth output does not depend on any L5 stub", () => {
  it("Given a scenario without the field Then feedback is false; given feedback true Then S1 refuses (experiment 2 is S2)", () => {
    const raw = rawScenario("default");
    delete raw.feedback;
    expect(loadScenario(raw, lookup).feedback).toBe(false);
    expect(() => runScenario(loadScenario({ ...raw, feedback: true }, lookup))).toThrow(/feedback/);
  });

  it("Given an L5 stub that tries to steer and to mutate what it is shown When the scenario runs Then the stub is never consulted and the truth log is byte-identical", () => {
    const cfg = { ...configOf("default"), seed: 5 };
    let calls = 0;
    const l5 = (): unknown => (calls++, { feed: true });
    const plain = canonicalJsonl(runScenario(cfg).events);
    const withStub = canonicalJsonl(runScenario(cfg, { l5 }).events);
    expect(calls).toBe(0);
    expect(withStub).toBe(plain);
  }, 60_000);
});

describe("I8 on the sensor ticks (the L1 series that sit beside the log)", () => {
  it("Given the ticks of 20 seeds Then perturbing the hidden truth leaves the recorder-visible ticks byte-identical and the truth never appears in them", () => {
    let checked = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const r = runScenario({ ...configOf("default"), seed });
      for (const s of [r.sensors[0], r.sensors[25], r.sensors[50]]) {
        const ticks = sensorTickEvents(s as SensorSeries).slice(0, 500);
        const perturbed = ticks.map((e) => ({ ...e, true_value: (e as { true_value: number }).true_value + 1.5 }));
        const view = canonicalJsonl(observe(ticks));
        expect(canonicalJsonl(observe(perturbed as Event[])), `seed ${seed}`).toBe(view);
        expect(view.includes("true_value")).toBe(false);
        expect(view.includes('"value"')).toBe(true);
        checked++;
      }
    }
    expect(checked).toBe(60);
  }, 120_000);
});
