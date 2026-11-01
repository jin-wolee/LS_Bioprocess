import { describe, expect, it } from "vitest";
import type { CheckDetail, ResultFooter, Response, ScenePlan } from "../protocol.ts";
import { READY } from "./fixture.ts";
import { displayedCheck, initial, reduce } from "./state.ts";
import type { State } from "./state.ts";

// The page keeps what the Worker told it in one reducer (lab_ui.md section 2: hooks and one reducer). Messages in, state out; no DOM.

const DETAIL: CheckDetail = { runs_ms: [1, 2, 3, 4, 5], truth: [{ seed: 1, equal: true }], repeats_equal: true, cells_equal: true };
const FOOTER: ResultFooter = { kind: "simulation_result", scenario: "default", seeds: [1], engine_version: "9.9.9", architectures: [], inputs: [], check: "pending" };
const READY_MESSAGE: Response = { type: "ready", ...READY };
const REPORT = { schema_version: "1", architectures: [] } as unknown as NonNullable<Extract<Response, { type: "result" }>["report"]>;
/** The state of a page whose run 5 is in flight. */
const running = (): State => reduce(initial, { type: "run_started", id: 5 });

describe("reduce", () => {
  it("Given the initial state Then nothing is ready, the check is pending, there is no result, no run, no problem, no lineage view, no challenge, no break-out result and no plant", () => {
    expect(initial).toEqual({
      ready: null,
      check: { state: "pending", detail: { runs_ms: [], truth: [], repeats_equal: false, cells_equal: false } },
      home: null,
      results: null,
      progress: null,
      running: null,
      problem: null,
      lineage: { running: null, asked: null, answer: null, problem: null },
      challenge: { starting: null, active: null, busy: null, problem: null },
      breakout: { running: null, asked: null, result: null, problem: null },
      plant: { epoch: 0, running: null, ready: null, halls: [], record: null, problem: null },
    });
  });

  it("Given a ready message Then the state holds the whole ready payload without its type", () => {
    expect(reduce(initial, READY_MESSAGE).ready).toEqual(READY);
  });

  it("Given check messages Then the latest one is kept, state and detail together", () => {
    const done = reduce(initial, { type: "check", state: "failed", detail: DETAIL });
    expect(done.check).toEqual({ state: "failed", detail: DETAIL });
  });

  it("Given a result with a summary (the Home form) Then it is kept as the Home result, and a later one replaces it", () => {
    const first = reduce(initial, { type: "result", id: 1, summary: { events: 3, event_counts: { a: 3 } }, footer: FOOTER });
    expect(first.home).toEqual({ id: 1, summary: { events: 3, event_counts: { a: 3 } }, footer: FOOTER });
    expect(first.results).toBeNull();
    expect(reduce(first, { type: "result", id: 2, summary: { events: 4, event_counts: {} }, footer: FOOTER }).home?.id).toBe(2);
  });

  it("Given a result with a report Then it is kept as the Results result, and the run in flight is over", () => {
    const done = reduce(running(), { type: "result", id: 5, report: REPORT, utilisation: { by_profile: [] }, footer: FOOTER });
    expect(done.results).toEqual({ id: 5, report: REPORT, utilisation: { by_profile: [] }, footer: FOOTER });
    expect(done.home).toBeNull();
    expect([done.running, done.progress]).toEqual([null, null]);
  });

  it("Given the Home result arrives while a run is in flight Then the run is untouched", () => {
    const after = reduce(running(), { type: "result", id: 1, summary: { events: 3, event_counts: {} }, footer: FOOTER });
    expect(after.running).toBe(5);
  });

  it("Given a run is started Then it is the run in flight, with no progress, no problem and no result of an earlier run (a result belongs to the spec that made it)", () => {
    const failed = reduce(initial, { type: "error", id: 4, code: "invalid_spec", message: "x" });
    expect(reduce(failed, { type: "run_started", id: 5 })).toMatchObject({ running: 5, progress: null, problem: null });
    const earlier = reduce(initial, { type: "result", id: 3, report: REPORT, footer: FOOTER });
    expect(earlier.results).not.toBeNull();
    expect(reduce(earlier, { type: "run_started", id: 5 }).results).toBeNull();
  });

  it("Given progress of the run in flight Then it is kept; given progress of another request Then it is ignored", () => {
    const first = reduce(running(), { type: "progress", id: 5, done: 2, total: 20 });
    expect(first.progress).toEqual({ id: 5, done: 2, total: 20 });
    expect(reduce(first, { type: "progress", id: 9, done: 1, total: 3 }).progress).toEqual({ id: 5, done: 2, total: 20 });
  });

  it("Given an error message Then it becomes the problem with its request id, its code and the engine message unchanged", () => {
    const next = reduce(initial, { type: "error", id: 4, code: "engine_error", message: "the cohort size must be positive" });
    expect(next.problem).toEqual({ id: 4, code: "engine_error", message: "the cohort size must be positive" });
  });

  it("Given an error of the run in flight, a refusal or a cancel, Then the run is over", () => {
    for (const code of ["invalid_spec", "engine_error", "cancelled"] as const) {
      const next = reduce(reduce(running(), { type: "progress", id: 5, done: 1, total: 3 }), { type: "error", id: 5, code, message: "m" });
      expect([next.running, next.progress, next.problem?.code], code).toEqual([null, null, code]);
    }
  });

  it("Given an error of another request Then the run in flight goes on", () => {
    expect(reduce(running(), { type: "error", id: 1, code: "engine_error", message: "m" }).running).toBe(5);
  });

  it("Given an error of the Worker itself Then it becomes a problem with the code worker and ends the run", () => {
    expect(reduce(running(), { type: "worker_error", message: "script failed" })).toMatchObject({ problem: { id: null, code: "worker", message: "script failed" }, running: null });
  });

  it("Given a result after a problem Then the problem is cleared", () => {
    const failed = reduce(initial, { type: "error", id: 4, code: "invalid_spec", message: "x" });
    expect(reduce(failed, { type: "result", id: 5, report: REPORT, footer: FOOTER }).problem).toBeNull();
  });
});

describe("displayedCheck: a result shown while the check was pending is re-labelled when the check message arrives", () => {
  it("Given a footer made while pending and a check that has finished Then the finished state is shown", () => {
    expect(displayedCheck("pending", "identical")).toBe("identical");
    expect(displayedCheck("pending", "failed")).toBe("failed");
  });

  it("Given a footer made under a settled state Then that state stays (the check runs once per load)", () => {
    expect(displayedCheck("failed", "identical")).toBe("failed");
    expect(displayedCheck("identical", "pending")).toBe("identical");
  });
});

describe("the plant in the page state (plant_ui.md section 6, rule 3)", () => {
  const plan: ScenePlan = { schema_version: "1", seed: 1, horizon_s: 0, layout: { bays: [], analyzers: [], architectures: [] }, units: [], analyzers: [], staff: [], samples: [], marks: [], windows: [], calibrations: [], records: [] };
  const answer = (id: number, epoch: number): Response => ({ type: "plant_ready", id, epoch, plan: { ...plan, seed: epoch }, resume_at: 0, hashes: { truth: "t", cells: {} }, checks: { prefix_equal: null, truth_equal: null } });

  it("Given a plant request and its answer Then the plan is in the state, and the run of the lab is untouched", () => {
    const asked = reduce(running(), { type: "plant_started", id: 9, epoch: 1 });
    const next = reduce(asked, answer(9, 1));
    expect([next.plant.epoch, next.plant.ready?.plan.seed, next.running, next.results]).toEqual([1, 1, 5, null]);
  });

  it("Given an answer of an older epoch Then it is dropped, and an error of the newest epoch is the plant's problem and not the page's", () => {
    const asked = reduce(reduce(initial, { type: "plant_started", id: 9, epoch: 1 }), { type: "plant_started", id: 10, epoch: 2 });
    expect(reduce(asked, answer(9, 1))).toEqual(asked);
    const failed = reduce(asked, { type: "error", id: 10, epoch: 2, code: "refused", message: "no", reason: "past", index: 0 });
    expect([failed.plant.problem?.code, failed.problem]).toEqual(["refused", null]);
  });

  it("Given an error of a plant request of an older epoch Then it changes nothing; an error with no epoch is still the page's", () => {
    const asked = reduce(reduce(initial, { type: "plant_started", id: 9, epoch: 1 }), { type: "plant_started", id: 10, epoch: 2 });
    expect(reduce(asked, { type: "error", id: 9, epoch: 1, code: "cancelled", message: "m" })).toEqual(asked);
    expect(reduce(asked, { type: "error", id: 3, code: "engine_error", message: "m" }).problem?.code).toBe("engine_error");
  });
});
