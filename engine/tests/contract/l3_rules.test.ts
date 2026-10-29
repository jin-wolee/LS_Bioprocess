import { describe, expect, it } from "vitest";
import { runL3 } from "../../src/analysis.ts";
import type { L3Input, L3Output } from "../../src/analysis.ts";
import { T, mini, req } from "../support/mini.ts";

// All numbers here are test-only inputs (prompts/10: no domain values in S1a).
const starts = (out: L3Output) => out.runs.map((r) => [r.request_id, r.attempt, r.analyzer, r.start_s, r.end_s]);
type Ev = Record<string, number | string>;
const events = (out: L3Output, type: string): Ev[] => (out.events as unknown as Ev[]).filter((e) => e.type === type);
const win = (analyzer: string, start_s: number, end_s: number) => ({ analyzer, start_s, end_s });
const two = (over: Partial<L3Input>) =>
  mini({
    analyzers: [
      { id: "AN-1", group: "G", initial_method: null },
      { id: "AN-2", group: "G", initial_method: null },
    ],
    ...over,
  });

describe("Contract: windows are half-open and the whole run is checked", () => {
  it("a run that ends exactly at the window start is allowed", () => {
    const out = runL3(mini({ windows: [win("AN-1", 1000, 2000)], requests: [req("A", 1, 400, 600)] }));
    expect(starts(out)).toEqual([["A", 1, "AN-1", 400, 1000]]);
  });

  it("a run that arrives exactly at the window end starts then", () => {
    const out = runL3(mini({ windows: [win("AN-1", 1000, 2000)], requests: [req("A", 1, 2000, 600)] }));
    expect(starts(out)).toEqual([["A", 1, "AN-1", 2000, 2600]]);
  });

  it("a run that would straddle the window start waits for the window end", () => {
    const out = runL3(mini({ windows: [win("AN-1", 1000, 2000)], requests: [req("A", 1, 401, 600)] }));
    expect(starts(out)).toEqual([["A", 1, "AN-1", 2000, 2600]]);
  });

  it("strict head of line: a short request behind a blocked head does not backfill", () => {
    const out = runL3(mini({ windows: [win("AN-1", 1000, 1500)], requests: [req("A", 1, 500, 600), req("B", 2, 501, 100)] }));
    expect(starts(out)).toEqual([
      ["A", 1, "AN-1", 1500, 2100],
      ["B", 1, "AN-1", 2100, 2200],
    ]);
  });

  it("a window opens and closes with its own events (qc by default, maintenance when asked)", () => {
    const out = runL3(mini({ windows: [win("AN-1", 10, 20), { ...win("AN-1", 30, 40), kind: "maintenance" }] }));
    expect(events(out, "qc_window_started").map((e) => e.t)).toEqual([10]);
    expect(events(out, "qc_window_ended").map((e) => e.t)).toEqual([20]);
    expect(events(out, "maintenance_started").map((e) => e.t)).toEqual([30]);
    expect(events(out, "maintenance_ended").map((e) => e.t)).toEqual([40]);
  });
});

describe("Contract: queue policies and dispatch", () => {
  const pile = (policy: "fifo" | "edf") =>
    runL3(
      mini({
        policy,
        requests: [
          req("B0", 1, 0, 1000, { deadline_s: 100000 }),
          req("X", 2, 300, 100, { deadline_s: 5000 }),
          req("Y", 3, 200, 100, { deadline_s: 9000 }),
          req("Z", 4, 200, 100, { deadline_s: 9000 }),
          req("W", 5, 100, 100),
        ],
      }),
    );

  it("fifo orders by arrival at the analyzer, then seq", () => {
    expect(starts(pile("fifo")).map((r) => r[0])).toEqual(["B0", "W", "Y", "Z", "X"]);
  });

  it("edf orders by deadline, then arrival, then seq; a request without a deadline goes last", () => {
    expect(starts(pile("edf")).map((r) => r[0])).toEqual(["B0", "X", "Y", "Z", "W"]);
  });

  it("the head goes to the lowest-index idle analyzer", () => {
    const out = runL3(two({ requests: [req("A", 1, 100, 50)] }));
    expect(starts(out)).toEqual([["A", 1, "AN-1", 100, 150]]);
  });

  it("an analyzer that cannot hold the whole run is not available: the head goes to the next one", () => {
    const out = runL3(two({ windows: [win("AN-1", 0, 1000)], requests: [req("A", 1, 100, 50)] }));
    expect(starts(out)).toEqual([["A", 1, "AN-2", 100, 150]]);
  });

  it("a later visit re-enters the queue with its request's own seq: at an equal arrival instant it goes before a request with a higher seq", () => {
    // A (seq 1) visits X then Y; B (seq 2) visits Y only. A's second visit and B both reach Y at 09:02:00.
    // A fresh seq for the later visit would put it behind B.
    const out = runL3(
      mini({
        analyzers: [
          { id: "AN-X", group: "X", initial_method: null },
          { id: "AN-Y", group: "Y", initial_method: null },
        ],
        requests: [
          { request_id: "A", seq: 1, arrive_s: T(9), visits: [{ group: "X", service_s: 120 }, { group: "Y", service_s: 120, transfer_s: 0 }] },
          { request_id: "B", seq: 2, arrive_s: T(9, 2), visits: [{ group: "Y", service_s: 120 }] },
        ],
      }),
    );
    expect(starts(out)).toEqual([
      ["A", 1, "AN-X", T(9), T(9, 2)],
      ["A", 1, "AN-Y", T(9, 2), T(9, 4)],
      ["B", 1, "AN-Y", T(9, 4), T(9, 6)],
    ]);
  });

  it("a run ending at t frees its analyzer before an arrival at t is dispatched", () => {
    const out = runL3(mini({ requests: [req("A", 1, 0, 100), req("B", 2, 100, 100)] }));
    expect(starts(out)).toEqual([
      ["A", 1, "AN-1", 0, 100],
      ["B", 1, "AN-1", 100, 200],
    ]);
  });
});

describe("Contract: time fields of one visit", () => {
  const withSetup = () =>
    runL3(
      mini({
        analyzers: [{ id: "AN-1", group: "G", initial_method: "T" }],
        setup: [
          { from_method: "T", to_method: "S", seconds: 40 },
          { from_method: "S", to_method: "T", seconds: 40 },
        ],
        requests: [{ request_id: "A", seq: 1, sampled_s: 20, arrive_s: 100, visits: [{ group: "G", service_s: 60, method_id: "S" }] }],
      }),
    );

  it("queued at arrival, visit_started loads the sample, run_started follows the setup, visit_finished is the end of the run", () => {
    const out = withSetup();
    expect(events(out, "request_queued").map((e) => e.t)).toEqual([100]);
    expect(events(out, "visit_started").map((e) => e.t)).toEqual([100]);
    expect(events(out, "run_started").map((e) => e.t)).toEqual([140]);
    expect(events(out, "visit_finished").map((e) => e.t)).toEqual([200]);
  });

  it("measured_at is run.ended_at, the instant of visit_finished; start_s is run_started and setup_s travels with the run", () => {
    const out = withSetup();
    expect(events(out, "result_measured").map((e) => e.t)).toEqual([200]);
    expect(out.runs).toEqual([{ request_id: "A", attempt: 1, visit: 1, analyzer: "AN-1", setup_s: 40, start_s: 140, end_s: 200, outcome: "qc_passed" }]);
  });

  it("no setup when the method is unchanged or the analyzer starts empty; a pair missing from the table is an error", () => {
    const same = runL3(
      mini({
        analyzers: [{ id: "AN-1", group: "G", initial_method: null }],
        setup: [{ from_method: "T", to_method: "S", seconds: 40 }],
        requests: [
          { request_id: "A", seq: 1, arrive_s: 0, visits: [{ group: "G", service_s: 10, method_id: "T" }] },
          { request_id: "B", seq: 2, arrive_s: 0, visits: [{ group: "G", service_s: 10, method_id: "T" }] },
        ],
      }),
    );
    expect(same.runs.map((r) => r.setup_s)).toEqual([0, 0]);
    const missing = mini({
      analyzers: [{ id: "AN-1", group: "G", initial_method: "T" }],
      requests: [{ request_id: "A", seq: 1, arrive_s: 0, visits: [{ group: "G", service_s: 10, method_id: "S" }] }],
    });
    expect(() => runL3(missing)).toThrow(/setup/);
  });

  it("a later visit arrives at run.ended_at plus its transfer_s", () => {
    const out = runL3(
      mini({
        analyzers: [
          { id: "AN-1", group: "G", initial_method: null },
          { id: "AN-2", group: "H", initial_method: null },
        ],
        requests: [{ request_id: "A", seq: 1, arrive_s: 0, visits: [{ group: "G", service_s: 100 }, { group: "H", service_s: 50, transfer_s: 30 }] }],
      }),
    );
    expect(events(out, "request_queued").map((e) => [e.visit, e.t])).toEqual([[1, 0], [2, 130]]);
    expect(starts(out)).toEqual([["A", 1, "AN-1", 0, 100], ["A", 1, "AN-2", 130, 180]]);
  });
});

describe("Contract: reruns", () => {
  const failed = (outcome: "qc_failed" | "over_range", extra: Partial<L3Input> = {}) =>
    runL3(
      mini({
        requests: [req("P", 1, 0, 100), req("Q", 2, 50, 100)],
        forced_outcomes: [{ request_id: "P", attempt: 1, visit: 1, outcome }],
        ...extra,
      }),
    );

  it("a qc_failed run re-enqueues the same sample as attempt + 1 at run.ended_at with a seq above every request seq", () => {
    const out = failed("qc_failed");
    expect(events(out, "rerun_requested").map((e) => [e.t, e.request_id, e.attempt])).toEqual([[100, "P", 1]]);
    const requeue = events(out, "request_queued").filter((e) => e.request_id === "P" && e.attempt === 2);
    expect(requeue.map((e) => e.t)).toEqual([100]);
    expect(Number(requeue[0]?.seq)).toBeGreaterThan(2);
  });

  it("nothing holds the analyzer after a failed run: the next queued request starts at its end", () => {
    expect(starts(failed("qc_failed"))).toEqual([
      ["P", 1, "AN-1", 0, 100],
      ["Q", 1, "AN-1", 100, 200],
      ["P", 2, "AN-1", 200, 300],
    ]);
  });

  it("the failed attempt stays in the truth log with its QC outcome; the rerun is qc_passed", () => {
    const out = failed("qc_failed");
    expect(out.runs.filter((r) => r.request_id === "P").map((r) => [r.attempt, r.outcome])).toEqual([[1, "qc_failed"], [2, "qc_passed"]]);
    expect(events(out, "qc_result").filter((e) => e.request_id === "P").map((e) => [e.attempt, e.outcome])).toEqual([[1, "qc_failed"], [2, "qc_passed"]]);
    expect(events(out, "result_measured").filter((e) => e.request_id === "P").map((e) => e.attempt)).toEqual([1, 2]);
  });

  it("over_range reruns the same way and logs the dilution factor of the input on attempt 2", () => {
    const out = failed("over_range", { dilution_factor: 4 });
    expect(starts(out).map((r) => [r[0], r[1]])).toEqual([["P", 1], ["Q", 1], ["P", 2]]);
    expect(events(out, "dilution_applied").map((e) => [e.request_id, e.attempt, e.dilution_factor])).toEqual([["P", 2, 4]]);
  });

  it("over_range without a dilution factor in the input (a trace alone has none) still reruns and logs no invented factor", () => {
    const out = failed("over_range");
    expect(starts(out).map((r) => [r[0], r[1]])).toEqual([["P", 1], ["Q", 1], ["P", 2]]);
    expect(events(out, "dilution_applied")).toEqual([]);
    expect(events(out, "rerun_requested").map((e) => e.reason)).toEqual(["over_range"]);
  });

  it("a request that fails again keeps counting up", () => {
    const out = runL3(
      mini({
        requests: [req("P", 1, 0, 10)],
        forced_outcomes: [
          { request_id: "P", attempt: 1, visit: 1, outcome: "qc_failed" },
          { request_id: "P", attempt: 2, visit: 1, outcome: "qc_failed" },
        ],
      }),
    );
    expect(out.runs.map((r) => [r.attempt, r.outcome])).toEqual([[1, "qc_failed"], [2, "qc_failed"], [3, "qc_passed"]]);
  });
});

describe("Contract: input checks", () => {
  it("a visit whose group has no analyzer, a duplicate request id and a non-integer time are rejected", () => {
    expect(() => runL3(mini({ requests: [{ request_id: "A", seq: 1, arrive_s: 0, visits: [{ group: "NOPE", service_s: 5 }] }] }))).toThrow();
    expect(() => runL3(mini({ requests: [req("A", 1, 0, 5), req("A", 2, 0, 5)] }))).toThrow();
    expect(() => runL3(mini({ requests: [req("A", 1, 0.5, 5)] }))).toThrow();
  });

  it("the input object is never modified", () => {
    const input = mini({ requests: [req("A", 1, 0, 5), req("B", 2, 1, 5)], forced_outcomes: [{ request_id: "A", attempt: 1, visit: 1, outcome: "qc_failed" }] });
    const before = JSON.stringify(input);
    runL3(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});
