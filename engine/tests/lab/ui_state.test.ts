import { describe, expect, it } from "vitest";
import type { CheckDetail, ResultFooter, Response } from "../../../src/protocol.ts";
import { displayedCheck, initial, reduce } from "../../../src/ui/state.ts";

// The page keeps what the Worker told it in one reducer (lab_ui.md section 2: hooks and one reducer). Messages in, state out; no DOM.

const DETAIL: CheckDetail = { runs_ms: [1, 2, 3, 4, 5], truth: [{ seed: 1, equal: true }], repeats_equal: true, cells_equal: true };
const FOOTER: ResultFooter = { kind: "simulation_result", scenario: "default", seeds: [1], engine_version: "9.9.9", architectures: [], inputs: [], check: "pending" };
const READY: Response = { type: "ready", engine_version: "9.9.9", schema_version: "1", flags: ["f"], scenarios: [] };

describe("reduce", () => {
  it("Given the initial state Then nothing is ready, the check is pending, there is no result and no problem", () => {
    expect(initial).toEqual({ ready: null, check: { state: "pending", detail: { runs_ms: [], truth: [], repeats_equal: false, cells_equal: false } }, result: null, problem: null });
  });

  it("Given a ready message Then the state holds the ready payload without its type", () => {
    expect(reduce(initial, READY).ready).toEqual({ engine_version: "9.9.9", schema_version: "1", flags: ["f"], scenarios: [] });
  });

  it("Given check messages Then the latest one is kept, state and detail together", () => {
    const done = reduce(initial, { type: "check", state: "failed", detail: DETAIL });
    expect(done.check).toEqual({ state: "failed", detail: DETAIL });
  });

  it("Given a result Then it is kept with its footer, and a later result replaces it", () => {
    const first = reduce(initial, { type: "result", id: 1, summary: { events: 3, event_counts: { a: 3 } }, footer: FOOTER });
    expect(first.result).toEqual({ id: 1, summary: { events: 3, event_counts: { a: 3 } }, footer: FOOTER });
    expect(reduce(first, { type: "result", id: 2, footer: FOOTER }).result?.id).toBe(2);
  });

  it("Given an error message Then it becomes the problem with its code and the engine message unchanged", () => {
    const next = reduce(initial, { type: "error", id: 4, code: "engine_error", message: "the cohort size must be positive" });
    expect(next.problem).toEqual({ code: "engine_error", message: "the cohort size must be positive" });
  });

  it("Given an error of the Worker itself Then it becomes a problem with the code worker", () => {
    expect(reduce(initial, { type: "worker_error", message: "script failed" }).problem).toEqual({ code: "worker", message: "script failed" });
  });

  it("Given a result after a problem Then the problem is cleared", () => {
    const failed = reduce(initial, { type: "error", id: 4, code: "invalid_spec", message: "x" });
    expect(reduce(failed, { type: "result", id: 5, footer: FOOTER }).problem).toBeNull();
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
