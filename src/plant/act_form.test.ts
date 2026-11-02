import { describe, expect, it } from "vitest";
import { actionOf, atOf, flagOnFor, initialFields, instantOf } from "./act_form.ts";
import { handPlan } from "./fixture.ts";

// P6a (docs/design/plant_ui.md section 5.1, "As built in P6a"): the instant of an action and the action a form builds. The expected values are typed by hand from the hand fixtures of
// tests/fixtures/plant/ (day 3 09:00 is 3 x 86,400 + 9 x 3,600 = 291,600 s; 10:30 of that day is 297,000 s; 13:00 is 306,000 s) and never come from the code under test.

describe("at: the clock reading rounded up to the next whole minute (section 5.1)", () => {
  it.each([
    [28800, 28800], // a reading already on a whole minute stays
    [28800.4, 28860], // a fraction of a second of the next minute rounds up
    [28859, 28860],
    [28859.999, 28860],
    [28860.0001, 28920],
    [0, 0],
    [1, 60],
    [291600, 291600],
  ])("Given the clock at %s s Then the action's at is %s s", (clock, at) => {
    expect(atOf(clock)).toBe(at);
  });
});

describe("an instant typed as a day of the run and a time of day", () => {
  it("Given day 3 and 10:30 Then it is 297,000 s; day 8 08:31 is 721,860 s; day 0 00:00 is 0", () => {
    expect(instantOf("3", "10:30")).toBe(297000);
    expect(instantOf("8", "08:31")).toBe(721860);
    expect(instantOf("0", "00:00")).toBe(0);
    expect(instantOf("4", "00:00")).toBe(345600);
  });

  it("Given a day or a time that is not there or not a time of day Then no instant (the form is not complete)", () => {
    for (const [day, time] of [["", "10:30"], ["3", ""], ["x", "10:30"], ["-1", "10:30"], ["3.5", "10:30"], ["3", "25:00"], ["3", "10:60"], ["3", "1030"]]) {
      expect(instantOf(day as string, time as string), `${day} ${time}`).toBeNull();
    }
  });
});

describe("the action a form builds, at the instant it was sent", () => {
  const plan = handPlan();
  // the sample of the move fixture: planned at 12:50 of day 3 (305,400 s)
  plan.samples[0] = { ...(plan.samples[0] as (typeof plan.samples)[number]), id: "U03-D03-1", planned_s: 305400 };

  it("Given the hand fixtures Then each form builds the action the fixture lists", () => {
    expect(actionOf("add_feed", { unit: "U03" }, 291600, plan)).toEqual({ kind: "add_feed", at: 291600, unit_id: "U03" });
    expect(actionOf("raise_alarm", { unit: "U05" }, 295200, plan)).toEqual({ kind: "raise_alarm", at: 295200, unit_id: "U05" });
    expect(actionOf("move_draw", { sample: "U03-D03-1", time: "10:30" }, 291600, plan)).toEqual({ kind: "move_draw", at: 291600, sample_id: "U03-D03-1", to: 297000 });
    expect(actionOf("analyzer_down", { analyzer: "AN-1", day: "3", time: "13:00", length: "120" }, 291600, plan)).toEqual({ kind: "analyzer_down", at: 291600, analyzer: "AN-1", from: 306000, length_min: 120 });
    expect(actionOf("change_lot", { analyzer: "AN-2", day: "4", time: "00:00" }, 291600, plan)).toEqual({ kind: "change_lot", at: 291600, analyzer: "AN-2", effective: 345600 });
    expect(actionOf("set_flag", { architecture: "b_lims_lite", flag: "available_at", on: "true" }, 291600, plan)).toEqual({ kind: "set_flag", at: 291600, architecture: "b_lims_lite", flag: "available_at", on: true });
    expect(actionOf("set_flag", { architecture: "c_context", flag: "audit_trail", on: "false" }, 291600, plan)).toEqual({ kind: "set_flag", at: 291600, architecture: "c_context", flag: "audit_trail", on: false });
    expect(actionOf("set_capture_path", { path: "adapter_ingest" }, 291600, plan)).toEqual({ kind: "set_capture_path", at: 291600, path: "adapter_ingest" });
    expect(actionOf("set_labelling", { method: "preprinted_barcode" }, 291600, plan)).toEqual({ kind: "set_labelling", at: 291600, method: "preprinted_barcode" });
  });

  it("Given the move of a sample Then the day of the new instant is the day of the sample's planned instant, not the clock's", () => {
    // the clock is on day 3 but the sample is planned on day 4 at 09:00 (345,600 + 32,400 = 378,000 s): 10:30 of day 4 is 383,400 s
    const later = handPlan();
    later.samples[0] = { ...(later.samples[0] as (typeof later.samples)[number]), id: "U03-D04-1", planned_s: 378000 };
    expect(actionOf("move_draw", { sample: "U03-D04-1", time: "10:30" }, 291600, later)).toEqual({ kind: "move_draw", at: 291600, sample_id: "U03-D04-1", to: 383400 });
  });

  it("Given a field that is empty, a number that is not one or a sample the plan does not list Then no action (the form is not complete); whether a value is allowed is the Worker's", () => {
    expect(actionOf("add_feed", { unit: "" }, 291600, plan)).toBeNull();
    expect(actionOf("add_feed", {}, 291600, plan)).toBeNull();
    expect(actionOf("move_draw", { sample: "U09-D09-9", time: "10:30" }, 291600, plan)).toBeNull();
    expect(actionOf("move_draw", { sample: "U03-D03-1", time: "" }, 291600, plan)).toBeNull();
    expect(actionOf("analyzer_down", { analyzer: "AN-1", day: "3", time: "13:00", length: "" }, 291600, plan)).toBeNull();
    expect(actionOf("analyzer_down", { analyzer: "AN-1", day: "3", time: "13:00", length: "x" }, 291600, plan)).toBeNull();
    expect(actionOf("set_flag", { architecture: "c_context", flag: "audit_trail" }, 291600, plan)).toBeNull();
    expect(actionOf("set_capture_path", { path: "" }, 291600, plan)).toBeNull();
  });

  it("Given a length of zero Then the action is built and the Worker refuses it (one rule, one place)", () => {
    expect(actionOf("analyzer_down", { analyzer: "AN-1", day: "3", time: "13:00", length: "0" }, 291600, plan)).toEqual({ kind: "analyzer_down", at: 291600, analyzer: "AN-1", from: 306000, length_min: 0 });
  });
});

describe("what a form starts with", () => {
  const plan = handPlan();
  plan.records = [
    { architecture: "a_manual", flags_on: ["audit_trail"], cards: [] },
    { architecture: "b_lims_lite", flags_on: [], cards: [] },
  ];
  plan.layout = { ...plan.layout, architectures: ["a_manual", "b_lims_lite", "c_context"] };
  const FLAGS = ["audit_trail", "available_at"];
  const at = 291600; // day 3 09:00

  it("Given a picked reactor Then a feed or an alarm starts on it; with none picked it starts on the first reactor", () => {
    expect(initialFields("add_feed", { plan, flags: FLAGS, picked: { kind: "reactor", index: 1 }, at })).toEqual({ unit: "U02" });
    expect(initialFields("raise_alarm", { plan, flags: FLAGS, picked: { kind: "reactor", index: 1 }, at })).toEqual({ unit: "U02" });
    expect(initialFields("add_feed", { plan, flags: FLAGS, picked: null, at })).toEqual({ unit: "U01" });
    expect(initialFields("add_feed", { plan, flags: FLAGS, picked: { kind: "analyzer", index: 0 }, at })).toEqual({ unit: "U01" });
  });

  it("Given a picked analyzer Then a window or a lot change starts on it and on the clock's day and time; no length is invented", () => {
    expect(initialFields("analyzer_down", { plan, flags: FLAGS, picked: { kind: "analyzer", index: 1 }, at })).toEqual({ analyzer: "AN-2", day: "3", time: "09:00", length: "" });
    expect(initialFields("change_lot", { plan, flags: FLAGS, picked: null, at })).toEqual({ analyzer: "AN-1", day: "3", time: "09:00" });
  });

  it("Given a flag form Then it starts on the first hall and the first flag and switches the flag to the opposite of what the hall has", () => {
    expect(initialFields("set_flag", { plan, flags: FLAGS, picked: null, at })).toEqual({ architecture: "a_manual", flag: "audit_trail", on: "false" });
    expect(flagOnFor(plan, "a_manual", "audit_trail")).toBe("false"); // on in A: switching means off
    expect(flagOnFor(plan, "a_manual", "available_at")).toBe("true"); // off in A: switching means on
    expect(flagOnFor(plan, "b_lims_lite", "audit_trail")).toBe("true");
    expect(flagOnFor(plan, "c_context", "audit_trail")).toBe("true"); // the record of C has not arrived: the form offers on
  });

  it("Given the other forms Then the capture path and the labelling start on their first choice and a move starts empty", () => {
    expect(initialFields("set_capture_path", { plan, flags: FLAGS, picked: null, at })).toEqual({ path: "manual_transcription" });
    expect(initialFields("set_labelling", { plan, flags: FLAGS, picked: null, at })).toEqual({ method: "handwritten" });
    expect(initialFields("move_draw", { plan, flags: FLAGS, picked: null, at })).toEqual({});
  });
});
