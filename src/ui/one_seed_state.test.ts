import { describe, expect, it } from "vitest";
import type { LineageView, RecordView, Response, Reveal } from "../protocol.ts";
import { initial, reduce } from "./state.ts";
import type { State } from "./state.ts";

// What the page keeps of the one-seed screens (lab_ui.md sections 8 and 9), folded from the Worker's messages by the reducer. The rules: a message goes to the screen whose request it
// answers; a refusal of the lineage (`locked`) is the problem of the Lineage screen, not of the run in flight; the reveal exists on the page only after the guess or the give-up.

const view = { sample: { sample_id: "S1", unit_id: "U1", picked_by: "reader" }, truth: { unit_id: "U1", sampled_at: 1, context: { feed_epoch: 0, batch_phase: "before_shift" } }, columns: [] } as LineageView;
const record = { architecture: "a_manual", flags_on: [], samples: [], results: [], findings: [], audit_events: [], ubiquitous: [] } as RecordView;
const reveal = { planted: { type: "label_error", affected: ["S1", "S2"], detail: {} }, score: null, per_architecture: [], lineage: view } as Reveal;
const META = { variant: "sample" as const, scenario: "default", seed: 7, shown: "a_manual" };

const apply = (state: State, ...actions: Parameters<typeof reduce>[1][]): State => actions.reduce(reduce, state);
const started = apply(initial, { type: "challenge_starting", id: 5, meta: META, key: "k" });
const playing = apply(started, { type: "challenge_ready", id: 5, challenge: "challenge-1", announced_type: "label_error", record, inputs: [] });

describe("lineage", () => {
  const asked = { scenario: "sc03_feed_in_gap", seed: 1, architectures: ["a_manual"], key: "k" };

  it("Given a request and its answer Then the view is kept with what was asked, and the request is over", () => {
    const s = apply(initial, { type: "lineage_started", id: 3, asked }, { type: "lineage", id: 3, view, sample_ids: ["S1"] });
    expect(s.lineage).toEqual({ running: null, asked, answer: { view, sample_ids: ["S1"] }, problem: null });
  });

  it("Given an answer to another request Then it is ignored", () => {
    const s = apply(initial, { type: "lineage_started", id: 3, asked }, { type: "lineage", id: 4, view, sample_ids: [] });
    expect(s.lineage.answer).toBeNull();
    expect(s.lineage.running).toBe(3);
  });

  it("Given the refusal `locked` Then it is the problem of the Lineage screen and the global problem and the run in flight are untouched", () => {
    const running = apply(initial, { type: "run_started", id: 2 }, { type: "lineage_started", id: 3, asked });
    const s = apply(running, { type: "error", id: 3, code: "locked", message: "this run is a challenge that has not been revealed" });
    expect(s.lineage.problem).toEqual({ id: 3, code: "locked", message: "this run is a challenge that has not been revealed" });
    expect(s.lineage.running).toBeNull();
    expect(s.problem).toBeNull();
    expect(s.running).toBe(2);
  });

  it("Given a new request Then the earlier answer and problem are cleared (what is on screen belongs to the request that made it)", () => {
    const s = apply(initial, { type: "lineage_started", id: 3, asked }, { type: "lineage", id: 3, view, sample_ids: [] }, { type: "lineage_started", id: 4, asked });
    expect(s.lineage.answer).toBeNull();
    expect(s.lineage.running).toBe(4);
  });
});

describe("challenge", () => {
  it("Given a start Then the page waits for it, progress between the two loops is kept, and the record arrives with the id of the challenge", () => {
    const s = apply(started, { type: "progress", id: 5, done: 1, total: 2 });
    expect(s.challenge.starting).toMatchObject({ id: 5, done: 1, total: 2 });
    expect(playing.challenge.starting).toBeNull();
    expect(playing.challenge.active).toMatchObject({ challenge: "challenge-1", announced_type: "label_error", shown: "a_manual", seed: 7, opened: null, reveal: null });
  });

  it("Given a message for another request Then it changes nothing", () => {
    const s = apply(started, { type: "challenge_ready", id: 9, challenge: "challenge-2", announced_type: "x", record, inputs: [] });
    expect(s.challenge.active).toBeNull();
  });

  it("Given a drill-down Then it is kept beside the sample it was asked for", () => {
    const column = { architecture: "a_manual", flags_on: [], labelling: "handwritten", nodes: [], edges: [] };
    const s = apply(playing, { type: "challenge_busy", busy: { id: 6, kind: "open", sample_id: "S4" } }, { type: "sample_record", id: 6, sample: column });
    expect(s.challenge.active?.opened).toEqual({ sample_id: "S4", sample: column });
    expect(s.challenge.busy).toBeNull();
  });

  it("Given a playing challenge Then there is no reveal on the page; it arrives with the answer to the guess and only then", () => {
    expect(playing.challenge.active?.reveal).toBeNull();
    const asked = apply(playing, { type: "challenge_busy", busy: { id: 7, kind: "guess" } });
    expect(asked.challenge.active?.reveal).toBeNull();
    const done = apply(asked, { type: "challenge_reveal", id: 7, reveal });
    expect(done.challenge.active?.reveal).toBe(reveal);
  });

  it("Given a reveal that answers no request of the page Then it is not kept", () => {
    const s = apply(playing, { type: "challenge_reveal", id: 99, reveal } as Response);
    expect(s.challenge.active?.reveal).toBeNull();
  });

  it("Given a refused start or guess Then the problem is the challenge's, and a refused start leaves no half-started challenge", () => {
    const refused = apply(started, { type: "error", id: 5, code: "invalid_spec", message: "C cannot be shown" });
    expect(refused.challenge.problem?.message).toBe("C cannot be shown");
    expect(refused.challenge.starting).toBeNull();
    expect(refused.problem).toBeNull();
    const bad = apply(playing, { type: "challenge_busy", busy: { id: 8, kind: "guess" } }, { type: "error", id: 8, code: "invalid_spec", message: "no such sample" });
    expect(bad.challenge.problem?.message).toBe("no such sample");
    expect(bad.challenge.active?.reveal).toBeNull();
  });

  it("Given the reader chooses another challenge Then everything of the first is gone", () => {
    expect(apply(playing, { type: "challenge_reset" }).challenge).toEqual({ starting: null, active: null, busy: null, problem: null });
  });
});

describe("breakout (S3g)", () => {
  const asked = { case: "sc12_medium_lot", seed: 9013, architectures: ["a_manual", "c_context"] };
  const result = { kind: "simulation_result", case: "sc12_medium_lot", scenario: "sc12_medium_lot", seed: 9013, per_architecture: [] } as unknown as Extract<Response, { type: "breakout_result" }>["result"];

  it("Given a request and its answer Then the result is kept with what was asked, and the request is over", () => {
    const s = apply(initial, { type: "breakout_started", id: 3, asked }, { type: "breakout_result", id: 3, result });
    expect(s.breakout).toEqual({ running: null, asked, result, problem: null });
  });

  it("Given an answer to another request Then it is ignored", () => {
    const s = apply(initial, { type: "breakout_started", id: 3, asked }, { type: "breakout_result", id: 4, result });
    expect(s.breakout.result).toBeNull();
    expect(s.breakout.running).toBe(3);
  });

  it("Given a refusal of the request Then it is the problem of the Break-out screen and not of a run in flight", () => {
    const s = apply(reduce(initial, { type: "run_started", id: 2 }), { type: "breakout_started", id: 3, asked }, { type: "error", id: 3, code: "invalid_spec", message: "unknown case" });
    expect(s.breakout).toMatchObject({ running: null, result: null, problem: { id: 3, code: "invalid_spec", message: "unknown case" } });
    expect(s.problem).toBeNull();
    expect(s.running).toBe(2);
  });

  it("Given a new request Then the earlier result and problem are cleared, so a result on screen belongs to the request that made it", () => {
    const first = apply(initial, { type: "breakout_started", id: 3, asked }, { type: "breakout_result", id: 3, result });
    const next = reduce(first, { type: "breakout_started", id: 4, asked: { ...asked, seed: 9127 } });
    expect(next.breakout).toEqual({ running: 4, asked: { ...asked, seed: 9127 }, result: null, problem: null });
  });

  it("Given a message for the other screens Then the break-out state does not move", () => {
    const s = apply(initial, { type: "breakout_started", id: 3, asked }, { type: "lineage", id: 9, view, sample_ids: [] });
    expect(s.breakout.running).toBe(3);
  });
});
