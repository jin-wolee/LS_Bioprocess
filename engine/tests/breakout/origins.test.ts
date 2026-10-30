import { describe, expect, it } from "vitest";
import { H, docOf, eventsOf, fx12a, h, processOf, runOfDoc, set } from "./support.ts";
import type { Json } from "../support/schemas.ts";

// Spec 11.8.1 and rule S1: five origin kinds, one mechanism. An affected unit has an onset: the instant it first consumes the contaminated lot (the seed lot at inoculation) or uses the
// contaminated equipment; the instant of the named sampling draw; or, for a unit's own equipment, a scenario instant. The times below are hand arithmetic from lag 12 h and d1 2 h.

const RESPONSE = { signal_to_response: h(2, "A176"), positive_to_hold: h(4, "A176") };
const INPUTS = { bioburden_sample_volume_ml: { value: 2, unit: "mL", ref: "A225" } };
const lot = (lot_id: string, kind: string): Json => ({ lot_id, kind, prepared_at: h(0) });

describe("Origin kinds of the break-out script", () => {
  it("Given a contaminated seed lot used by U01 and U02, inoculated 15 min apart When the script runs Then each is affected from its own inoculation (0 s and 900 s) and U03, on the other seed lot, is not", () => {
    const block: Json = {
      profile: "bacterial",
      origin: { kind: "seed_lot", lot_id: "SL-1", contaminated_at: h(0, "A157") },
      topology: { lots: [lot("SL-1", "seed"), lot("SL-2", "seed")], consumption: [{ unit_id: "U01", lot_id: "SL-1" }, { unit_id: "U02", lot_id: "SL-1" }, { unit_id: "U03", lot_id: "SL-2" }] },
      response: RESPONSE, confirm: ["U01", "U02"], inputs: INPUTS,
    };
    const run = runOfDoc(docOf(block, { inoculation_step_min: 15 }));
    expect(eventsOf(run, "contamination_onset").map((e) => [e.unit_id, e.t, e.origin_kind, e.origin_id])).toEqual([["U01", 0, "seed_lot", "SL-1"], ["U02", 900, "seed_lot", "SL-1"]]);
    // signal_at = onset + 12 h (43 200 s); the first decision is U01's signal plus 2 h = 50 400 s; each unit stops at its own signal_at + 2 h
    expect(eventsOf(run, "signal_observed").map((e) => [e.unit_id, e.t])).toEqual([["U01", 43_200], ["U02", 44_100]]);
    expect(processOf(run, "unit_stopped")).toEqual([["U01", 50_400, "-"], ["U02", 51_300, "-"]]);
    expect(eventsOf(run, "confirm_sample_drawn").map((e) => [e.unit_id, e.t])).toEqual([["U01", 50_400], ["U02", 50_400]]);
    expect(eventsOf(run, "inoculation").map((e) => [e.unit_id, e.t, e.seed_lot_id])).toEqual([["U01", 0, "SL-1"], ["U02", 900, "SL-1"], ["U03", 1800, "SL-2"]]);
  });

  it("Given a contaminated lot consumed before it became contaminated When the script runs Then only the consumption at or after contaminated_at makes the onset", () => {
    // ML-2 is contaminated from 4 h; U01 consumes it at 2 h (clean) and at 5 h (onset); U03 consumes it at 3 h only (never affected)
    const block = set(set(fx12a(), "origin.contaminated_at", h(4, "A157")), "topology.consumption", [
      { unit_id: "U01", lot_id: "SL-1" }, { unit_id: "U02", lot_id: "SL-2" }, { unit_id: "U03", lot_id: "SL-3" },
      { unit_id: "U01", lot_id: "ML-2", at: h(2) }, { unit_id: "U03", lot_id: "ML-2", at: h(3) }, { unit_id: "U01", lot_id: "ML-2", at: h(5) },
    ]);
    const run = runOfDoc(docOf(block));
    expect(eventsOf(run, "contamination_onset").map((e) => [e.unit_id, e.t])).toEqual([["U01", H(5)]]);
  });

  it("Given a unit's own equipment contaminated at 5 h When the script runs Then only that unit is affected, from the scenario instant, with no equipment record", () => {
    const block: Json = {
      profile: "bacterial",
      origin: { kind: "unit_equipment", unit_id: "U01", at: h(5, "A157") },
      topology: {},
      response: RESPONSE, confirm: ["U01"], inputs: INPUTS,
    };
    const run = runOfDoc(docOf(block));
    expect(eventsOf(run, "contamination_onset")).toEqual([
      { type: "contamination_onset", t: H(5), unit_id: "U01", batch_id: "B-U01", contamination_type: "bacterial", origin_kind: "unit_equipment", origin_id: "U01" },
    ]);
    expect(eventsOf(run, "signal_observed").map((e) => e.t)).toEqual([H(17)]);
    expect(processOf(run, "unit_stopped")).toEqual([["U01", H(19), "-"]]);
    expect(processOf(run, "equipment_use")).toEqual([]);
    expect(eventsOf(run, "inoculation").every((e) => e.seed_lot_id === undefined)).toBe(true);
  });

  it("Given a named sampling draw When the script runs Then the onset is the instant of that draw, the sample of the draw is still in the log, and the unit stops 14 h after the next tick", () => {
    const base = runOfDoc(docOf());
    const named = eventsOf(base, "sample_drawn").find((e) => e.unit_id === "U01");
    if (!named) throw new Error("the baseline draws no sample of U01");
    const block: Json = { profile: "bacterial", origin: { kind: "sampling", sample_id: named.sample_id }, topology: {}, response: RESPONSE, confirm: ["U01"], inputs: INPUTS };
    const run = runOfDoc(docOf(block));
    expect(eventsOf(run, "contamination_onset")).toEqual([
      { type: "contamination_onset", t: named.t, unit_id: "U01", batch_id: "B-U01", contamination_type: "bacterial", origin_kind: "sampling", origin_id: named.sample_id },
    ]);
    // signal_at is the first 60 s tick at or after the draw plus 12 h (the unit was inoculated at 0 s); the stop follows 2 h later
    const signal = Math.ceil((named.t + H(12)) / 60) * 60;
    expect(eventsOf(run, "signal_observed").map((e) => e.t)).toEqual([signal]);
    expect(processOf(run, "unit_stopped")).toEqual([["U01", signal + H(2), "-"]]);
    expect(eventsOf(run, "sample_drawn").find((e) => e.sample_id === named.sample_id)).toEqual(named);
    expect(eventsOf(run, "confirm_sample_drawn").map((e) => e.t)).toEqual([signal + H(2)]);
  });

  it("Given an onset that does not fall on a sensor tick (5.01 h = 18 036 s) When the script runs Then signal_at is the first tick at or after onset plus 12 h: 61 260 s, not 61 236 s", () => {
    const block = set(fx12a(), "topology.consumption.6.at", h(5.01));
    const run = runOfDoc(docOf(block));
    expect(eventsOf(run, "contamination_onset").map((e) => e.t)).toEqual([18_036]);
    expect(eventsOf(run, "signal_observed").map((e) => e.t)).toEqual([61_260]);
    expect(processOf(run, "unit_stopped")).toEqual([["U01", 61_260 + H(2), "-"]]);
    // the true DO reaches the low alarm at that very tick, and was still above it a tick before
    const doSeries = run.sensors.find((s) => s.unit_id === "U01" && s.signal === "DO");
    expect(doSeries?.truth[61_260 / 60]).toBe(20);
    expect((doSeries?.truth[61_260 / 60 - 1] as number) > 20).toBe(true);
  });
});
