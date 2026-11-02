import { describe, expect, it } from "vitest";
import { actionInputs, canonicalActions, parseResultsActions, resultsActions } from "../../src/experiments/assembly/lab/actions.ts";
import type { Action } from "../../src/experiments/assembly/lab/actions.ts";
import { checkBounds } from "../../src/experiments/assembly/lab/action_bounds.ts";
import { runLab } from "../../src/experiments/assembly/lab/run.ts";
import type { LabRun } from "../../src/experiments/assembly/lab/run.ts";
import { scenarioConfig } from "../../src/experiments/assembly/lab/setup.ts";
import type { LabData } from "../../src/experiments/assembly/lab/setup.ts";
import type { RunSpec } from "../../src/experiments/assembly/lab/spec.ts";
import { canonicalJson } from "../../src/trace.ts";
import { labData } from "../support/lab_data.ts";
import { readJson } from "../support/paths.ts";
import { SMALL, patched, rawScenario } from "../support/scenarios.ts";
import type { Json } from "../support/schemas.ts";

// P6b (docs/design/lab_ui.md section 22): a `run` with the plant's unit and analyzer actions. EDD: the report of a run over seeds 1 and 2 with the action of a hand fixture equals the report of the same run over
// the scenario written by hand in that fixture. The printed inputs and the bounds over a seed list are typed from the design text; the hand fixtures (tests/fixtures/plant/) were typed from plant_ui.md section 5.2.

const data = labData();
const spec: RunSpec = { schema_version: "1", scenario: "default", settings: SMALL, architectures: ["a_manual", "c_context"], seeds: [1, 2] };
interface Fixture { actions: Action[]; hand: { scenario_fields: Json } }
const fixture = (name: string): Fixture => readJson<Fixture>("tests", "fixtures", "plant", `${name}.json`);
const done = (out: LabRun) => {
  if (!out.ok) throw new Error("the run did not finish");
  return out;
};
const byHand = (f: Fixture): LabData => ({ ...data, scenarios: { ...data.scenarios, default: patched(rawScenario("default"), { fields: f.hand.scenario_fields }) } });

describe("EDD: a run with an action equals the run of the scenario written by hand", () => {
  it.each(["add_feed", "analyzer_down"])("Given the fixture %s and seeds 1 and 2 Then the report and the utilisation equal those of the hand-written scenario (canonical JSON)", async (name) => {
    const f = fixture(name);
    const acted = done(await runLab(data, spec, {}, f.actions));
    const hand = done(await runLab(byHand(f), spec));
    expect(canonicalJson(acted.report)).toBe(canonicalJson(hand.report));
    expect(canonicalJson(acted.utilisation)).toBe(canonicalJson(hand.utilisation));
  }, 120_000);

  it("Given a window of AN-1 Then the report is not the report of the run without it (the action is not ignored)", async () => {
    const base = done(await runLab(data, spec));
    const down = done(await runLab(data, spec, {}, fixture("analyzer_down").actions));
    expect(canonicalJson(down.report)).not.toBe(canonicalJson(base.report));
  }, 120_000);

  it("Given an empty list Then the run is the run without a list: the report, the utilisation and the inputs", async () => {
    const [a, b] = [done(await runLab(data, spec)), done(await runLab(data, spec, {}, []))];
    expect(canonicalJson(b)).toBe(canonicalJson(a));
  }, 120_000);
});

describe("the printed inputs of a run with actions (typed from the design text)", () => {
  const FEED: Action = { kind: "add_feed", at: 291600, unit_id: "U03" };
  const DOWN: Action = { kind: "analyzer_down", at: 291600, analyzer: "AN-1", from: 306000, length_min: 120 };
  const LOT: Action = { kind: "change_lot", at: 291600, analyzer: "AN-2", effective: 310800 };
  const ALARM: Action = { kind: "raise_alarm", at: 295200, unit_id: "U04" };
  const printed = async (actions: Action[]) => (done(await runLab(data, { ...spec, seeds: [1] }, {}, actions)).inputs.filter((i) => i.name.startsWith("act-")));

  it("Given a feed Then one input: its instant in minutes with A228, named by its place, kind, target and field", async () => {
    expect(await printed([FEED])).toEqual([{ name: "act-1 add_feed U03 at", value: 4860, unit: "min", ref: "A228" }]);
  }, 120_000);

  it("Given a window, a lot change and an alarm Then the inputs follow the canonical order: the alarm and the window are plant actions by instant, the length of the window carries A096", async () => {
    // canonical order: plant actions by instant (the window and the lot change at 291,600 s, kind order analyzer_down before change_lot; the alarm at 295,200 s)
    expect(await printed([ALARM, LOT, DOWN])).toEqual([
      { name: "act-1 analyzer_down AN-1 from", value: 5100, unit: "min", ref: "A228" },
      { name: "act-1 analyzer_down AN-1 length", value: 2, unit: "h", ref: "A096" },
      { name: "act-2 change_lot AN-2 effective", value: 5180, unit: "min", ref: "A228" },
      { name: "act-3 raise_alarm U04 at", value: 4920, unit: "min", ref: "A228" },
    ]);
  }, 120_000);

  it("Given the three actions in each of the six orders of entry Then the canonical list, and so the inputs and the scenario, are one", () => {
    const three = [FEED, DOWN, ALARM];
    const orders = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]].map((p) => p.map((i) => three[i] as Action));
    expect(new Set(orders.map((o) => canonicalJson(canonicalActions(o)))).size).toBe(1);
    expect(new Set(orders.map((o) => canonicalJson(actionInputs(o)))).size).toBe(1);
    expect(actionInputs(three).map((i) => i.name)).toEqual(["act-1 add_feed U03 at", "act-2 analyzer_down AN-1 from", "act-2 analyzer_down AN-1 length", "act-3 raise_alarm U04 at"]);
  });
});

describe("the list Results takes", () => {
  it("Given the eight kinds Then Results keeps the four that name a unit or an analyzer, and parseResultsActions refuses the first other kind with its place", () => {
    const eight = [
      { kind: "add_feed", at: 60, unit_id: "U01" }, { kind: "raise_alarm", at: 60, unit_id: "U01" }, { kind: "move_draw", at: 60, sample_id: "U01-D01-1", to: 120 },
      { kind: "analyzer_down", at: 60, analyzer: "AN-1", from: 120, length_min: 10 }, { kind: "change_lot", at: 60, analyzer: "AN-1", effective: 120 },
      { kind: "set_flag", at: 60, architecture: "a_manual", flag: "audit_trail", on: true }, { kind: "set_capture_path", at: 60, path: "adapter_ingest" }, { kind: "set_labelling", at: 60, method: "handwritten" },
    ] as Action[];
    expect(resultsActions(eight).map((a) => a.kind)).toEqual(["add_feed", "raise_alarm", "analyzer_down", "change_lot"]);
    for (const [i, a] of eight.entries()) {
      const out = parseResultsActions([a]);
      if ([2, 5, 6, 7].includes(i)) expect(out, a.kind).toMatchObject({ ok: false, code: "refused", reason: "unknown_target", index: 0 });
      else expect(out, a.kind).toMatchObject({ ok: true });
    }
    const second = parseResultsActions([eight[0], eight[2], eight[5]]);
    expect(second).toMatchObject({ ok: false, code: "refused", reason: "unknown_target", index: 1 });
    expect(second.ok ? "" : second.message).toMatch(/move_draw.*Results carries add_feed, raise_alarm, analyzer_down and change_lot/);
  });
});

describe("bounds over a seed list: one verdict for every seed (lab_ui.md section 22, item 3)", () => {
  const HALLS = ["a_manual", "c_context"];
  const verdict = (actions: Action[]) => [1, 2, 3, 1009, 4242].map((seed) => canonicalJson(checkBounds(scenarioConfig(data, "default", SMALL, seed), seed, HALLS, actions)));
  const cases: [string, Action[]][] = [
    ["a list that passes", [{ kind: "add_feed", at: 291600, unit_id: "U03" }, { kind: "analyzer_down", at: 291600, analyzer: "AN-1", from: 306000, length_min: 120 }, { kind: "change_lot", at: 291600, analyzer: "AN-2", effective: 310800 }]],
    ["a unit the run does not have (unknown_target)", [{ kind: "raise_alarm", at: 291600, unit_id: "U99" }]],
    ["a feed before the unit is inoculated (outside_window)", [{ kind: "add_feed", at: 60, unit_id: "U03" }]],
    ["a window that starts before the action (past)", [{ kind: "analyzer_down", at: 291600, analyzer: "AN-1", from: 240000, length_min: 120 }]],
    ["two windows of one analyzer that overlap (limit)", [{ kind: "analyzer_down", at: 291600, analyzer: "AN-1", from: 306000, length_min: 120 }, { kind: "analyzer_down", at: 291600, analyzer: "AN-1", from: 309600, length_min: 60 }]],
  ];
  it.each(cases)("Given %s Then the verdict is the same for five seeds", (_n, actions) => {
    expect(new Set(verdict(actions)).size).toBe(1);
  });

  it("Given the five failing cases Then each is refused for the reason named (so the cases above test something)", () => {
    const reasons = cases.slice(1).map(([, actions]) => {
      const r = checkBounds(scenarioConfig(data, "default", SMALL, 1), 1, HALLS, actions);
      return r && r.code === "refused" ? [r.reason, r.index] : null;
    });
    expect(reasons).toEqual([["unknown_target", 0], ["outside_window", 0], ["past", 0], ["limit", 1]]);
    expect(checkBounds(scenarioConfig(data, "default", SMALL, 1), 1, HALLS, (cases[0] as [string, Action[]])[1])).toBeNull();
  });
});
