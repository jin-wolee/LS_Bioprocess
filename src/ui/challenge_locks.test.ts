import { describe, expect, it } from "vitest";
import type { LineageView } from "../protocol.ts";
import { DEFAULT_PLANT } from "../plant/spec.ts";
import { runKeyOf } from "./run_key.ts";
import { initial, reduce } from "./state.ts";
import type { Action, State } from "./state.ts";

// P5c (docs/design/plant_ui.md section 7, "As built in P5c"; lab_ui.md section 4, rule 2): a challenge started on a run clears what the page holds of that run's truth. The lineage view and the truth
// overlay of the same scenario, settings, lists, capture path and seed are emptied when the challenge starts (the review of P5b: a view fetched before the challenge stayed in the store), and a
// request made after it is `locked` as before. A run with another seed or other settings is another run and is left as it is.

const view = { sample: { sample_id: "S1", unit_id: "U1", picked_by: "reader" }, truth: { unit_id: "U1", sampled_at: 1, context: { feed_epoch: 0, batch_phase: "before_shift" } }, columns: [] } as LineageView;
const apply = (state: State, ...actions: Action[]): State => actions.reduce(reduce, state);
const META = { variant: "sample" as const, scenario: "default", seed: 1, shown: "a_manual" };
const KEY = runKeyOf({ scenario: "default", settings: {} }, 1);
const asked = { scenario: "default", seed: 1, architectures: ["a_manual"], key: KEY };
const shown = apply(initial, { type: "lineage_started", id: 3, asked }, { type: "lineage", id: 3, view, sample_ids: ["S1"] });

describe("the lineage view", () => {
  it("Given a view of a run on screen Then a challenge started on that run empties it, and the screen keeps what it asked", () => {
    const s = apply(shown, { type: "challenge_starting", id: 5, meta: META, key: KEY });
    expect(s.lineage.answer).toBeNull();
    expect(s.lineage.asked).toEqual(asked);
    expect(s.lineage.problem).toBeNull();
    expect(s.challenge.starting?.id).toBe(5);
  });

  it("Given a challenge on another seed, or on the same seed with other settings Then the view stays", () => {
    expect(apply(shown, { type: "challenge_starting", id: 5, meta: { ...META, seed: 2 }, key: runKeyOf({ scenario: "default", settings: {} }, 2) }).lineage).toEqual(shown.lineage);
    expect(apply(shown, { type: "challenge_starting", id: 5, meta: META, key: runKeyOf({ scenario: "default", settings: { reactor_count: 6 } }, 1) }).lineage).toEqual(shown.lineage);
  });

  it("Given a request for the same run still in flight when the challenge starts Then its answer is dropped when it arrives", () => {
    const inFlight = apply(initial, { type: "lineage_started", id: 4, asked });
    const s = apply(inFlight, { type: "challenge_starting", id: 5, meta: META, key: KEY }, { type: "lineage", id: 4, view, sample_ids: ["S1"] });
    expect(s.lineage.answer).toBeNull();
    expect(s.lineage.running).toBeNull();
  });

  it("Given a request made after the challenge started Then it is a request like any other: the Worker's answer is kept, and `locked` is shown as the problem", () => {
    const locked = apply(shown, { type: "challenge_starting", id: 5, meta: META, key: KEY }, { type: "lineage_started", id: 6, asked }, { type: "error", id: 6, code: "locked", message: "open challenge" });
    expect(locked.lineage.problem).toEqual({ id: 6, code: "locked", message: "open challenge" });
    expect(locked.lineage.answer).toBeNull();
  });
});

describe("the truth overlay of the plant", () => {
  const key = runKeyOf(DEFAULT_PLANT.run, DEFAULT_PLANT.seed);
  const plan = { schema_version: "1", seed: 1, horizon_s: 0, layout: { bays: [], analyzers: [], architectures: ["a_manual"] }, units: [], analyzers: [], staff: [], samples: [], marks: [], windows: [], calibrations: [], records: [] } as never;
  const halls = { kind: "halls" as const, halls: [{ architecture: "a_manual", placeholders: [] }] };
  const onScreen = apply(
    initial,
    { type: "plant_started", id: 7, epoch: 1, spec: DEFAULT_PLANT },
    { type: "plant_ready", id: 7, epoch: 1, plan, resume_at: 0, hashes: { truth: "t", cells: {} }, checks: { prefix_equal: null, truth_equal: null } },
    { type: "plant_truth_switched", on: true },
    { type: "plant_truth_started", id: 20, epoch: 1, pick: { halls: true } },
    { type: "plant_truth_view", id: 20, epoch: 1, view: halls },
  );

  it("Given an overlay on screen Then a challenge started on the run empties it and the slot says locked", () => {
    expect(onScreen.plant.truth.halls?.view).toEqual(halls);
    const s = apply(onScreen, { type: "challenge_starting", id: 5, meta: META, key });
    expect(s.plant.truth.halls).toMatchObject({ id: 20, view: null, problem: { code: "locked" } });
    expect(s.plant.truth.on).toBe(true);
    expect(s.plant.ready).toBe(onScreen.plant.ready);
  });

  it("Given a challenge on another run Then the overlay stays", () => {
    expect(apply(onScreen, { type: "challenge_starting", id: 5, meta: { ...META, seed: 9 }, key: runKeyOf(DEFAULT_PLANT.run, 9) }).plant).toEqual(onScreen.plant);
  });
});
