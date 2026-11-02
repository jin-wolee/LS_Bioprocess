import { describe, expect, it } from "vitest";
import type { PlantAction } from "../protocol.ts";
import { canonicalOrder, isLabSetting, plus, without, wordsOf } from "./action_list.ts";

// P6a (docs/design/plant_ui.md sections 5.4 and 5.5, "As built in P6a"): the reader's list of actions. The order is the Worker's canonical order (plant actions before lab settings, then by instant,
// kind, target id and parameters); the expected orders are typed by hand from that rule and from the description of the fixture three_together ("same instant, so by kind: add_feed,
// analyzer_down, move_draw"). The page imports no engine module, so engine/tests/lab/action_order.test.ts compares this order with `canonicalActions` of the engine.

const feed = (unit: string, at: number): PlantAction => ({ kind: "add_feed", at, unit_id: unit });
const down = (at: number, from: number): PlantAction => ({ kind: "analyzer_down", at, analyzer: "AN-1", from, length_min: 120 });
const move: PlantAction = { kind: "move_draw", at: 291600, sample_id: "U03-D03-1", to: 297000 };
const flag: PlantAction = { kind: "set_flag", at: 100, architecture: "c_context", flag: "audit_trail", on: false };

describe("the canonical order of the list", () => {
  it("Given the three actions of three_together in the order they were entered Then the order is add_feed, analyzer_down, move_draw (one instant, so by kind)", () => {
    const entered: PlantAction[] = [move, down(291600, 306000), feed("U03", 291600)];
    expect(canonicalOrder(entered)).toEqual([feed("U03", 291600), down(291600, 306000), move]);
  });

  it("Given a lab setting at an early instant and a plant action at a later one Then the plant action comes first", () => {
    expect(canonicalOrder([flag, feed("U01", 200)])).toEqual([feed("U01", 200), flag]);
  });

  it("Given two plant actions Then the earlier instant comes first, whatever the kind", () => {
    expect(canonicalOrder([feed("U01", 300), move, feed("U05", 100)]).map((a) => a.at)).toEqual([100, 300, 291600]);
  });

  it("Given two feeds at one instant Then the target id decides, by code and not by number (U02 before U10)", () => {
    expect(canonicalOrder([feed("U10", 60), feed("U02", 60)]).map((a) => (a as { unit_id: string }).unit_id)).toEqual(["U02", "U10"]);
  });

  it("Given two windows of one analyzer that differ only in their parameters Then the parameters decide (the earlier start first)", () => {
    expect(canonicalOrder([down(60, 310000), down(60, 306000)]).map((a) => (a as { from: number }).from)).toEqual([306000, 310000]);
  });

  it("Given a list Then the order is the same for every order of entry, and the list given is not changed", () => {
    const three: PlantAction[] = [move, down(291600, 306000), feed("U03", 291600)];
    const expected = canonicalOrder(three);
    for (const p of [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]) {
      const entered = p.map((i) => three[i] as PlantAction);
      const copy = [...entered];
      expect(canonicalOrder(entered)).toEqual(expected);
      expect(entered).toEqual(copy);
    }
  });
});

describe("adding to the list and undoing", () => {
  it("Given a list and an action Then plus adds it at the end and leaves the list given as it was", () => {
    const list = [feed("U01", 60)];
    expect(plus(list, move)).toEqual([feed("U01", 60), move]);
    expect(list).toEqual([feed("U01", 60)]);
  });

  it("Given three actions Then without removes the one named and keeps the others in the order of entry", () => {
    const list = [feed("U01", 60), move, flag];
    expect(without(list, move)).toEqual([feed("U01", 60), flag]);
    expect(without(list, feed("U01", 60))).toEqual([move, flag]);
    expect(without([feed("U01", 60)], feed("U01", 60))).toEqual([]);
  });

  it("Given an action that is not in the list Then without returns the list as it is", () => {
    expect(without([feed("U01", 60)], feed("U02", 60))).toEqual([feed("U01", 60)]);
  });

  it("Given an action that differs from one in the list in one field Then it is another action (the undo removes the one asked for)", () => {
    expect(without([down(60, 306000), down(60, 310000)], down(60, 306000))).toEqual([down(60, 310000)]);
  });
});

describe("a lab setting is the whole run", () => {
  it("Given the eight kinds Then the three settings are lab settings and the five others are plant actions (section 5.3)", () => {
    expect(isLabSetting(flag)).toBe(true);
    expect(isLabSetting({ kind: "set_capture_path", at: 0, path: "adapter_ingest" })).toBe(true);
    expect(isLabSetting({ kind: "set_labelling", at: 0, method: "handwritten" })).toBe(true);
    for (const a of [feed("U01", 60), move, down(60, 120), { kind: "raise_alarm", at: 60, unit_id: "U01" } as PlantAction, { kind: "change_lot", at: 60, analyzer: "AN-1", effective: 120 } as PlantAction]) {
      expect(isLabSetting(a), a.kind).toBe(false);
    }
  });
});

describe("an action in words", () => {
  it("Given each kind Then the key of its sentence and the pieces that fill it are the ids and instants of the action", () => {
    expect(wordsOf(feed("U03", 291600))).toEqual({ key: "plant.act.words.add_feed", slots: { at: { instant: 291600 }, unit: { label: "U03" } } });
    expect(wordsOf({ kind: "raise_alarm", at: 295200, unit_id: "U05" })).toEqual({ key: "plant.act.words.raise_alarm", slots: { at: { instant: 295200 }, unit: { label: "U05" } } });
    expect(wordsOf(move)).toEqual({ key: "plant.act.words.move_draw", slots: { at: { instant: 291600 }, sample: { label: "U03-D03-1" }, to: { instant: 297000 } } });
    expect(wordsOf(down(291600, 306000))).toEqual({
      key: "plant.act.words.analyzer_down",
      slots: { at: { instant: 291600 }, analyzer: { label: "AN-1" }, from: { instant: 306000 }, length: { label: "120" } },
    });
    expect(wordsOf({ kind: "change_lot", at: 291600, analyzer: "AN-2", effective: 345600 })).toEqual({
      key: "plant.act.words.change_lot",
      slots: { at: { instant: 291600 }, analyzer: { label: "AN-2" }, effective: { instant: 345600 } },
    });
    expect(wordsOf(flag)).toEqual({
      key: "plant.act.words.set_flag",
      slots: { at: { instant: 100 }, flag: { label: "audit_trail" }, architecture: { label: "c_context" }, state: { word: "plant.act.state.off" } },
    });
    expect(wordsOf({ kind: "set_flag", at: 100, architecture: "b_lims_lite", flag: "available_at", on: true }).slots.state).toEqual({ word: "plant.act.state.on" });
    expect(wordsOf({ kind: "set_capture_path", at: 60, path: "adapter_ingest" })).toEqual({ key: "plant.act.words.set_capture_path", slots: { at: { instant: 60 }, path: { word: "plant.act.path.adapter_ingest" } } });
    expect(wordsOf({ kind: "set_labelling", at: 60, method: "preprinted_barcode" })).toEqual({ key: "plant.act.words.set_labelling", slots: { at: { instant: 60 }, method: { word: "plant.act.method.preprinted_barcode" } } });
  });
});
