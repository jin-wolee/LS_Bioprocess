import { beforeAll, describe, expect, it } from "vitest";
import type { BreakoutConfig } from "../../src/breakout/config.ts";
import { observeEvents } from "../../src/observe.ts";
import { investigate, signalsOf } from "../../src/record/investigate/investigate.ts";
import type { Investigation } from "../../src/record/investigate/investigate.ts";
import { record } from "../../src/record/recorder.ts";
import type { BreakoutInput, RecordedDataset } from "../../src/record/types.ts";
import { validate } from "../../src/record/validate.ts";
import { CFG, config } from "../support/investigate_setup.ts";
import type { Json } from "../support/schemas.ts";
import { H, configOf, runOfDoc } from "./support.ts";
import { docOfM, fx12m } from "./support_m.ts";

// Break-out batch 5, end to end: the stream the engine itself produces for FX12m (the mycoplasma profile, 31 days) goes through the recorder (batch 3) and the investigation (batch 4). The routine
// samples are the engine's own (dozens per unit), so the expected values are the ones the fixture text of 11.8.4 fixes without them: the signal at 53 h, the decision at 55 h, the three tests with
// their names and results, the holds on the batches and the lots at 55 h, the conversion at 83 h (i) or 251 h (ii) and the review point at 85 h or 253 h, the release of the clean sibling at 731 h and
// the closing of the deviation. d1 2 h, d2 4 h, assumed lag 48 h (test-only settings as in 11.8.4).

const CFG_M = { ...CFG, assumed_lag_s: H(48) };
const masterOf = (b: BreakoutConfig): BreakoutInput => ({
  lots: b.lots.map((l) => ({ lot_id: l.lot_id, kind: l.kind, prepared_at: l.prepared_s })),
  equipment: b.equipment.map((e) => ({ equipment_id: e.equipment_id, name: e.name })),
});
const recorded = (doc: Json, name: "A" | "B" | "C" | "C-L" | "C-E"): { ds: RecordedDataset; inv: Investigation } => {
  const cfg = configOf(doc);
  const events = observeEvents(runOfDoc(doc).events);
  const input = { events, sensors: [], breakout: masterOf(cfg.breakout as BreakoutConfig) };
  const ds = record(input, config(name));
  return { ds, inv: investigate(record(input, config(name)), signalsOf(events), CFG_M) };
};
const placed = (inv: Investigation, kinds: string[]): string[] => (inv.dataset.quality_hold ?? []).filter((h) => kinds.includes(h.target_kind)).map((h) => `${h.target_kind}:${h.target_id}`).sort();

describe("FX12m as the engine produces it, recorded under C", () => {
  let ds: RecordedDataset;
  beforeAll(() => {
    ds = recorded(docOfM(fx12m()), "C").ds;
  });

  it("Then the stop of U01 is a process event at 55 h, the deviation DEV-1 is opened at 53 h for B-U01, and no hold exists", () => {
    expect(ds.process_event.filter((p) => p.kind === "unit_stopped").map((p) => [p.unit_id, p.occurred_at, p.source])).toEqual([["U01", H(55), "scripted"]]);
    expect((ds.deviation ?? []).map((d) => [d.deviation_id, d.batch_id, d.opened_at, d.trigger, d.state])).toEqual([["DEV-1", "B-U01", H(53), "signal", "opened"]]);
    expect(ds.quality_hold).toEqual([]);
  });

  it("Then the confirming samples are drawn at 55 h and the six results arrive at 79 h, 247 h and 727 h under the names of the tests, with an outcome and no value", () => {
    expect(ds.sample.filter((s) => s.sample_id.endsWith("-CONF")).map((s) => [s.sample_id, s.sampled_at])).toEqual([["U01-CONF", H(55)], ["U02-CONF", H(55)]]);
    const confirming = ds.result.filter((r) => r.outcome != null);
    expect(confirming.map((r) => [r.request_id, r.analyte, r.measured_at, r.outcome])).toEqual([
      ["U01-CONF", "nucleic_acid_test", H(79), "detected"], ["U02-CONF", "nucleic_acid_test", H(79), "not_detected"],
      ["U01-CONF", "mycoplasma_indicator_cells", H(247), "detected"], ["U02-CONF", "mycoplasma_indicator_cells", H(247), "not_detected"],
      ["U01-CONF", "mycoplasma_culture", H(727), "detected"], ["U02-CONF", "mycoplasma_culture", H(727), "not_detected"],
    ]);
    expect(confirming.every((r) => r.value === null)).toBe(true);
    expect(ds.run.filter((r) => r.request_id.endsWith("-CONF") && r.ended_at === null)).toEqual([]);
  });

  it("Then VR-021 is silent on the generated record, and no finding concerns a confirming row", () => {
    const v = validate(ds, { hold_limit_s: 86400 });
    expect(v.dataset.validation_finding.filter((f) => f.rule === "VR-021")).toEqual([]);
    expect(v.dataset.validation_finding.filter((f) => f.target.includes("-CONF"))).toEqual([]);
  });
});

describe.each([
  ["i", 1, H(83), H(85)],
  ["ii", 0, H(251), H(253)],
] as const)("FX12m-%s from the engine, investigated under C", (_title, nat, quarantineAt, reviewAt) => {
  let inv: Investigation;
  beforeAll(() => {
    inv = recorded(docOfM(fx12m({ nat })), "C").inv;
  });

  it("Then one walk is made, at 55 h, from the estimated onset 5 h, and the batch, the three lots and the sibling batch are held at 55 h", () => {
    expect(inv.walks.map((w) => [w.decision_at, w.estimated_onset])).toEqual([[H(55), H(5)]]);
    expect(placed(inv, ["batch", "material_lot"])).toEqual(["batch:B-U01", "batch:B-U02", "material_lot:ML-1", "material_lot:ML-2", "material_lot:SL-1"]);
    expect((inv.dataset.quality_hold ?? []).every((h) => h.placed_at === H(55))).toBe(true);
  });

  it("Then the holds on the batch of U01 and on the lots become quarantine at the first positive plus d2 and are rejected at the next review point", () => {
    const by = (id: string) => (inv.dataset.quality_hold ?? []).find((h) => h.target_id === id);
    for (const id of ["B-U01", "SL-1", "ML-1", "ML-2"]) expect([id, by(id)?.kind, by(id)?.outcome, by(id)?.released_at]).toEqual([id, "quarantine", "rejected", reviewAt]);
    const quarantined = inv.events.filter((e) => e.type === "hold_quarantined").map((e) => e.t);
    expect(quarantined.length).toBeGreaterThanOrEqual(4);
    expect(quarantined.every((t) => t === quarantineAt)).toBe(true);
  });

  it("Then the hold of the clean sibling is released at the culture result plus d2, 731 h, and the deviation is closed then", () => {
    const sibling = (inv.dataset.quality_hold ?? []).find((h) => h.target_id === "B-U02");
    expect([sibling?.kind, sibling?.outcome, sibling?.released_at]).toEqual(["hold", "released", H(731)]);
    expect((inv.dataset.deviation ?? []).map((d) => [d.state, d.closed_at, d.estimated_onset, d.assumed_lag])).toEqual([["closed", H(731), H(5), H(48)]]);
  });
});
