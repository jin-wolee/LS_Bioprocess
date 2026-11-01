import { describe, expect, it } from "vitest";
import type { Response, ScenePlan } from "../protocol.ts";
import { initialPlant, reducePlant } from "./plant_state.ts";
import type { PlantAction, PlantState } from "./plant_state.ts";
import { DEFAULT_PLANT as SPEC } from "./spec.ts";

// docs/design/plant_ui.md section 5.5 and section 6, rule 3: the page asks for a plan under an epoch and drops every answer, and every error, whose epoch is not the newest it asked for. The plan
// it already has stays drawn until the newer one arrives.

const plan = (seed: number): ScenePlan => ({ schema_version: "1", seed, horizon_s: 0, layout: { bays: [], analyzers: [], architectures: [] }, units: [], analyzers: [], staff: [], samples: [], marks: [], windows: [], calibrations: [], records: [] });
const ready = (id: number, epoch: number, seed = epoch): Extract<Response, { type: "plant_ready" }> => ({
  type: "plant_ready", id, epoch, plan: plan(seed), resume_at: 0, hashes: { truth: `t${epoch}`, cells: { a_manual: `c${epoch}` } }, checks: { prefix_equal: null, truth_equal: null },
});
const run = (actions: PlantAction[], from: PlantState = initialPlant): PlantState => actions.reduce(reducePlant, from);

describe("the plant state", () => {
  it("Given nothing asked Then there is no epoch, no plan and no problem", () => {
    expect(initialPlant).toEqual({ epoch: 0, spec: null, view: null, running: null, ready: null, halls: [], record: null, fields: null, truth: { on: false, halls: null, sample: null }, problem: null });
  });

  it("Given a request is made Then its epoch is the newest and the request is running", () => {
    expect(run([{ type: "plant_started", id: 7, epoch: 1, spec: SPEC }])).toEqual({ epoch: 1, spec: SPEC, view: null, running: 7, ready: null, halls: [], record: null, fields: null, truth: { on: false, halls: null, sample: null }, problem: null });
  });

  it("Given the answer of the newest epoch Then the plan, the hashes and the checks are kept and nothing is running", () => {
    const s = run([{ type: "plant_started", id: 7, epoch: 1, spec: SPEC }, ready(7, 1)]);
    expect(s.running).toBeNull();
    expect(s.ready).toEqual({ epoch: 1, plan: plan(1), resume_at: 0, hashes: { truth: "t1", cells: { a_manual: "c1" } }, checks: { prefix_equal: null, truth_equal: null } });
  });

  it("Given two requests and the answer of the older arriving after the newer was asked for Then the older answer is dropped and the newer one is drawn when it arrives", () => {
    const asked = run([{ type: "plant_started", id: 7, epoch: 1, spec: SPEC }, { type: "plant_started", id: 8, epoch: 2, spec: SPEC }]);
    const stale = run([ready(7, 1)], asked);
    expect(stale).toEqual(asked); // nothing changed: the stale answer is not drawn
    expect(stale.ready).toBeNull();
    const fresh = run([ready(8, 2)], stale);
    expect(fresh.ready?.epoch).toBe(2);
    expect(fresh.ready?.plan.seed).toBe(2);
  });

  it("Given a plan on screen and a newer request Then the plan stays until the newer answer replaces it", () => {
    const first = run([{ type: "plant_started", id: 7, epoch: 1, spec: SPEC }, ready(7, 1)]);
    const asked = run([{ type: "plant_started", id: 8, epoch: 2, spec: SPEC }], first);
    expect(asked.ready?.epoch).toBe(1);
    expect(asked.running).toBe(8);
    expect(run([ready(8, 2)], asked).ready?.epoch).toBe(2);
  });

  it("Given an error of the newest epoch Then it is the problem, with its reason and the index of the action; the next request clears it", () => {
    const asked = run([{ type: "plant_started", id: 7, epoch: 1, spec: SPEC }]);
    const failed = run([{ type: "error", id: 7, epoch: 1, code: "refused", message: "no such unit", reason: "unknown_target", index: 2 }], asked);
    expect(failed.problem).toEqual({ code: "refused", message: "no such unit", reason: "unknown_target", index: 2 });
    expect(failed.running).toBeNull();
    expect(run([{ type: "plant_started", id: 8, epoch: 2, spec: SPEC }], failed).problem).toBeNull();
  });

  it("Given the error of an older epoch (a run that was cancelled) Then it is dropped", () => {
    const asked = run([{ type: "plant_started", id: 7, epoch: 1, spec: SPEC }, { type: "plant_started", id: 8, epoch: 2, spec: SPEC }]);
    const after = run([{ type: "error", id: 7, epoch: 1, code: "cancelled", message: "replaced" }], asked);
    expect(after).toEqual(asked);
  });

  it("Given a message that is not about the plant Then the state is unchanged", () => {
    const s = run([{ type: "plant_started", id: 7, epoch: 1, spec: SPEC }]);
    expect(reducePlant(s, { type: "progress", id: 3, done: 1, total: 2 })).toBe(s);
    expect(reducePlant(s, { type: "error", id: 3, code: "engine_error", message: "x" })).toBe(s);
  });
});

// P5a (docs/design/plant_ui.md sections 5.5 and 6): the halls that come after plant_ready are merged as they arrive, in the order of the layout, and a hall of an epoch that is not the one on screen is dropped;
// the record panel asks for one card under the epoch of the plan on screen and shows the answer of that request only.

const hall = (architecture: string) => ({ architecture, flags_on: [], cards: [] });
const withHalls = (epoch: number, architectures: string[], shown: string[]): Extract<Response, { type: "plant_ready" }> => ({
  ...ready(7, epoch),
  plan: { ...plan(epoch), layout: { bays: [], analyzers: [], architectures }, records: shown.map(hall) },
  hashes: { truth: `t${epoch}`, cells: Object.fromEntries(shown.map((a) => [a, `c-${a}`])) },
});
const halls = (id: number, epoch: number, architecture: string): Extract<Response, { type: "plant_halls" }> => ({ type: "plant_halls", id, epoch, records: [hall(architecture)], cells: { [architecture]: `c-${architecture}` } });
const sample = { architecture: "c_context", flags_on: [], labelling: "x", nodes: [], edges: [] };

describe("the halls that come after plant_ready", () => {
  const asked = run([{ type: "plant_started", id: 7, epoch: 1, spec: SPEC }, withHalls(1, ["a", "b", "c"], ["a"])]);

  it("Given the first answer with one hall Then the plan holds that hall and no other hall has arrived", () => {
    expect(asked.ready?.plan.records.map((r) => r.architecture)).toEqual(["a"]);
    expect(asked.halls).toEqual([]);
  });

  it("Given plant_halls for b and then c of the same epoch Then they are merged as they arrive, the plan on screen is the very same object, and the digests join those of the first hall", () => {
    const s = run([halls(7, 1, "b"), halls(7, 1, "c")], asked);
    expect(s.halls.map((r) => r.architecture)).toEqual(["b", "c"]);
    expect(s.ready?.plan).toBe(asked.ready?.plan);
    expect(s.ready?.hashes.cells).toEqual({ a: "c-a", b: "c-b", c: "c-c" });
    expect(run([halls(7, 1, "b")], asked).ready?.hashes.cells).toEqual({ a: "c-a", b: "c-b" });
  });

  it("Given a hall of an older epoch arriving after a newer request was made Then it is dropped", () => {
    const newer = run([{ type: "plant_started", id: 8, epoch: 2, spec: SPEC }], asked);
    expect(run([halls(7, 1, "b")], newer)).toEqual(newer);
  });

  it("Given a hall of an epoch whose plant_ready has not arrived Then it is dropped, and a hall that is already merged is not merged twice", () => {
    const waiting = run([{ type: "plant_started", id: 7, epoch: 1, spec: SPEC }]);
    expect(run([halls(7, 1, "b")], waiting)).toEqual(waiting);
    const once = run([halls(7, 1, "b")], asked);
    expect(run([halls(7, 1, "b")], once)).toEqual(once);
  });

  it("Given a newer answer Then its plan replaces the plan on screen and the halls of the older plan go with it", () => {
    const s = run([halls(7, 1, "b"), { type: "plant_started", id: 8, epoch: 2, spec: SPEC }, withHalls(2, ["a", "b", "c"], ["a"])], asked);
    expect(s.ready?.epoch).toBe(2);
    expect(s.halls).toEqual([]);
  });
});

describe("the record panel", () => {
  const shown = run([{ type: "plant_started", id: 7, epoch: 1, spec: SPEC }, withHalls(1, ["a", "c_context"], ["a"])]);
  const opened = run([{ type: "plant_record_started", id: 9, epoch: 1, architecture: "c_context", sample_id: "U07-D06-1" }], shown);

  it("Given no card picked Then there is no record", () => {
    expect(shown.record).toBeNull();
  });

  it("Given a card picked Then the request is remembered with its epoch, the architecture and the sample, and waits for its answer", () => {
    expect(opened.record).toEqual({ id: 9, epoch: 1, architecture: "c_context", sample_id: "U07-D06-1", view: null, problem: null });
  });

  it("Given the answer of that request Then the view is kept; the answer of another request, or of an older epoch, is dropped", () => {
    expect(run([{ type: "plant_record_view", id: 9, epoch: 1, sample }], opened).record?.view).toEqual(sample);
    expect(run([{ type: "plant_record_view", id: 10, epoch: 1, sample }], opened)).toEqual(opened);
    expect(run([{ type: "plant_record_view", id: 9, epoch: 0, sample }], opened)).toEqual(opened);
    const newer = run([{ type: "plant_started", id: 8, epoch: 2, spec: SPEC }], opened);
    expect(run([{ type: "plant_record_view", id: 9, epoch: 1, sample }], newer).record?.view).toBeNull();
  });

  it("Given a refusal of the record request Then it is the problem of the record panel, not of the plant; the plan stays and nothing is running", () => {
    const refused = run([{ type: "error", id: 9, epoch: 1, code: "refused", reason: "unknown_target", message: "no card" }], opened);
    expect(refused.record?.problem).toEqual({ code: "refused", message: "no card", reason: "unknown_target" });
    expect(refused.problem).toBeNull();
    expect(refused.ready).toBe(opened.ready);
  });

  it("Given a stale error of a record request Then it is dropped", () => {
    const newer = run([{ type: "plant_started", id: 8, epoch: 2, spec: SPEC }], opened);
    expect(run([{ type: "error", id: 9, epoch: 1, code: "cancelled", message: "stale" }], newer)).toEqual(newer);
  });

  it("Given the panel closed (Esc) Then there is no record", () => {
    expect(run([{ type: "plant_record_closed" }], opened).record).toBeNull();
  });

  it("Given a newer answer Then the record panel is closed: its card may not be in the new run", () => {
    const s = run([{ type: "plant_started", id: 8, epoch: 2, spec: SPEC }, withHalls(2, ["a"], ["a"])], opened);
    expect(s.record).toBeNull();
  });
});

// P5b (docs/design/plant_ui.md section 3.3, "As built in P5b"): the truth overlay. The switch is off at first and nothing is asked before it is on; the page asks under the epoch of the plan on screen, keeps
// the answer of its own request only, clears the overlay when the plan changes, and shows a refusal as a problem of the overlay and not of the plant. The sample panel reads the rows of its sample in
// a slot of its own, beside the record panel's.

const truthHalls = { kind: "halls" as const, halls: [{ architecture: "a", placeholders: [{ sample: 3, why: "not_recorded" as const }] }] };
const truthSample = {
  kind: "sample" as const, sample: { sample_id: "U07-D06-1", unit_id: "U07", picked_by: "reader" as const }, truth: { unit_id: "U07", sampled_at: 5, context: { feed_epoch: 1, batch_phase: "before_shift" } },
  columns: [],
};

describe("the truth overlay", () => {
  const shown = run([{ type: "plant_started", id: 7, epoch: 1, spec: SPEC }, withHalls(1, ["a", "c_context"], ["a"])]);
  const on = run([{ type: "plant_truth_switched", on: true }], shown);

  it("Given the plan on screen and the switch not pressed Then nothing of the overlay is held", () => {
    expect(shown.truth).toEqual({ on: false, halls: null, sample: null });
  });

  it("Given the switch pressed Then it is on and still nothing has been asked; pressed again it is off", () => {
    expect(on.truth).toEqual({ on: true, halls: null, sample: null });
    expect(run([{ type: "plant_truth_switched", on: false }], on).truth.on).toBe(false);
  });

  it("Given the placeholders asked for under the epoch of the plan Then the request is remembered, and its answer is kept; the answer of another request or of another epoch is dropped", () => {
    const asked = run([{ type: "plant_truth_started", id: 20, epoch: 1, pick: { halls: true } }], on);
    expect(asked.truth.halls).toEqual({ id: 20, epoch: 1, view: null, problem: null });
    expect(run([{ type: "plant_truth_view", id: 20, epoch: 1, view: truthHalls }], asked).truth.halls?.view).toEqual(truthHalls);
    expect(run([{ type: "plant_truth_view", id: 21, epoch: 1, view: truthHalls }], asked)).toEqual(asked);
    expect(run([{ type: "plant_truth_view", id: 20, epoch: 0, view: truthHalls }], asked)).toEqual(asked);
  });

  it("Given a later request for the placeholders (another hall arrived) Then the answer of the earlier one is dropped and the later one is kept", () => {
    const first = run([{ type: "plant_truth_started", id: 20, epoch: 1, pick: { halls: true } }, { type: "plant_truth_started", id: 22, epoch: 1, pick: { halls: true } }], on);
    expect(run([{ type: "plant_truth_view", id: 20, epoch: 1, view: truthHalls }], first)).toEqual(first);
    expect(run([{ type: "plant_truth_view", id: 22, epoch: 1, view: truthHalls }], first).truth.halls?.view).toEqual(truthHalls);
  });

  it("Given a sample asked for Then its request is kept in the slot of the sample and the halls are not touched", () => {
    const s = run([{ type: "plant_truth_started", id: 20, epoch: 1, pick: { halls: true } }, { type: "plant_truth_started", id: 23, epoch: 1, pick: { sample_id: "U07-D06-1" } }, { type: "plant_truth_view", id: 23, epoch: 1, view: truthSample }], on);
    expect(s.truth.sample).toEqual({ id: 23, epoch: 1, sample_id: "U07-D06-1", view: truthSample, problem: null });
    expect(s.truth.halls).toEqual({ id: 20, epoch: 1, view: null, problem: null });
  });

  it("Given locked Then it is the problem of the overlay (the switch says so), the plant has no problem and the plan stays", () => {
    const asked = run([{ type: "plant_truth_started", id: 20, epoch: 1, pick: { halls: true } }], on);
    const locked = run([{ type: "error", id: 20, epoch: 1, code: "locked", message: "a challenge is open" }], asked);
    expect(locked.truth.halls?.problem).toEqual({ code: "locked", message: "a challenge is open" });
    expect(locked.problem).toBeNull();
    expect(locked.ready).toBe(asked.ready);
  });

  it("Given a stale error of an overlay request (an older epoch) Then it is dropped", () => {
    const asked = run([{ type: "plant_truth_started", id: 20, epoch: 1, pick: { halls: true } }, { type: "plant_started", id: 8, epoch: 2, spec: SPEC }], on);
    expect(run([{ type: "error", id: 20, epoch: 1, code: "cancelled", message: "stale" }], asked)).toEqual(asked);
  });

  it("Given a newer plan Then the overlay is cleared and the switch stays as it was; turning it off drops what was asked", () => {
    const asked = run([{ type: "plant_truth_started", id: 20, epoch: 1, pick: { halls: true } }, { type: "plant_truth_view", id: 20, epoch: 1, view: truthHalls }], on);
    const next = run([{ type: "plant_started", id: 8, epoch: 2, spec: SPEC }, withHalls(2, ["a"], ["a"])], asked);
    expect(next.truth).toEqual({ on: true, halls: null, sample: null });
    // what was held is dropped; the request stays as an empty slot so that a late answer or error of it finds a place and is not taken for the plant's
    expect(run([{ type: "plant_truth_switched", on: false }], asked).truth).toEqual({ on: false, halls: { id: 20, epoch: 1, view: null, problem: null }, sample: null });
  });

  it("Given the switch off Then an answer that arrives late is dropped: nothing is kept for a switch that is not pressed", () => {
    const asked = run([{ type: "plant_truth_started", id: 20, epoch: 1, pick: { halls: true } }], on);
    const off = run([{ type: "plant_truth_switched", on: false }], asked);
    expect(run([{ type: "plant_truth_view", id: 20, epoch: 1, view: truthHalls }], off)).toEqual(off);
  });
});

describe("the fields of the sample panel", () => {
  const shown = run([{ type: "plant_started", id: 7, epoch: 1, spec: SPEC }, withHalls(1, ["a", "c_context"], ["a"])]);
  const opened = run([{ type: "plant_record_started", id: 30, epoch: 1, architecture: "c_context", sample_id: "U07-D06-1", role: "fields" }], shown);

  it("Given the sample panel asking for the rows of its sample Then they are kept in a slot of their own and the record panel is not touched", () => {
    expect(opened.fields).toEqual({ id: 30, epoch: 1, architecture: "c_context", sample_id: "U07-D06-1", view: null, problem: null });
    expect(opened.record).toBeNull();
    expect(run([{ type: "plant_record_view", id: 30, epoch: 1, sample }], opened).fields?.view).toEqual(sample);
    expect(run([{ type: "plant_record_view", id: 30, epoch: 1, sample }], opened).record).toBeNull();
  });

  it("Given the record panel and the sample panel both asking Then each answer goes to the request it belongs to", () => {
    const both = run([{ type: "plant_record_started", id: 31, epoch: 1, architecture: "c_context", sample_id: "U07-D06-2" }], opened);
    const answered = run([{ type: "plant_record_view", id: 31, epoch: 1, sample }], both);
    expect(answered.record?.view).toEqual(sample);
    expect(answered.fields?.view).toBeNull();
  });

  it("Given a refusal of the fields request Then it is the problem of that slot only; closing it and a newer plan clear it", () => {
    const refused = run([{ type: "error", id: 30, epoch: 1, code: "refused", reason: "unknown_target", message: "no card" }], opened);
    expect(refused.fields?.problem).toEqual({ code: "refused", message: "no card", reason: "unknown_target" });
    expect(refused.problem).toBeNull();
    expect(run([{ type: "plant_record_closed", role: "fields" }], opened).fields).toBeNull();
    expect(run([{ type: "plant_started", id: 8, epoch: 2, spec: SPEC }, withHalls(2, ["a"], ["a"])], opened).fields).toBeNull();
  });

  it("Given the record panel closed without a role Then the sample panel's fields are left as they are", () => {
    const both = run([{ type: "plant_record_started", id: 31, epoch: 1, architecture: "c_context", sample_id: "U07-D06-2" }], opened);
    const closed = run([{ type: "plant_record_closed" }], both);
    expect(closed.record).toBeNull();
    expect(closed.fields).toEqual(both.fields);
  });
});
