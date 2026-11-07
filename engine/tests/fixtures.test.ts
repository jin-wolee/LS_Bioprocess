import { describe, expect, it } from "vitest";
import { runL3 } from "../src/analysis.ts";
import type { L3Input, L3Output } from "../src/analysis.ts";
import { listFiles, readJson } from "./support/paths.ts";

// Hand-calculated fixtures F1-F7 (docs/prompts/10 Step 3). Expected values were typed from the brief, never from engine output.
// Times are exact (===). The runner is generic: it only knows the fixture file format.

interface ExpectedRun {
  request_id: string;
  attempt: number;
  visit: number;
  analyzer: string;
  setup_s: number;
  start_s: number;
  end_s: number;
  outcome: string;
}
interface Expected {
  runs: ExpectedRun[];
  wait_s?: Record<string, number>;
  hold_time_s?: Record<string, number>;
  busy_s?: Record<string, number>;
  productive_s?: Record<string, number>;
  arrivals?: Record<string, number>;
  dilution_applied?: { request_id: string; attempt: number; dilution_factor: number }[];
  noise_checks?: { same_as_case: string; same_draws: string[]; differ_within_case: string[][]; log_keeps_attempts: Record<string, number[]> };
}
interface FixtureCase {
  case: string;
  derivation: string;
  inputs: L3Input;
  expected: Expected;
}
interface FixtureFile {
  fixture: string;
  cases: FixtureCase[];
}

type Ev = Record<string, number | string>;
const evs = (out: L3Output, type: string): Ev[] => (out.events as unknown as Ev[]).filter((e) => e.type === type);
const key = (e: { request_id?: unknown; attempt?: unknown; visit?: unknown }): string => `${String(e.request_id)}#${String(e.attempt)}#${String(e.visit)}`;
const sortRuns = <R extends { start_s: number; analyzer: string; request_id: string; attempt: number }>(runs: readonly R[]): R[] =>
  [...runs].sort((a, b) => a.start_s - b.start_s || (a.analyzer < b.analyzer ? -1 : a.analyzer > b.analyzer ? 1 : 0) || (a.request_id < b.request_id ? -1 : a.request_id > b.request_id ? 1 : 0) || a.attempt - b.attempt);

const files = listFiles("tests", "fixtures", "hand").filter((f) => /^F\d.*\.json$/.test(f));
const fixtures = files.map((f) => readJson<FixtureFile>("tests", "fixtures", "hand", f));
const allCases = new Map(fixtures.flatMap((f) => f.cases).map((c) => [c.case, c] as const));
const outputs = new Map<string, L3Output>();
const outputOf = (c: FixtureCase): L3Output => {
  let out = outputs.get(c.case);
  if (!out) {
    out = runL3(structuredClone(c.inputs));
    outputs.set(c.case, out);
  }
  return out;
};

describe("Hand fixtures: the set is complete", () => {
  it("F1, F1c, F2, F2b, F3, F4, F5, F6 and F7 exist with all their variants", () => {
    expect(fixtures.map((f) => f.fixture).sort()).toEqual(["F1", "F1c", "F2", "F2b", "F3", "F4", "F5", "F6", "F7"]);
    expect([...allCases.keys()].sort()).toEqual(
      ["F1", "F1b", "F1c", "F2-r1", "F2-r2", "F2-r3", "F2-r4", "F2-r5", "F2b-r1", "F2b-r2", "F3", "F3-control", "F3b", "F4", "F4-transfer60", "F5", "F5-initial-S", "F6", "F7", "F7-fifo"].sort(),
    );
  });
});

for (const fx of fixtures) {
  describe(`${fx.fixture}`, () => {
    for (const c of fx.cases) {
      describe(c.case, () => {
        it("runs equal the hand-typed expectation (start, end, setup, analyzer, outcome), exactly", () => {
          expect(sortRuns(outputOf(c).runs as unknown as ExpectedRun[])).toEqual(c.expected.runs);
        });

        it("every time in the log is an integer second", () => {
          for (const e of outputOf(c).events as unknown as Ev[]) expect(Number.isInteger(e.t), JSON.stringify(e)).toBe(true);
        });

        if (c.expected.wait_s) {
          it("waits (visit start minus arrival at the analyzer) equal the hand values", () => {
            const out = outputOf(c);
            const queued = new Map(evs(out, "request_queued").map((e) => [key(e), Number(e.t)] as const));
            const got = Object.fromEntries(out.runs.map((r) => [key(r), Number(r.start_s) - Number(r.setup_s) - (queued.get(key(r)) as number)]));
            expect(Object.fromEntries(Object.keys(c.expected.wait_s ?? {}).map((k) => [k, got[k]]))).toEqual(c.expected.wait_s);
          });
        }

        if (c.expected.hold_time_s) {
          it("hold_time (sampled to run_started_at) equals the hand values", () => {
            const sampled = new Map(c.inputs.requests.map((r) => [r.request_id, r.sampled_s] as const));
            const got = Object.fromEntries(outputOf(c).runs.filter((r) => r.attempt === 1 && r.visit === 1).map((r) => [String(r.request_id), Number(r.start_s) - (sampled.get(String(r.request_id)) as number)]));
            expect(got).toEqual(c.expected.hold_time_s);
          });
        }

        if (c.expected.busy_s) {
          it("busy and productive time per analyzer come from the emitted events", () => {
            const out = outputOf(c);
            const startOf = (type: string) => new Map(evs(out, type).map((e) => [key(e), Number(e.t)] as const));
            const visitStart = startOf("visit_started");
            const runStart = startOf("run_started");
            const busy: Record<string, number> = {};
            const productive: Record<string, number> = {};
            for (const f of evs(out, "visit_finished")) {
              const a = String(f.analyzer);
              busy[a] = (busy[a] ?? 0) + Number(f.t) - (visitStart.get(key(f)) as number);
              productive[a] = (productive[a] ?? 0) + Number(f.t) - (runStart.get(key(f)) as number);
            }
            expect(busy).toEqual(c.expected.busy_s);
            expect(productive).toEqual(c.expected.productive_s);
          });
        }

        if (c.expected.arrivals) {
          it("arrivals at each analyzer (request_queued) equal the hand values", () => {
            const queued = Object.fromEntries(evs(outputOf(c), "request_queued").map((e) => [key(e), Number(e.t)]));
            expect(Object.fromEntries(Object.keys(c.expected.arrivals ?? {}).map((k) => [k, queued[k]]))).toEqual(c.expected.arrivals);
          });
        }

        if (c.expected.dilution_applied) {
          it("the truth log carries the fixture-only dilution_factor on attempt 2", () => {
            const got = evs(outputOf(c), "dilution_applied").map((e) => ({ request_id: e.request_id, attempt: e.attempt, dilution_factor: e.dilution_factor }));
            expect(got).toEqual(c.expected.dilution_applied);
          });
        }

        if (c.expected.noise_checks) {
          const nc = c.expected.noise_checks;
          const noiseOf = (out: L3Output): Record<string, number> => Object.fromEntries(evs(out, "result_measured").map((e) => [key(e), Number(e.noise)]));
          it(`noise draws of ${nc.same_draws.join(", ")} are identical to the ${nc.same_as_case} run (keyed RNG)`, () => {
            const mine = noiseOf(outputOf(c));
            const control = noiseOf(outputOf(allCases.get(nc.same_as_case) as FixtureCase));
            for (const k of nc.same_draws) {
              expect(mine[k], k).toBeDefined();
              expect(mine[k], k).toBe(control[k]);
            }
          });
          it("a rerun draws fresh noise: the attempts of one sample differ", () => {
            const mine = noiseOf(outputOf(c));
            for (const [a, b] of nc.differ_within_case as [string, string][]) {
              expect(mine[a as string], `${a} defined`).toBeDefined();
              expect(mine[a as string]).not.toBe(mine[b as string]);
            }
          });
          it("the truth log keeps every attempt", () => {
            const out = outputOf(c);
            for (const [rid, attempts] of Object.entries(nc.log_keeps_attempts)) {
              expect(evs(out, "result_measured").filter((e) => e.request_id === rid).map((e) => e.attempt)).toEqual(attempts);
              expect(evs(out, "qc_result").filter((e) => e.request_id === rid).map((e) => e.attempt)).toEqual(attempts);
            }
          });
        }
      });
    }
  });
}
