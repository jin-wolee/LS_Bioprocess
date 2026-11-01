import { describe, expect, it } from "vitest";
import type { Response, ScenePlan } from "../protocol.ts";
import { initialPlant, reducePlant } from "./plant_state.ts";
import type { PlantAction, PlantState } from "./plant_state.ts";

// docs/design/plant_ui.md section 5.5 and section 6, rule 3: the page asks for a plan under an epoch and drops every answer, and every error, whose epoch is not the newest it asked for. The plan
// it already has stays drawn until the newer one arrives.

const plan = (seed: number): ScenePlan => ({ schema_version: "1", seed, horizon_s: 0, layout: { bays: [], analyzers: [], architectures: [] }, units: [], analyzers: [], staff: [], samples: [], marks: [], windows: [], records: [] });
const ready = (id: number, epoch: number, seed = epoch): Extract<Response, { type: "plant_ready" }> => ({
  type: "plant_ready", id, epoch, plan: plan(seed), resume_at: 0, hashes: { truth: `t${epoch}`, cells: { a_manual: `c${epoch}` } }, checks: { prefix_equal: null, truth_equal: null },
});
const run = (actions: PlantAction[], from: PlantState = initialPlant): PlantState => actions.reduce(reducePlant, from);

describe("the plant state", () => {
  it("Given nothing asked Then there is no epoch, no plan and no problem", () => {
    expect(initialPlant).toEqual({ epoch: 0, running: null, ready: null, problem: null });
  });

  it("Given a request is made Then its epoch is the newest and the request is running", () => {
    expect(run([{ type: "plant_started", id: 7, epoch: 1 }])).toEqual({ epoch: 1, running: 7, ready: null, problem: null });
  });

  it("Given the answer of the newest epoch Then the plan, the hashes and the checks are kept and nothing is running", () => {
    const s = run([{ type: "plant_started", id: 7, epoch: 1 }, ready(7, 1)]);
    expect(s.running).toBeNull();
    expect(s.ready).toEqual({ epoch: 1, plan: plan(1), resume_at: 0, hashes: { truth: "t1", cells: { a_manual: "c1" } }, checks: { prefix_equal: null, truth_equal: null } });
  });

  it("Given two requests and the answer of the older arriving after the newer was asked for Then the older answer is dropped and the newer one is drawn when it arrives", () => {
    const asked = run([{ type: "plant_started", id: 7, epoch: 1 }, { type: "plant_started", id: 8, epoch: 2 }]);
    const stale = run([ready(7, 1)], asked);
    expect(stale).toEqual(asked); // nothing changed: the stale answer is not drawn
    expect(stale.ready).toBeNull();
    const fresh = run([ready(8, 2)], stale);
    expect(fresh.ready?.epoch).toBe(2);
    expect(fresh.ready?.plan.seed).toBe(2);
  });

  it("Given a plan on screen and a newer request Then the plan stays until the newer answer replaces it", () => {
    const first = run([{ type: "plant_started", id: 7, epoch: 1 }, ready(7, 1)]);
    const asked = run([{ type: "plant_started", id: 8, epoch: 2 }], first);
    expect(asked.ready?.epoch).toBe(1);
    expect(asked.running).toBe(8);
    expect(run([ready(8, 2)], asked).ready?.epoch).toBe(2);
  });

  it("Given an error of the newest epoch Then it is the problem, with its reason and the index of the action; the next request clears it", () => {
    const asked = run([{ type: "plant_started", id: 7, epoch: 1 }]);
    const failed = run([{ type: "error", id: 7, epoch: 1, code: "refused", message: "no such unit", reason: "unknown_target", index: 2 }], asked);
    expect(failed.problem).toEqual({ code: "refused", message: "no such unit", reason: "unknown_target", index: 2 });
    expect(failed.running).toBeNull();
    expect(run([{ type: "plant_started", id: 8, epoch: 2 }], failed).problem).toBeNull();
  });

  it("Given the error of an older epoch (a run that was cancelled) Then it is dropped", () => {
    const asked = run([{ type: "plant_started", id: 7, epoch: 1 }, { type: "plant_started", id: 8, epoch: 2 }]);
    const after = run([{ type: "error", id: 7, epoch: 1, code: "cancelled", message: "replaced" }], asked);
    expect(after).toEqual(asked);
  });

  it("Given a message that is not about the plant Then the state is unchanged", () => {
    const s = run([{ type: "plant_started", id: 7, epoch: 1 }]);
    expect(reducePlant(s, { type: "progress", id: 3, done: 1, total: 2 })).toBe(s);
    expect(reducePlant(s, { type: "error", id: 3, code: "engine_error", message: "x" })).toBe(s);
  });
});
