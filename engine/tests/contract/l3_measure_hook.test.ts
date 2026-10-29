import { describe, expect, it } from "vitest";
import { runL3 } from "../../src/analysis.ts";
import type { Event } from "../../src/generated/event.schema";
import { mini, req } from "../support/mini.ts";

// Contract of the measurement hook S1b adds to the L3 core: the core stays plain (no profile, scenario or ledger value);
// what a run measures and how it ends come from a function the caller passes. Without the hook nothing changes (S1a tests).

const types = (events: readonly Event[], type: string) => events.filter((e) => e.type === type);

describe("Contract: measurement hook of the L3 core", () => {
  const input = () => mini({ requests: [req("R1", 1, 100, 60)] });

  it("Given a hook returning two results When a run ends Then one result_measured per analyte is logged, in order, with the extra fields the hook gives", () => {
    const out = runL3(input(), {
      measure: () => ({
        results: [
          { analyte: "a", value: 1.5, true_value: 1, noise: 0.5 },
          { analyte: "b", value: 2, true_value: 2, noise: 0, extrapolated: true },
        ],
      }),
    });
    const r = types(out.events, "result_measured");
    expect(r.map((e) => (e as { analyte: string }).analyte)).toEqual(["a", "b"]);
    expect(r[1]).toMatchObject({ extrapolated: true, t: 160, attempt: 1, visit: 1 });
    expect(types(out.events, "qc_result")).toMatchObject([{ outcome: "qc_passed" }]);
  });

  it("Given the hook reports over_range with a next dilution When the run ends Then a rerun is queued and dilution_applied carries that factor on the next attempt", () => {
    const seen: number[] = [];
    const out = runL3(input(), {
      measure: (ctx) => {
        seen.push(ctx.attempt);
        return ctx.attempt === 1 ? { results: [{ analyte: "a", value: 9, true_value: 9, noise: 0 }], outcome: "over_range", next_dilution_factor: 2 } : { results: [{ analyte: "a", value: 9, true_value: 9, noise: 0 }] };
      },
    });
    expect(seen).toEqual([1, 2]);
    expect(types(out.events, "rerun_requested")).toMatchObject([{ attempt: 1, reason: "over_range" }]);
    expect(types(out.events, "dilution_applied")).toMatchObject([{ attempt: 2, dilution_factor: 2 }]);
    expect(out.runs.map((r) => r.outcome)).toEqual(["over_range", "qc_passed"]);
  });

  it("Given a forced outcome and a hook Then the forced outcome wins (a trace replay must reproduce its runs)", () => {
    const out = runL3(mini({ requests: [req("R1", 1, 100, 60)], forced_outcomes: [{ request_id: "R1", attempt: 1, visit: 1, outcome: "qc_failed" }] }), {
      measure: () => ({ results: [{ analyte: "a", value: 1, true_value: 1, noise: 0 }] }),
    });
    expect(out.runs.map((r) => r.outcome)).toEqual(["qc_failed", "qc_passed"]);
  });

  it("Given the hook context Then it names the request, visit, attempt, analyzer and the run's start and end", () => {
    let ctx: unknown;
    runL3(input(), { measure: (c) => ((ctx = c), { results: [{ analyte: "a", value: 0, true_value: 0, noise: 0 }] }) });
    expect(ctx).toMatchObject({ visit: 1, attempt: 1, analyzer: "AN-1", start_s: 100, end_s: 160 });
    expect((ctx as { request: { request_id: string } }).request.request_id).toBe("R1");
  });
});
