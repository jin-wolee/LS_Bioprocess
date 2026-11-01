import { describe, expect, it } from "vitest";
import type { Response, ScenePlan } from "../protocol.ts";
import { runKeyOf } from "../ui/run_key.ts";
import { initialPlant, needsRun, reducePlant } from "./plant_state.ts";
import type { PlantAction, PlantState } from "./plant_state.ts";
import { DEFAULT_PLANT as SPEC } from "./spec.ts";

// P5c (docs/design/plant_ui.md section 7, "As built in P5c"): the page store keeps the plant. The spec of the newest request and the clock instant and lens at the moment the reader left are what a
// drill-down and Back need; a run is asked for only when the spec the route wants is not the spec of the newest request; a challenge started on the run empties the overlay.

const plan = (): ScenePlan => ({ schema_version: "1", seed: 1, horizon_s: 0, layout: { bays: [], analyzers: [], architectures: ["a", "c_context"] }, units: [], analyzers: [], staff: [], samples: [], marks: [], windows: [], calibrations: [], records: [{ architecture: "a", flags_on: [], cards: [] }] });
const ready = (id: number, epoch: number): Extract<Response, { type: "plant_ready" }> => ({ type: "plant_ready", id, epoch, plan: plan(), resume_at: 0, hashes: { truth: "t", cells: { a: "c" } }, checks: { prefix_equal: null, truth_equal: null } });
const run = (actions: PlantAction[], from: PlantState = initialPlant): PlantState => actions.reduce(reducePlant, from);

const FEED = { kind: "add_feed" as const, at: 291600, unit_id: "U03" };
const spec = (extra: Partial<typeof SPEC> = {}): typeof SPEC => ({ ...SPEC, ...extra });
const answered = run([{ type: "plant_started", id: 7, epoch: 1, spec: SPEC }, ready(7, 1)]);
const truthHalls = { kind: "halls" as const, halls: [{ architecture: "a", placeholders: [{ sample: 3, why: "not_recorded" as const }] }] };
const truthSample = {
  kind: "sample" as const, sample: { sample_id: "U07-D06-1", unit_id: "U07", picked_by: "reader" as const }, truth: { unit_id: "U07", sampled_at: 5, context: { feed_epoch: 1, batch_phase: "before_shift" } },
  columns: [],
};

describe("the spec of the newest request", () => {
  it("Given a request Then its spec is the plant's spec, and a newer request replaces it", () => {
    expect(answered.spec).toEqual(SPEC);
    expect(run([{ type: "plant_started", id: 8, epoch: 2, spec: spec({ seed: 2 }) }], answered).spec?.seed).toBe(2);
  });
});

describe("whether a run is asked for", () => {
  it("Given nothing asked yet Then the default plant has to be asked for", () => {
    expect(needsRun(initialPlant, SPEC)).toBe(true);
  });

  it("Given a run on its way or answered under this very spec Then nothing is asked again: entering the plant a second time, by Back or by the navigation, sends no plant_run", () => {
    expect(needsRun(run([{ type: "plant_started", id: 7, epoch: 1, spec: SPEC }]), SPEC)).toBe(false);
    expect(needsRun(answered, SPEC)).toBe(false);
    const away = run([{ type: "plant_left", t: 305626, lens: "c_context" }], answered);
    expect(needsRun(away, structuredClone(SPEC))).toBe(false);
  });

  it("Given a spec that differs in the seed, the actions or the halls Then a run is asked for", () => {
    expect(needsRun(answered, spec({ seed: 2 }))).toBe(true);
    expect(needsRun(answered, spec({ actions: [FEED] }))).toBe(true);
    expect(needsRun(answered, spec({ run: { ...SPEC.run, architectures: ["a_manual"] } }))).toBe(true);
  });

  it("Given the same actions in another order Then nothing is asked again", () => {
    const two = spec({ actions: [FEED, { ...FEED, at: 295200 }] });
    const asked = run([{ type: "plant_started", id: 7, epoch: 1, spec: two }]);
    expect(needsRun(asked, spec({ actions: [{ ...FEED, at: 295200 }, FEED] }))).toBe(false);
  });

  it("Given a run that failed under this spec Then it is not asked for again (no retry loop), and a different spec is", () => {
    const failed = run([{ type: "error", id: 7, epoch: 1, code: "refused", reason: "unknown_target", index: 0, message: "no unit" }], run([{ type: "plant_started", id: 7, epoch: 1, spec: spec({ actions: [FEED] }) }]));
    expect(failed.problem).not.toBeNull();
    expect(needsRun(failed, spec({ actions: [FEED] }))).toBe(false);
    expect(needsRun(failed, SPEC)).toBe(true);
  });
});

describe("the view the reader left", () => {
  it("Given the reader leaves the plant Then the instant and the lens are kept, the panels are closed, and the plan, the halls and the overlay are not touched", () => {
    const open = run([
      { type: "plant_record_started", id: 9, epoch: 1, architecture: "c_context", sample_id: "U07-D06-1" },
      { type: "plant_record_started", id: 10, epoch: 1, architecture: "c_context", sample_id: "U07-D06-1", role: "fields" },
      { type: "plant_truth_switched", on: true },
    ], answered);
    const away = run([{ type: "plant_left", t: 305626, lens: "c_context" }], open);
    expect(away.view).toEqual({ t: 305626, lens: "c_context" });
    expect([away.record, away.fields]).toEqual([null, null]);
    expect([away.ready, away.halls, away.truth, away.spec]).toEqual([open.ready, open.halls, open.truth, open.spec]);
  });

  it("Given a second visit that leaves again Then the view is the later one", () => {
    expect(run([{ type: "plant_left", t: 10, lens: "a" }, { type: "plant_left", t: 20, lens: "c_context" }], answered).view).toEqual({ t: 20, lens: "c_context" });
  });

  it("Given a new request under the same spec Then the view stays; under another spec it goes (an instant of the old run means nothing in the new one)", () => {
    const away = run([{ type: "plant_left", t: 305626, lens: "c_context" }], answered);
    expect(run([{ type: "plant_started", id: 8, epoch: 2, spec: structuredClone(SPEC) }], away).view).toEqual({ t: 305626, lens: "c_context" });
    expect(run([{ type: "plant_started", id: 8, epoch: 2, spec: spec({ seed: 2 }) }], away).view).toBeNull();
  });
});

describe("a challenge started on the run", () => {
  const key = runKeyOf(SPEC.run, SPEC.seed);
  const on = run([
    { type: "plant_truth_switched", on: true },
    { type: "plant_truth_started", id: 20, epoch: 1, pick: { halls: true } }, { type: "plant_truth_view", id: 20, epoch: 1, view: truthHalls },
    { type: "plant_truth_started", id: 23, epoch: 1, pick: { sample_id: "U07-D06-1" } }, { type: "plant_truth_view", id: 23, epoch: 1, view: truthSample },
  ], answered);

  it("Given an overlay on screen Then both of its answers are emptied and each slot says locked, as a new request would be", () => {
    expect(on.truth.halls?.view).not.toBeNull();
    const locked = run([{ type: "plant_run_locked", key }], on);
    expect(locked.truth.on).toBe(true);
    expect(locked.truth.halls).toMatchObject({ id: 20, epoch: 1, view: null, problem: { code: "locked" } });
    expect(locked.truth.sample).toMatchObject({ id: 23, epoch: 1, sample_id: "U07-D06-1", view: null, problem: { code: "locked" } });
    expect(locked.ready).toBe(on.ready);
  });

  it("Given an answer of a request made before the challenge that arrives after it Then it is dropped: the overlay of a locked run is not filled again", () => {
    const asked = run([{ type: "plant_truth_switched", on: true }, { type: "plant_truth_started", id: 24, epoch: 1, pick: { halls: true } }], answered);
    const locked = run([{ type: "plant_run_locked", key }], asked);
    expect(run([{ type: "plant_truth_view", id: 24, epoch: 1, view: truthHalls }], locked)).toEqual(locked);
  });

  it("Given a challenge on another run (another seed, other settings) Then the overlay is untouched", () => {
    expect(run([{ type: "plant_run_locked", key: runKeyOf(SPEC.run, 2) }], on)).toEqual(on);
    expect(run([{ type: "plant_run_locked", key: runKeyOf({ ...SPEC.run, settings: { reactor_count: 6 } }, SPEC.seed) }], on)).toEqual(on);
  });

  it("Given no plant asked yet, or nothing asked of the overlay Then there is nothing to empty and the state is the same", () => {
    expect(run([{ type: "plant_run_locked", key }], initialPlant)).toEqual(initialPlant);
    expect(run([{ type: "plant_run_locked", key }], answered)).toEqual(answered);
  });

  it("Given the reader presses the switch again after the lock Then a new request is made as before, and the Worker's answer is the one that counts", () => {
    const locked = run([{ type: "plant_run_locked", key }], on);
    const again = run([{ type: "plant_truth_started", id: 30, epoch: 1, pick: { halls: true } }, { type: "plant_truth_view", id: 30, epoch: 1, view: truthHalls }], locked);
    expect(again.truth.halls).toEqual({ id: 30, epoch: 1, view: truthHalls, problem: null });
  });
});
