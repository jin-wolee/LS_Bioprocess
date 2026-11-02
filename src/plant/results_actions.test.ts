import { describe, expect, it } from "vitest";
import type { PlantAction, PlantSpec } from "../protocol.ts";
import { fromQuery } from "../ui/form.ts";
import { READY } from "../ui/fixture.ts";
import { leftOutOf, resultsKept } from "./action_list.ts";
import { setupLink } from "./drill.ts";
import { DEFAULT_PLANT } from "./spec.ts";

// P6b (docs/design/plant_ui.md section 7, "As built in P6b"): what Results carries of the plant's list. The page imports no engine module, so this filter is a copy of `resultsActions` of the engine;
// engine/tests/lab/action_order.test.ts holds the two to each other for the eight kinds. Expected lists are typed by hand from the rule: the actions that name a unit or an analyzer (add_feed,
// raise_alarm, analyzer_down, change_lot), never a draw (it names the sample of one seed), and not the lab settings (Setup's own controls).

const EIGHT: PlantAction[] = [
  { kind: "add_feed", at: 291600, unit_id: "U03" },
  { kind: "raise_alarm", at: 295200, unit_id: "U04" },
  { kind: "move_draw", at: 291600, sample_id: "U03-D03-1", to: 297000 },
  { kind: "analyzer_down", at: 291600, analyzer: "AN-1", from: 306000, length_min: 120 },
  { kind: "change_lot", at: 291600, analyzer: "AN-2", effective: 310800 },
  { kind: "set_flag", at: 291600, architecture: "c_context", flag: "audit_trail", on: false },
  { kind: "set_capture_path", at: 291600, path: "adapter_ingest" },
  { kind: "set_labelling", at: 291600, method: "handwritten" },
];

describe("resultsKept and leftOutOf", () => {
  it("Given the eight kinds Then the four that name a unit or an analyzer are kept, in the order of the list", () => {
    expect(resultsKept(EIGHT).map((a) => a.kind)).toEqual(["add_feed", "raise_alarm", "analyzer_down", "change_lot"]);
  });

  it("Given the eight kinds Then the other four are left out, each with its reason: a draw names the sample of one seed, a lab setting is Setup's own", () => {
    expect(leftOutOf(EIGHT).map((l) => [l.action.kind, l.why])).toEqual([["move_draw", "draw"], ["set_flag", "lab_setting"], ["set_capture_path", "lab_setting"], ["set_labelling", "lab_setting"]]);
  });

  it("Given a list Then kept and left out together are the list, and neither changes it", () => {
    const list = [...EIGHT];
    expect(resultsKept(list).length + leftOutOf(list).length).toBe(8);
    expect(list).toEqual(EIGHT);
  });

  it("Given no action Then nothing is kept or left out", () => {
    expect([resultsKept([]), leftOutOf([])]).toEqual([[], []]);
  });
});

describe("the Setup link of a drill-down carries the kept actions", () => {
  const spec = (actions: PlantAction[]): PlantSpec => ({ ...DEFAULT_PLANT, actions });
  const ctx = (actions: PlantAction[]) => ({ spec: spec(actions), engine: "9.9.9", t: 305626, architectures: READY.presets.map((p) => p.id) });
  const query = (hash: string): string => hash.slice(hash.indexOf("?") + 1);

  it("Given the plant's eight kinds Then the link holds only the four, as actions=, before the schema and the engine", () => {
    const link = setupLink(ctx(EIGHT), ["c_context"]);
    const carried = new URLSearchParams(query(link)).get("actions");
    expect(JSON.parse(carried ?? "null")).toEqual([EIGHT[0], EIGHT[1], EIGHT[3], EIGHT[4]]);
    expect(link.indexOf("&actions=")).toBeLessThan(link.indexOf("&schema=1"));
  });

  it("Given only a draw and lab settings Then the link has no actions key", () => {
    expect(setupLink(ctx([EIGHT[2], EIGHT[5], EIGHT[6]] as PlantAction[]), ["c_context"])).not.toContain("actions=");
  });

  it("Given the link Then the Setup screen reads the kept actions into its form (the filter of the page is applied once more on reading)", () => {
    const { form } = fromQuery(query(setupLink(ctx(EIGHT), ["c_context"])), READY);
    expect(form.actions).toEqual([EIGHT[0], EIGHT[1], EIGHT[3], EIGHT[4]]);
  });

  it("Given a plant with no action Then the link is what it was", () => {
    expect(setupLink(ctx([]), ["a_manual", "b_lims_lite", "c_context"], "utilisation")).toBe(
      "#/setup?scenario=default&arch=a_manual,b_lims_lite,c_context&schema=1&engine=9.9.9&from=plant&plant=scenario%3Ddefault%26arch%3Da_manual%2Cb_lims_lite%2Cc_context%26seed%3D1%26t%3D305626%26schema%3D1%26engine%3D9.9.9&focus=utilisation",
    );
  });
});
