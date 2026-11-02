import { describe, expect, it } from "vitest";
import type { LineageView } from "../protocol.ts";
import { DEFAULT_PLANT } from "../plant/spec.ts";
import { initial, reduce } from "./state.ts";
import type { Action, State } from "./state.ts";

// P5c (docs/design/plant_ui.md section 7, "As built in P5c"; lab_ui.md section 4, rule 2): a challenge on a run clears what the page holds of that run's truth. Since audit A1 (F7, rework of
// 2026-11-02) the run is named by the Worker: the answers whose views the page holds (`lineage`, `plant_ready`) and the challenge's own answer (`challenge_ready`) carry the key of the truth of
// their run, and the page compares the keys it was given, with no copy of the engine. The view of a run with the challenge's key is emptied when the challenge's answer arrives (its record
// arrives with it, so the two are never on screen together); a run with another key is left as it is; a request made after it is `locked` as before.

const view = { sample: { sample_id: "S1", unit_id: "U1", picked_by: "reader" }, truth: { unit_id: "U1", sampled_at: 1, context: { feed_epoch: 0, batch_phase: "before_shift" } }, columns: [] } as LineageView;
const apply = (state: State, ...actions: Action[]): State => actions.reduce(reduce, state);
const META = { variant: "sample" as const, scenario: "default", seed: 1, shown: "a_manual" };
/** Keys as the Worker gives them (engine/src/experiments/assembly/lab/truth_key.ts); test-only values. */
const KEY = "00000000000000a1";
const OTHER = "00000000000000b2";
const starting: Action = { type: "challenge_starting", id: 5, meta: META };
const challengeReady = (key: string): Action => ({ type: "challenge_ready", id: 5, challenge: "challenge-1", announced_type: "label_error", record: {} as never, inputs: [], key });
const asked = { scenario: "default", seed: 1, architectures: ["a_manual"] };
const shown = apply(initial, { type: "lineage_started", id: 3, asked }, { type: "lineage", id: 3, view, sample_ids: ["S1"], key: KEY });

describe("the lineage view", () => {
  it("Given a view of a run on screen Then the challenge's answer with that run's key empties it, and the screen keeps what it asked", () => {
    const s = apply(shown, starting, challengeReady(KEY));
    expect(s.lineage.answer).toBeNull();
    expect(s.lineage.asked).toEqual(asked);
    expect(s.lineage.problem).toBeNull();
    expect(s.challenge.active?.challenge).toBe("challenge-1");
  });

  it("Given a challenge only asked for Then the view stays until its answer names the run; given an answer with another key Then it stays", () => {
    expect(apply(shown, starting).lineage).toEqual(shown.lineage);
    expect(apply(shown, starting, challengeReady(OTHER)).lineage).toEqual(shown.lineage);
  });

  it("Given a request for the same run sent before the challenge Then the Worker answers it first, and the challenge's answer empties it", () => {
    const s = apply(initial, { type: "lineage_started", id: 4, asked }, starting, { type: "lineage", id: 4, view, sample_ids: ["S1"], key: KEY }, challengeReady(KEY));
    expect(s.lineage.answer).toBeNull();
    expect(s.lineage.running).toBeNull();
  });

  it("Given a request made after the challenge Then it is a request like any other: the Worker's answer is kept, and `locked` is shown as the problem", () => {
    const locked = apply(shown, starting, challengeReady(KEY), { type: "lineage_started", id: 6, asked }, { type: "error", id: 6, code: "locked", message: "open challenge" });
    expect(locked.lineage.problem).toEqual({ id: 6, code: "locked", message: "open challenge" });
    expect(locked.lineage.answer).toBeNull();
  });
});

describe("the truth overlay of the plant", () => {
  const plan = { schema_version: "1", seed: 1, horizon_s: 0, layout: { bays: [], analyzers: [], architectures: ["a_manual"] }, units: [], analyzers: [], staff: [], samples: [], marks: [], windows: [], calibrations: [], records: [] } as never;
  const halls = { kind: "halls" as const, halls: [{ architecture: "a_manual", placeholders: [] }] };
  const onScreen = apply(
    initial,
    { type: "plant_started", id: 7, epoch: 1, spec: DEFAULT_PLANT },
    { type: "plant_ready", id: 7, epoch: 1, plan, resume_at: 0, hashes: { truth: "t", cells: {} }, checks: { prefix_equal: null, truth_equal: null }, key: KEY },
    { type: "plant_truth_switched", on: true },
    { type: "plant_truth_started", id: 20, epoch: 1, pick: { halls: true } },
    { type: "plant_truth_view", id: 20, epoch: 1, view: halls },
  );

  it("Given an overlay on screen Then the challenge's answer with the plant's key empties it and the slot says locked", () => {
    expect(onScreen.plant.truth.halls?.view).toEqual(halls);
    const s = apply(onScreen, starting, challengeReady(KEY));
    expect(s.plant.truth.halls).toMatchObject({ id: 20, view: null, problem: { code: "locked" } });
    expect(s.plant.truth.on).toBe(true);
    expect(s.plant.ready).toBe(onScreen.plant.ready);
  });

  it("Given a challenge on another run Then the overlay stays", () => {
    expect(apply(onScreen, starting, challengeReady(OTHER)).plant).toEqual(onScreen.plant);
  });
});
