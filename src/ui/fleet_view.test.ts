import { describe, expect, it } from "vitest";
import type { FleetProblem } from "../protocol.ts";
import { fleetNotes, fleetView } from "./fleet_view.ts";
import { defaultForm, fleetKey, fleetRequest, withCounts } from "./form.ts";
import type { Form } from "./form.ts";
import { READY } from "./fixture.ts";
import { initial, reduce } from "./state.ts";
import type { State } from "./state.ts";

// U2 (docs/design/lab_ui.md section 4, rule 6, and section 3): the words of the analyzer-list message as data, the verdict that decides about Run, and the state that keeps only the answer to the newest
// request. Pure functions and the reducer, no DOM. The problems are typed by hand in the shape of `fleetProblems`; the engine's own answers are used in setup_fleet.test.ts.

const shared = (analyte: string, a: number, b: number): FleetProblem => ({ kind: "shared_analyte", analyte, first: { profile: `p${a}`, analyzer: a }, second: { profile: `p${b}`, analyzer: b } });

describe("fleetNotes: the problems as sentences", () => {
  it("Given six analytes shared by analyzers 1 and 2 Then there is one sentence, the analytes in the order given", () => {
    const six = ["vcd", "viability", "glucose", "lactate", "glutamine", "ph"].map((a) => shared(a, 1, 2));
    expect(fleetNotes(six)).toEqual([{ kind: "clash", a: 1, b: 2, analytes: ["vcd", "viability", "glucose", "lactate", "glutamine", "ph"] }]);
  });

  it("Given two pairs of analyzers that clash Then each pair has its own sentence, in the order the engine met them", () => {
    expect(fleetNotes([shared("vcd", 1, 2), shared("ph", 1, 3), shared("glucose", 1, 2)])).toEqual([
      { kind: "clash", a: 1, b: 2, analytes: ["vcd", "glucose"] },
      { kind: "clash", a: 1, b: 3, analytes: ["ph"] },
    ]);
  });

  it("Given a group name two profiles share Then it is a sentence of its own, before the analytes", () => {
    const group: FleetProblem = { kind: "shared_group", group: "AIO", first: { profile: "x", analyzer: 1 }, second: { profile: "y", analyzer: 2 } };
    expect(fleetNotes([group, shared("vcd", 1, 2)])).toEqual([{ kind: "group", a: 1, b: 2, group: "AIO" }, { kind: "clash", a: 1, b: 2, analytes: ["vcd"] }]);
  });

  it("Given analytes that nobody measures Then they are one sentence", () => {
    expect(fleetNotes([{ kind: "unmeasured", analyte: "vcd", menu: "m" }, { kind: "unmeasured", analyte: "ph", menu: "m" }])).toEqual([{ kind: "unmeasured", analytes: ["vcd", "ph"] }]);
  });

  it("Given no problem Then there is no sentence", () => {
    expect(fleetNotes([])).toEqual([]);
  });
});

const form = defaultForm(READY, "default");
const grown = withCounts(form, READY, { m: "3" });
const asked = (state: State, id: number, f = form): State => reduce(state, { type: "fleet_asked", id, key: fleetKey(f) });

describe("the request and its key", () => {
  it("Given a form Then the request carries the scenario and the picks, and the key changes with those and with nothing else", () => {
    expect(fleetRequest({ ...form, analyzers: ["hplc", "allinone_atline"] }, 9)).toEqual({ type: "fleet_check", id: 9, scenario: "default", analyzers: ["hplc", "allinone_atline"] });
    const resized: Form = { ...form, n: "30", baySize: "5", bays: ["pilot"] };
    expect(fleetKey(form)).toBe(fleetKey(resized));
    expect(fleetKey(form)).not.toBe(fleetKey({ ...form, analyzers: ["hplc", "allinone_atline"] }));
    expect(fleetKey(form)).not.toBe(fleetKey({ ...form, scenario: "small" }));
    expect(fleetKey(form)).not.toBe(fleetKey(grown));
  });
});

describe("the state keeps only the answer to the newest request", () => {
  it("Given nothing asked Then Run is off (no verdict yet) and nothing is said", () => {
    expect(fleetView(form, initial.fleet)).toEqual({ problems: [], blocked: true });
  });

  it("Given a request asked and not answered Then Run is off and nothing is said", () => {
    expect(fleetView(form, asked(initial, 2).fleet)).toEqual({ problems: [], blocked: true });
  });

  it("Given an answer with no problem for the picks on screen Then Run is on", () => {
    const state = reduce(asked(initial, 2), { type: "fleet_checked", id: 2, problems: [] });
    expect(fleetView(form, state.fleet)).toEqual({ problems: [], blocked: false });
  });

  it("Given an answer with a problem Then it is said and Run is off", () => {
    const problems = [shared("vcd", 1, 2)];
    const state = reduce(asked(initial, 2), { type: "fleet_checked", id: 2, problems });
    expect(fleetView(form, state.fleet)).toEqual({ problems, blocked: true });
  });

  it("Given the picks changed after the answer Then Run is off until the answer to the new picks comes, and the message of the old picks stays meanwhile (it does not blink)", () => {
    const problems = [shared("vcd", 1, 2)];
    let state = reduce(asked(initial, 2), { type: "fleet_checked", id: 2, problems });
    state = asked(state, 3, grown);
    expect(fleetView(grown, state.fleet)).toEqual({ problems, blocked: true });
    state = reduce(state, { type: "fleet_checked", id: 3, problems: [] });
    expect(fleetView(grown, state.fleet)).toEqual({ problems: [], blocked: false });
    expect(fleetView(form, state.fleet).blocked).toBe(true); // an answer for the new picks says nothing about the old ones
  });

  it("Given an answer to an older request that arrives last Then the answer to the newest request stands (a slow answer to an old pick never re-enables Run)", () => {
    const refused = [shared("vcd", 1, 2)];
    let state = asked(initial, 5, form);
    state = asked(state, 6, grown);
    state = reduce(state, { type: "fleet_checked", id: 6, problems: refused }); // the newest: a problem
    state = reduce(state, { type: "fleet_checked", id: 5, problems: [] }); // the older one, last, would let Run through
    expect(fleetView(grown, state.fleet)).toEqual({ problems: refused, blocked: true });
    expect(state.fleet.verdict?.key).toBe(fleetKey(grown));
  });

  it("Given an older answer that arrives last and says a problem Then it does not shut Run when the newest answer found none", () => {
    let state = asked(initial, 5, form);
    state = asked(state, 6, grown);
    state = reduce(state, { type: "fleet_checked", id: 6, problems: [] });
    state = reduce(state, { type: "fleet_checked", id: 5, problems: [shared("vcd", 1, 2)] });
    expect(fleetView(grown, state.fleet)).toEqual({ problems: [], blocked: false });
  });

  it("Given an answer to an id that was never asked Then it is dropped", () => {
    const state = reduce(asked(initial, 2), { type: "fleet_checked", id: 77, problems: [] });
    expect(state.fleet.verdict).toBeNull();
  });

  it("Given the Worker refuses the newest check Then no verdict shuts Run (the picks are bundled ids, so this is a fault), the fault is shown, and the run will say its own", () => {
    const state = reduce(asked(initial, 2), { type: "error", id: 2, code: "invalid_spec", message: "analyzers must be a list" });
    expect(fleetView(form, state.fleet)).toEqual({ problems: [], blocked: false });
    expect(state.problem).toMatchObject({ id: 2, code: "invalid_spec", message: "analyzers must be a list" });
  });

  it("Given an engine_error of a run Then it is shown as before, and the check is untouched", () => {
    const answered = reduce(asked(initial, 2), { type: "fleet_checked", id: 2, problems: [] });
    const running = reduce(answered, { type: "run_started", id: 4 });
    const state = reduce(running, { type: "error", id: 4, code: "engine_error", message: "scenario default: the analyte vcd is measured by both a and b" });
    expect(state.problem).toMatchObject({ id: 4, code: "engine_error", message: "scenario default: the analyte vcd is measured by both a and b" });
    expect(state.running).toBeNull();
    expect(state.fleet).toEqual(answered.fleet);
  });
});
