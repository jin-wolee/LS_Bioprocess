import { describe, expect, it } from "vitest";
import type { Response, ScenePlan, TruthOverlay } from "../protocol.ts";
import { breakoutAsk, initialPlant, reducePlant } from "./plant_state.ts";
import type { PlantAction, PlantState } from "./plant_state.ts";
import type { PlantAsk } from "./spec.ts";

// P7c (docs/design/plant_ui.md section 3.3, "As built in P7c"): in a case the truth overlay has a third slot, for the pick `{ breakout: true }`. It follows the rules of the other two: nothing is held while
// the switch is off, the answer of its own request only is kept (by id and epoch), an error about it is the overlay's problem and not the plant's, and a new plan drops it.

const CASE: PlantAsk = { case: "sc12_medium_lot", architectures: ["a_manual"], seed: 9013, actions: [] };
const plan: ScenePlan = { schema_version: "1", seed: 9013, horizon_s: 0, layout: { bays: [], analyzers: [], architectures: ["a_manual"] }, units: [], analyzers: [], staff: [], samples: [], marks: [], windows: [], calibrations: [], records: [] };
const ready = (id: number, epoch: number): Extract<Response, { type: "plant_ready" }> => ({
  type: "plant_ready", id, epoch, plan, resume_at: 0, hashes: { truth: `t${epoch}`, cells: { a_manual: `c${epoch}` } }, checks: { prefix_equal: null, truth_equal: null }, key: "k",
});
const view: TruthOverlay = {
  kind: "breakout",
  event: { type: "bacterial", profile: "p", origin_kind: "medium_lot", origin_id: "ML-3", horizon_days: 21, horizon_ref: "A189", contaminated_at: { value: 48, unit: "h", ref: "A157" } },
  affected: [{ unit: 0, onset_s: 187200 }],
};
const run = (actions: PlantAction[], from: PlantState = initialPlant): PlantState => actions.reduce(reducePlant, from);
const shown = run([{ type: "plant_started", id: 7, epoch: 1, spec: CASE }, ready(7, 1)]);
const on = run([{ type: "plant_truth_switched", on: true }], shown);
const asked = run([{ type: "plant_truth_started", id: 30, epoch: 1, pick: { breakout: true } }], on);

describe("what the overlay asks for in a case", () => {
  it("Given the switch on, a case and a plan on screen Then the page asks for the event, and in no other combination", () => {
    expect(breakoutAsk(true, true, 1)).toEqual({ breakout: true });
    expect(breakoutAsk(false, true, 1)).toBeNull(); // the switch is off: nothing is asked before it is pressed
    expect(breakoutAsk(true, false, 1)).toBeNull(); // a run that is not a case: the Worker would refuse the pick
    expect(breakoutAsk(true, true, undefined)).toBeNull(); // no plan on screen yet
  });
});

describe("the break-out slot of the truth overlay", () => {
  it("Given the plan of a case and the switch off Then the overlay has no slot for the event; given it on and nothing asked Then it still has none", () => {
    expect(shown.truth.breakout).toBeUndefined();
    expect(on.truth.breakout).toBeUndefined();
  });

  it("Given the request is made Then the slot holds its id and epoch and no answer", () => {
    expect(asked.truth.breakout).toEqual({ id: 30, epoch: 1, view: null, problem: null });
  });

  it("Given the answer of that request Then it is kept; given the answer of another id or of another epoch Then it is not", () => {
    expect(run([{ type: "plant_truth_view", id: 30, epoch: 1, view }], asked).truth.breakout?.view).toEqual(view);
    expect(run([{ type: "plant_truth_view", id: 31, epoch: 1, view }], asked)).toEqual(asked);
    expect(run([{ type: "plant_truth_view", id: 30, epoch: 0, view }], asked)).toEqual(asked);
  });

  it("Given an answer while the switch is off Then it is dropped: nothing of the overlay is held then", () => {
    const off = run([{ type: "plant_truth_switched", on: false }], asked);
    expect(run([{ type: "plant_truth_view", id: 30, epoch: 1, view }], off).truth.breakout?.view).toBeNull();
  });

  it("Given the switch turned off Then the answer is dropped and the slot stays, so that a late answer finds its place and is not kept", () => {
    const answered = run([{ type: "plant_truth_view", id: 30, epoch: 1, view }], asked);
    const off = run([{ type: "plant_truth_switched", on: false }], answered);
    expect(off.truth.on).toBe(false);
    expect(off.truth.breakout).toEqual({ id: 30, epoch: 1, view: null, problem: null });
  });

  it("Given an error about the request Then it is the overlay's problem (the slot says it) and the plant has none", () => {
    const s = run([{ type: "error", id: 30, code: "refused", message: "not a case", epoch: 1 }], asked);
    expect(s.truth.breakout?.problem).toEqual({ code: "refused", message: "not a case" });
    expect(s.problem).toBeNull();
  });

  it("Given a new plan Then the answer about the old one goes with it (the switch stays as the reader left it)", () => {
    const answered = run([{ type: "plant_truth_view", id: 30, epoch: 1, view }], asked);
    const next = run([{ type: "plant_started", id: 8, epoch: 2, spec: CASE }, ready(8, 2)], answered);
    expect(next.truth).toEqual({ on: true, halls: null, sample: null });
  });
});
