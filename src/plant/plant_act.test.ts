import { describe, expect, it } from "vitest";
import type { PlantAction as Act, Response, ScenePlan } from "../protocol.ts";
import { initialPlant, needsRun, reducePlant } from "./plant_state.ts";
import type { PlantAction, PlantState } from "./plant_state.ts";
import { DEFAULT_PLANT as SPEC } from "./spec.ts";

// P6a (docs/design/plant_ui.md section 5.5, "As built in P6a"): what the page store does with an operator action. The page posts the whole list with a new epoch and holds the clock; on the answer
// of that epoch the plan is replaced and the clock resumes at `resume_at`; a refusal, or an answer whose causality check is false, leaves the plan, the clock and the list as they were.

const plan = (seed: number): ScenePlan => ({ schema_version: "1", seed, horizon_s: 0, layout: { bays: [], analyzers: [], architectures: ["a"] }, units: [], analyzers: [], staff: [], samples: [], marks: [], windows: [], calibrations: [], records: [] });
const ready = (id: number, epoch: number, over: Partial<Extract<Response, { type: "plant_ready" }>> = {}): Extract<Response, { type: "plant_ready" }> => ({
  type: "plant_ready", id, epoch, plan: plan(epoch), resume_at: 0, hashes: { truth: `t${epoch}`, cells: { a: `c${epoch}` } }, checks: { prefix_equal: null, truth_equal: null }, key: "k", ...over,
});
const run = (actions: PlantAction[], from: PlantState = initialPlant): PlantState => actions.reduce(reducePlant, from);

const FEED: Act = { kind: "add_feed", at: 291600, unit_id: "U03" };
const WITH_FEED = { ...SPEC, actions: [FEED] };
const answered = run([{ type: "plant_started", id: 7, epoch: 1, spec: SPEC }, ready(7, 1)]);
const acted = run([{ type: "plant_acted", id: 8, epoch: 2, spec: WITH_FEED, play: true }], answered);

describe("the reader acts", () => {
  it("Given an action Then the spec the page asks for has the list with it, the epoch is the newest, the plan on screen stays and the request is pending with the spec before it", () => {
    expect(acted.epoch).toBe(2);
    expect(acted.spec).toEqual(WITH_FEED);
    expect(acted.running).toBe(8);
    expect(acted.ready?.epoch).toBe(1);
    expect(acted.act).toEqual({ pending: { epoch: 2, prior: SPEC, play: true }, refusal: null, resume: null });
    expect(acted.problem).toBeNull();
  });

  it("Given the answer of that epoch Then the plan is replaced, the list stays and the clock is to resume at resume_at, playing as it was", () => {
    const done = run([ready(8, 2, { resume_at: 291600, checks: { prefix_equal: true, truth_equal: null } })], acted);
    expect(done.ready?.epoch).toBe(2);
    expect(done.ready?.resume_at).toBe(291600);
    expect(done.spec).toEqual(WITH_FEED);
    expect(done.running).toBeNull();
    expect(done.act).toEqual({ pending: null, refusal: null, resume: { epoch: 2, t: 291600, play: true } });
  });

  it("Given the clock was paused when the reader acted Then it resumes paused", () => {
    const paused = run([{ type: "plant_acted", id: 8, epoch: 2, spec: WITH_FEED, play: false }, ready(8, 2, { resume_at: 291600 })], answered);
    expect(paused.act.resume).toEqual({ epoch: 2, t: 291600, play: false });
  });

  it("Given a lab setting whose answer checks truth_equal Then it is drawn when the truth is equal", () => {
    const done = run([ready(8, 2, { resume_at: 291600, checks: { prefix_equal: null, truth_equal: true } })], acted);
    expect(done.ready?.epoch).toBe(2);
    expect(done.act.refusal).toBeNull();
  });

  it("Given a plan that arrives for a request the route made (not the bar) Then there is no resume: the clock opens as it always did", () => {
    expect(answered.act.resume).toBeNull();
    expect(run([{ type: "plant_started", id: 8, epoch: 2, spec: SPEC }, ready(8, 2)], answered).act.resume).toBeNull();
  });

  it("Given the answer of an older epoch while an action is pending Then it is dropped and the action stays pending", () => {
    const stale = run([ready(7, 1)], acted);
    expect(stale).toEqual(acted);
  });
});

describe("the Worker refuses the action", () => {
  const refused = run([{ type: "error", id: 8, epoch: 2, code: "refused", message: "U03 is in culture after 1 s", reason: "outside_window", index: 0 }], acted);

  it("Given a refusal Then the list goes back to what it was, the plan on screen stays, and the refusal is the form's, not the plant's", () => {
    expect(refused.spec).toEqual(SPEC);
    expect(refused.spec?.actions).toEqual([]);
    expect(refused.ready?.epoch).toBe(1);
    expect(refused.running).toBeNull();
    expect(refused.problem).toBeNull();
    expect(refused.act).toEqual({ pending: null, refusal: { kind: "error", problem: { code: "refused", message: "U03 is in culture after 1 s", reason: "outside_window", index: 0 } }, resume: null });
  });

  it("Given a refusal Then the route wants the spec it already has and asks for no new run (no retry loop)", () => {
    expect(needsRun(refused, SPEC)).toBe(false);
  });

  it("Given a locked answer or an engine error Then they are shown at the form the same way", () => {
    const locked = run([{ type: "error", id: 8, epoch: 2, code: "locked", message: "a challenge is open" }], acted);
    expect(locked.act.refusal).toEqual({ kind: "error", problem: { code: "locked", message: "a challenge is open" } });
    expect(locked.spec).toEqual(SPEC);
    const engine = run([{ type: "error", id: 8, epoch: 2, code: "engine_error", message: "the engine said no" }], acted);
    expect(engine.act.refusal).toEqual({ kind: "error", problem: { code: "engine_error", message: "the engine said no" } });
  });

  it("Given the error of an older epoch Then it is dropped", () => {
    expect(run([{ type: "error", id: 7, epoch: 1, code: "cancelled", message: "replaced" }], acted)).toEqual(acted);
  });

  it("Given the next action or the close of the form Then the refusal is gone", () => {
    expect(run([{ type: "plant_acted", id: 9, epoch: 3, spec: WITH_FEED, play: false }], refused).act.refusal).toBeNull();
    expect(run([{ type: "plant_refusal_closed" }], refused).act.refusal).toBeNull();
  });

  it("Given a refusal and then a second action that is accepted Then the list has only the second", () => {
    const second: Act = { kind: "raise_alarm", at: 295200, unit_id: "U05" };
    const again = run([{ type: "plant_acted", id: 9, epoch: 3, spec: { ...SPEC, actions: [second] }, play: false }, ready(9, 3, { resume_at: 295200 })], refused);
    expect(again.spec?.actions).toEqual([second]);
    expect(again.ready?.epoch).toBe(3);
  });
});

describe("the causality check fails", () => {
  it.each(["prefix_equal", "truth_equal"] as const)("Given an answer whose %s is false Then it is not drawn: the old plan and the old list stay and the form says which check failed", (check) => {
    const bad = run([ready(8, 2, { resume_at: 291600, checks: { prefix_equal: check === "prefix_equal" ? false : null, truth_equal: check === "truth_equal" ? false : null } })], acted);
    expect(bad.ready?.epoch).toBe(1);
    expect(bad.ready?.plan).toEqual(plan(1));
    expect(bad.spec).toEqual(SPEC);
    expect(bad.running).toBeNull();
    expect(bad.act).toEqual({ pending: null, refusal: { kind: "causality", check }, resume: null });
  });

  it("Given an answer that is false for a request the route made (no action) Then the check is not the bar's business and the plan is drawn as before", () => {
    const routed = run([{ type: "plant_started", id: 8, epoch: 2, spec: SPEC }, ready(8, 2, { checks: { prefix_equal: false, truth_equal: null } })], answered);
    expect(routed.ready?.epoch).toBe(2);
  });
});

describe("leaving the plant", () => {
  it("Given an accepted action and then the reader leaves Then the resume is gone, so that Back lands on the instant they left at and not on the one the action resumed at", () => {
    const done = run([ready(8, 2, { resume_at: 291600 })], acted);
    expect(done.act.resume).not.toBeNull();
    const away = run([{ type: "plant_left", t: 305626, lens: "a" }], done);
    expect(away.act.resume).toBeNull();
    expect(away.view).toEqual({ t: 305626, lens: "a" });
    expect(away.spec).toEqual(WITH_FEED);
  });
});

describe("a new run of the route clears what the bar kept", () => {
  it("Given a refusal and then a run for another spec (a link) Then the refusal and the resume are gone", () => {
    const refused = run([{ type: "error", id: 8, epoch: 2, code: "refused", message: "m", reason: "past", index: 0 }], acted);
    const next = run([{ type: "plant_started", id: 9, epoch: 3, spec: { ...SPEC, seed: 4 } }], refused);
    expect(next.act).toEqual({ pending: null, refusal: null, resume: null });
  });
});
