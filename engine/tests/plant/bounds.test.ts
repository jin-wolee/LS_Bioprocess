import { describe, expect, it } from "vitest";
import { checkBounds } from "../../src/experiments/assembly/lab/action_bounds.ts";
import type { Action } from "../../src/experiments/assembly/lab/actions.ts";
import { SMALL, configOf } from "../support/scenarios.ts";

// P2 (docs/design/plant_ui.md section 5.6): the refusals that need the run's shape, with the codes of the table. The facts are hand arithmetic on the small default scenario (6 reactors
// in one bay, 8 days, horizon 691200 s): unit U03 is inoculated at 30600 s (day 0, 08:30) and harvested at 30600 + 6 x 86400 = 549000 s, U05 at 32400 s; the samples are planned from the day
// after inoculation; day 3 starts at 259200 s and its staffed window is 08:00 to 18:00 (288000 s to 324000 s); U03-D03-1 is planned at 305421 s; day 5 is a Saturday, which has no second
// sample. The analyzers are AN-1 and AN-2. SC5 has a window of AN-1 from 721800 s for 4 h.

const cfg = configOf("default", { settings: SMALL });
const HALLS = ["a_manual", "b_lims_lite", "c_context"];
const check = (...actions: Action[]) => checkBounds(cfg, 1, HALLS, actions);
const feed = (at: number, unit_id = "U03"): Action => ({ kind: "add_feed", at, unit_id });
const move = (at: number, to: number, sample_id = "U03-D03-1"): Action => ({ kind: "move_draw", at, sample_id, to });
const down = (at: number, from: number, length_min = 60, analyzer = "AN-1"): Action => ({ kind: "analyzer_down", at, analyzer, from, length_min });

describe("feeds and alarms fall inside the culture of their unit (outside_window)", () => {
  it("Given U03 (in culture from 30600 s to 549000 s) Then 30660 s and 548940 s are accepted and 30600 s and 549000 s are refused", () => {
    expect(check(feed(30660))).toBeNull();
    expect(check(feed(548940))).toBeNull();
    expect(check(feed(30600))).toMatchObject({ ok: false, code: "refused", reason: "outside_window", index: 0 });
    expect(check(feed(549000))).toMatchObject({ ok: false, code: "refused", reason: "outside_window", index: 0 });
    expect(check(feed(30600))).toMatchObject({ message: expect.stringMatching(/U03.*30600.*549000/) });
  });

  it("Given an alarm on U05 (inoculated at 32400 s) Then 32460 s is accepted and 32400 s is refused", () => {
    expect(check({ kind: "raise_alarm", at: 32460, unit_id: "U05" })).toBeNull();
    expect(check({ kind: "raise_alarm", at: 32400, unit_id: "U05" })).toMatchObject({ reason: "outside_window" });
  });

  it("Given a unit the run does not have (U07, U99) Then the action is refused as unknown_target", () => {
    expect(check(feed(291600, "U07"))).toMatchObject({ ok: false, code: "refused", reason: "unknown_target", index: 0 });
    expect(check(feed(291600, "U99"))).toMatchObject({ reason: "unknown_target" });
    expect(check(feed(291600, "reactor"))).toMatchObject({ reason: "unknown_target" });
  });
});

describe("a moved draw (past, outside_window, unknown_target, limit)", () => {
  it("Given U03-D03-1 (planned 305421 s) moved at 291600 s to 297000 s Then it is accepted, and so is a move at 288000 s to 288000 s, the instant of the action itself and the opening of the window", () => {
    expect(check(move(291600, 297000))).toBeNull();
    expect(check(move(288000, 288000))).toBeNull();
  });

  it("Given an action after the planned instant (306000 s > 305421 s) Then the sample is already planned: past, and the message names the sample", () => {
    expect(check(move(306000, 310020))).toMatchObject({ ok: false, code: "refused", reason: "past", index: 0, message: expect.stringMatching(/U03-D03-1.*already planned at 305421/) });
  });

  it("Given a target before the action (288000 s < 291600 s) Then past", () => {
    expect(check(move(291600, 288000))).toMatchObject({ reason: "past", message: expect.stringMatching(/target 288000 s is before the action at 291600 s/) });
  });

  it("Given a target on the next day (297000 + 86400 s) Then outside_window, with the engine's message", () => {
    expect(check(move(291600, 383400))).toMatchObject({ reason: "outside_window", message: expect.stringMatching(/move_draw of U03-D03-1.*same day/) });
  });

  it("Given a target at 07:00 (284400 s, the window opens at 08:00) and another at 19:00 (327600 s, it closes at 18:00) Then outside_window for both", () => {
    expect(check(move(280800, 284400))).toMatchObject({ reason: "outside_window" });
    expect(check(move(291600, 327600))).toMatchObject({ reason: "outside_window" });
    expect(check(move(291600, 324000))).toBeNull(); // 18:00 itself is the end of the window and is inside it
  });

  it.each(["U03-D77-1", "garbage", "U99-D03-1", "U03-D05-2", "U03-D00-1", "U03-D03-3"])("Given the sample %s, which the run does not plan Then unknown_target", (id) => {
    expect(check(move(100020, 291600, id))).toMatchObject({ ok: false, code: "refused", reason: "unknown_target" });
  });

  it("Given two moves of one sample at different instants Then the second in the canonical order is refused as limit, and its index is the one in the entry list", () => {
    const first = move(291600, 297000);
    const second = move(292200, 298020);
    expect(check(first, second)).toMatchObject({ reason: "limit", index: 1 });
    expect(check(second, first)).toMatchObject({ reason: "limit", index: 0 });
  });
});

describe("an analyzer window and a lot change (past, outside_window, unknown_target, limit)", () => {
  it("Given AN-1 down from 306000 s at 291600 s Then it is accepted, and so is a window that starts at the instant of the action", () => {
    expect(check(down(291600, 306000))).toBeNull();
    expect(check(down(291600, 291600))).toBeNull();
  });

  it("Given a window that starts before the action Then past; an analyzer that does not exist Then unknown_target; a start after the horizon Then outside_window", () => {
    expect(check(down(291600, 291540))).toMatchObject({ reason: "past" });
    expect(check(down(291600, 306000, 60, "AN-9"))).toMatchObject({ reason: "unknown_target" });
    expect(check(down(291600, 691200))).toMatchObject({ reason: "outside_window" });
  });

  it("Given two windows on AN-1 that overlap (306000 s for 60 min and 308000 s) Then limit; on AN-2, or after the first ends (309600 s, half-open), they are accepted", () => {
    expect(check(down(291600, 306000), down(291600, 307980))).toMatchObject({ reason: "limit", index: 1 });
    expect(check(down(291600, 306000), down(291600, 307980, 60, "AN-2"))).toBeNull();
    expect(check(down(291600, 306000), down(291600, 309600))).toBeNull();
  });

  it("Given a window of SC5 (AN-1 from 721800 s for 4 h, until 736200 s) Then a new window that overlaps it is refused as limit and one that starts when it ends is accepted", () => {
    const sc5 = configOf("sc05_one_analyzer_down");
    expect(checkBounds(sc5, 1, HALLS, [down(699960, 718200)])).toBeNull(); // 718200 s + 60 min ends exactly when the window begins (half-open)
    expect(checkBounds(sc5, 1, HALLS, [down(699960, 720000)])).toMatchObject({ reason: "limit" });
    expect(checkBounds(sc5, 1, HALLS, [down(699960, 736200)])).toBeNull();
  });

  it("Given a lot change effective before the action Then past; an unknown analyzer Then unknown_target; after the horizon Then outside_window; at the action's own instant it is accepted", () => {
    const lot = (effective: number, analyzer = "AN-2"): Action => ({ kind: "change_lot", at: 291600, analyzer, effective });
    expect(check(lot(345600))).toBeNull();
    expect(check(lot(291600))).toBeNull();
    expect(check(lot(291540))).toMatchObject({ reason: "past" });
    expect(check(lot(345600, "AN-0"))).toMatchObject({ reason: "unknown_target" });
    expect(check(lot(691200))).toMatchObject({ reason: "outside_window" });
  });
});

describe("lab settings", () => {
  const flag = (architecture: string, name: string): Action => ({ kind: "set_flag", at: 291600, architecture, flag: name, on: false });

  it("Given a flag of a hall Then it is accepted; an unknown flag, a record that is not a hall or a flag of the eleventh kind Then unknown_target", () => {
    expect(check(flag("c_context", "audit_trail"))).toBeNull();
    expect(check(flag("c_context", "audit_log"))).toMatchObject({ reason: "unknown_target" });
    expect(check(flag("c_context_minus_audit_trail", "two_clocks"))).toMatchObject({ reason: "unknown_target" });
    expect(check(flag("z", "audit_trail"))).toMatchObject({ reason: "unknown_target" });
  });

  it("Given any action at or after the horizon (691200 s) Then outside_window; the last whole minute before it is accepted", () => {
    expect(check({ kind: "set_labelling", at: 691140, method: "handwritten" })).toBeNull();
    expect(check({ kind: "set_labelling", at: 691200, method: "handwritten" })).toMatchObject({ reason: "outside_window" });
    expect(check({ kind: "set_capture_path", at: 700000 - (700000 % 60), path: "adapter_ingest" })).toMatchObject({ reason: "outside_window" });
  });
});

describe("the order of entry does not change the answer", () => {
  it("Given a good feed and a bad one in either order Then the same action is refused, at the index it has in the list", () => {
    expect(check(feed(291600), feed(291600, "U99"))).toMatchObject({ reason: "unknown_target", index: 1 });
    expect(check(feed(291600, "U99"), feed(291600))).toMatchObject({ reason: "unknown_target", index: 0 });
  });
});
