import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runL3 } from "../src/analysis.ts";
import type { L3Output } from "../src/analysis.ts";
import { observe } from "../src/observe.ts";
import { canonicalJsonl, logHash } from "../src/trace.ts";
import { ENGINE_NODE_FLAGS } from "./support/node_flags.ts";
import { ROOT, readJson } from "./support/paths.ts";
import type { Json } from "./support/schemas.ts";
import { makeWorkload } from "./support/workload.ts";

// Invariants I1-I9 over generated workloads (prompts/10 Step 6). 250 seeds each (the brief asks for at least 200).
// The workload ranges are test-only inputs. Each check is recomputed here from the log and the input, not from engine internals.

type Ev = Record<string, number | string>;
const SEEDS = Array.from({ length: 250 }, (_, i) => i + 1);
const cases = SEEDS.map((seed) => {
  const input = makeWorkload(seed);
  return { seed, input, out: runL3(structuredClone(input)) };
});
const evs = (out: L3Output, type: string): Ev[] => (out.events as unknown as Ev[]).filter((e) => e.type === type);
const key = (e: { request_id?: unknown; attempt?: unknown; visit?: unknown }): string => `${String(e.request_id)}#${String(e.attempt)}#${String(e.visit)}`;
const num = (v: unknown): number => Number(v);

const deepFreeze = <T>(o: T): T => {
  if (o && typeof o === "object") {
    Object.values(o).forEach(deepFreeze);
    Object.freeze(o);
  }
  return o;
};

describe("Workloads are non-trivial (guards against vacuous invariant loops)", () => {
  it("across the seeds there are reruns, windows, setups, multi-visit routes, edf and fifo", () => {
    const all = cases.flatMap((c) => c.out.events as unknown as Ev[]);
    expect(all.filter((e) => e.type === "rerun_requested").length).toBeGreaterThan(50);
    expect(all.filter((e) => e.type === "dilution_applied").length).toBeGreaterThan(10);
    expect(all.filter((e) => e.type === "qc_window_started" || e.type === "maintenance_started").length).toBeGreaterThan(100);
    expect(cases.flatMap((c) => c.out.runs).filter((r) => num(r.setup_s) > 0).length).toBeGreaterThan(100);
    expect(cases.flatMap((c) => c.input.requests).filter((r) => r.visits.length > 1).length).toBeGreaterThan(100);
    expect(new Set(cases.map((c) => c.input.policy))).toEqual(new Set(["fifo", "edf"]));
  });
});

describe("I1 no analyzer double occupancy", () => {
  it.each(SEEDS)("seed %i", (seed) => {
    const { out } = cases[seed - 1] as (typeof cases)[number];
    const by = new Map<string, [number, number][]>();
    for (const r of out.runs) by.set(String(r.analyzer), [...(by.get(String(r.analyzer)) ?? []), [num(r.start_s) - num(r.setup_s), num(r.end_s)]]);
    for (const [a, iv] of by) {
      iv.sort((x, y) => x[0] - y[0]);
      for (let i = 1; i < iv.length; i++) expect((iv[i] as [number, number])[0], `${a} overlap`).toBeGreaterThanOrEqual((iv[i - 1] as [number, number])[1]);
    }
  });
});

describe("I2 request conservation", () => {
  it.each(SEEDS)("seed %i", (seed) => {
    const { input, out } = cases[seed - 1] as (typeof cases)[number];
    const reruns = evs(out, "rerun_requested").length;
    const visits = input.requests.reduce((n, r) => n + r.visits.length, 0);
    expect(out.runs.length).toBe(visits + reruns);
    expect(evs(out, "qc_result").length).toBe(out.runs.length);
    expect(evs(out, "result_measured").length).toBe(out.runs.length);
    expect(evs(out, "visit_finished").length).toBe(out.runs.length);
    for (const r of input.requests) {
      r.visits.forEach((_, v) => {
        const runs = out.runs.filter((x) => x.request_id === r.request_id && x.visit === v + 1);
        expect(runs.map((x) => x.attempt), `${r.request_id} visit ${v + 1}`).toEqual(runs.map((_, i) => i + 1));
        expect(runs.filter((x) => x.outcome === "qc_passed").length).toBe(1);
        expect(runs[runs.length - 1]?.outcome).toBe("qc_passed");
      });
    }
  });
});

describe("I3 a produced result is never mutated; changes create new versions", () => {
  it.each(SEEDS)("seed %i", (seed) => {
    const { input, out } = cases[seed - 1] as (typeof cases)[number];
    // the core does not write into its input
    expect(() => runL3(deepFreeze(structuredClone(input)))).not.toThrow();
    // a rerun adds a new attempt next to the old result instead of replacing it
    const measured = evs(out, "result_measured");
    expect(new Set(measured.map(key)).size).toBe(measured.length);
    for (const e of evs(out, "rerun_requested")) {
      expect(measured.some((m) => m.request_id === e.request_id && m.visit === e.visit && m.attempt === e.attempt), key(e)).toBe(true);
      expect(measured.some((m) => m.request_id === e.request_id && m.visit === e.visit && num(m.attempt) === num(e.attempt) + 1), key(e)).toBe(true);
    }
    // no state is shared between runs: a second run leaves the first log byte-identical
    const before = canonicalJsonl(out.events);
    runL3(structuredClone(input));
    expect(canonicalJsonl(out.events)).toBe(before);
  });
});

describe("I4 time is monotone and hold_time is not negative", () => {
  it.each(SEEDS)("seed %i", (seed) => {
    const { input, out } = cases[seed - 1] as (typeof cases)[number];
    const sampled = new Map(input.requests.map((r) => [r.request_id, num(r.sampled_s)] as const));
    const queued = new Map(evs(out, "request_queued").map((e) => [key(e), num(e.t)] as const));
    for (const r of out.runs) {
      const sampledAt = sampled.get(String(r.request_id)) as number;
      const arrivedAt = queued.get(key(r)) as number;
      expect(sampledAt).toBeLessThanOrEqual(arrivedAt);
      expect(arrivedAt).toBeLessThanOrEqual(num(r.start_s) - num(r.setup_s));
      expect(num(r.start_s) - num(r.setup_s)).toBeLessThanOrEqual(num(r.start_s));
      expect(num(r.start_s)).toBeLessThan(num(r.end_s));
      expect(num(r.start_s) - sampledAt).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("I5 no run intersects a window", () => {
  it.each(SEEDS)("seed %i", (seed) => {
    const { input, out } = cases[seed - 1] as (typeof cases)[number];
    for (const r of out.runs) {
      const from = num(r.start_s) - num(r.setup_s);
      for (const w of input.windows.filter((x) => x.analyzer === r.analyzer)) {
        expect(from < w.end_s && w.start_s < num(r.end_s), `${key(r)} on ${String(r.analyzer)} meets [${w.start_s}, ${w.end_s})`).toBe(false);
      }
    }
  });
});

describe("I6 queue discipline equals the policy's definition, recomputed independently", () => {
  it.each(SEEDS)("seed %i", (seed) => {
    const { input, out } = cases[seed - 1] as (typeof cases)[number];
    const groupOf = new Map(input.analyzers.map((a) => [a.id, a.group] as const));
    const deadline = new Map(input.requests.map((r) => [r.request_id, r.deadline_s ?? Infinity] as const));
    type Entry = { k: string; group: string; t: number; seq: number; dl: number };
    const waiting: Entry[] = [];
    // replay the log: arrivals join, each visit_started must take the policy-minimal entry of its group
    for (const e of out.events as unknown as Ev[]) {
      if (e.type === "request_queued") waiting.push({ k: key(e), group: String(e.group), t: num(e.t), seq: num(e.seq), dl: deadline.get(String(e.request_id)) as number });
      if (e.type !== "visit_started") continue;
      const group = groupOf.get(String(e.analyzer)) as string;
      const mine = waiting.filter((w) => w.group === group);
      const order = (a: Entry, b: Entry): number => (input.policy === "edf" ? (a.dl === b.dl ? 0 : a.dl < b.dl ? -1 : 1) : 0) || a.t - b.t || a.seq - b.seq;
      const head = [...mine].sort(order)[0] as Entry;
      expect(key(e), `${input.policy} head at t=${String(e.t)} in ${group}`).toBe(head.k);
      waiting.splice(waiting.indexOf(head), 1);
    }
    expect(waiting).toEqual([]);
  });
});

describe("I7 keyed-RNG independence: a rerun never changes another sample's noise draws", () => {
  const noise = (out: L3Output): Map<string, number> => new Map(evs(out, "result_measured").map((e) => [key(e), num(e.noise)] as const));
  it.each(SEEDS)("seed %i", (seed) => {
    const { input, out } = cases[seed - 1] as (typeof cases)[number];
    const withReruns = noise(out);
    const control = noise(runL3({ ...structuredClone(input), forced_outcomes: [] }));
    // every first attempt has the same draw with and without all the reruns
    for (const [k, v] of control) expect(withReruns.get(k), k).toBe(v);
    // removing the reruns of only one request leaves every other request's draws alone
    const first = input.forced_outcomes[0];
    if (first) {
      const one = noise(runL3({ ...structuredClone(input), forced_outcomes: input.forced_outcomes.filter((f) => f.request_id !== first.request_id) }));
      for (const [k, v] of withReruns) if (!k.startsWith(`${first.request_id}#`)) expect(one.get(k), k).toBe(v);
    }
    // the attempts of one sample draw different noise
    for (const e of evs(out, "rerun_requested")) {
      expect(withReruns.get(key(e)), key(e)).not.toBe(withReruns.get(`${String(e.request_id)}#${num(e.attempt) + 1}#${String(e.visit)}`));
    }
  });
});

describe("I8 observation contract: hidden fields never reach the recorder-visible stream", () => {
  const hidden = (): Map<string, string[]> => {
    const defs = readJson<Json>("schemas", "event.schema.json").$defs as Record<string, Json>;
    const out = new Map<string, string[]>();
    for (const def of Object.values(defs)) {
      const props = def.properties as Record<string, Json> | undefined;
      const type = (props?.type as Json | undefined)?.const;
      if (props && typeof type === "string") out.set(type, Object.entries(props).filter(([, p]) => p["x-visibility"] === "hidden").map(([k]) => k));
    }
    return out;
  };
  it.each(SEEDS)("seed %i", (seed) => {
    const { out } = cases[seed - 1] as (typeof cases)[number];
    const table = hidden();
    const perturbed = (out.events as unknown as Ev[]).map((e) => {
      const copy = { ...e };
      for (const f of table.get(String(e.type)) ?? []) copy[f] = num(copy[f]) + 1.5;
      return copy;
    });
    expect(perturbed.some((e, i) => JSON.stringify(e) !== JSON.stringify((out.events as unknown as Ev[])[i]))).toBe(true);
    expect(canonicalJsonl(observe(perturbed as never))).toBe(canonicalJsonl(observe(out.events as never)));
    for (const e of observe(out.events as never) as unknown as Ev[]) for (const f of table.get(String(e.type)) ?? []) expect(f in e, `${String(e.type)}.${f} leaked`).toBe(false);
  });
});

describe("I9 determinism: same inputs, same log_hash, across two Node processes", () => {
  it("in one process, the same input twice gives the same hash and another seed another hash", async () => {
    const a = cases[0] as (typeof cases)[number];
    const b = cases[1] as (typeof cases)[number];
    expect(await logHash(runL3(structuredClone(a.input)).events)).toBe(await logHash(a.out.events));
    expect(await logHash(a.out.events)).not.toBe(await logHash(b.out.events));
  });

  it.each([1, 17, 250])("seed %i: two child processes print the hash the test process computes", async (seed) => {
    const cli = join(ROOT, "engine", "tests", "support", "hash_cli.ts");
    const run = (): string => execFileSync(process.execPath, [...ENGINE_NODE_FLAGS, cli, String(seed)], { cwd: ROOT, encoding: "utf8" }).trim();
    const first = run();
    expect(run()).toBe(first);
    expect(first).toBe(await logHash((cases[seed - 1] as (typeof cases)[number]).out.events));
  });
});
