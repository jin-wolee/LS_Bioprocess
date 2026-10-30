import { beforeAll, describe, expect, it } from "vitest";
import type { BreakoutConfig } from "../../src/breakout/config.ts";
import { observeEvents } from "../../src/observe.ts";
import { investigate, signalsOf } from "../../src/record/investigate/investigate.ts";
import type { Investigation } from "../../src/record/investigate/investigate.ts";
import { record } from "../../src/record/recorder.ts";
import type { BreakoutInput } from "../../src/record/types.ts";
import { CFG, config } from "../support/investigate_setup.ts";
import { H, configOf, docOf, fx12a, fx12e, h, runOfDoc } from "./support.ts";

// Break-out batch 4, end to end: the stream the engine itself produces for FX12a and FX12e (batch 2) goes through the recorder (batch 3) and the investigation. The routine samples are the
// engine's own (dozens per unit), so the expected values are the ones the fixture texts fix without them: the decision and the first holds at 19 h, the second at 23 h, the reach of direction 3
// per configuration, the conversion at 143 h and the review point at 152 h, the release of the clean sibling at 359 h and the lots of the positive. Test-only settings as in 11.8.4: d1 2 h,
// d2 4 h, assumed lag 12 h.

const masterOf = (b: BreakoutConfig): BreakoutInput => ({
  lots: b.lots.map((l) => ({ lot_id: l.lot_id, kind: l.kind, prepared_at: l.prepared_s })),
  equipment: b.equipment.map((e) => ({ equipment_id: e.equipment_id, name: e.name })),
});
const investigated = (doc: ReturnType<typeof docOf>, name: "A" | "B" | "C" | "C-L" | "C-E"): Investigation => {
  const cfg = configOf(doc);
  const events = observeEvents(runOfDoc(doc).events);
  return investigate(record({ events, sensors: [], breakout: masterOf(cfg.breakout as BreakoutConfig) }, config(name)), signalsOf(events), CFG);
};
const heldAt = (inv: Investigation, t: number) => (inv.dataset.quality_hold ?? []).filter((h) => h.placed_at === t).map((h) => `${h.target_kind}:${h.target_id}`);

describe("FX12a from the engine, investigated under C", () => {
  let inv: Investigation;
  beforeAll(() => {
    inv = investigated(docOf(fx12a()), "C");
  });
  it("Then one walk is made, at 19 h, from the estimated onset 5 h, and the batch, the three lots and the sibling batch are held at 19 h (the engine draws its first routine sample on day 1, so no result exists yet)", () => {
    expect(inv.walks.map((w) => [w.decision_at, w.estimated_onset])).toEqual([[H(19), H(5)]]);
    expect(heldAt(inv, H(19)).sort()).toEqual(["batch:B-U01", "batch:B-U02", "material_lot:ML-1", "material_lot:ML-2", "material_lot:SL-1"]);
    expect(inv.dataset.result.filter((r) => r.hold_id != null)).toEqual([]);
  });
  it("Then the holds of the batch of U01 and of the lots become quarantine at 143 h and are rejected at 152 h; the hold of the clean sibling is released at 359 h; the deviation is closed then", () => {
    const by = (id: string) => (inv.dataset.quality_hold ?? []).find((h) => h.target_id === id);
    for (const id of ["B-U01", "SL-1", "ML-1", "ML-2"]) expect([id, by(id)?.kind, by(id)?.outcome, by(id)?.released_at]).toEqual([id, "quarantine", "rejected", H(152)]);
    expect([by("B-U02")?.kind, by("B-U02")?.outcome, by("B-U02")?.released_at]).toEqual(["hold", "released", H(359)]);
    expect(inv.events.filter((e) => e.type === "hold_quarantined").map((e) => e.t)).toEqual([H(143), H(143), H(143), H(143)]);
    expect((inv.dataset.deviation ?? []).map((d) => [d.state, d.closed_at])).toEqual([["closed", H(359)]]);
  });
});

describe("FX12a from the engine with ML-2 consumed at 30 h: routine results exist before the decision", () => {
  // onset 30 h, signal 42 h, decision 44 h, estimated onset 30 h; the confirming draws at 44 h; bioburden at 164 h, sterility at 380 h. The positive of U01 at 164 h + 4 h = 168 h becomes
  // quarantine; 168 h is a Monday 00:00 (day 7), so the next review point is 08:00 = 176 h. The clean sibling is released at 380 h + 4 h = 384 h.
  let inv: Investigation;
  beforeAll(() => {
    const block = fx12a() as { topology: { consumption: { lot_id: string; at?: unknown }[] } };
    const late = structuredClone(block);
    (late.topology.consumption.find((c) => c.lot_id === "ML-2") as { at: unknown }).at = h(30);
    inv = investigated(docOf(late as never), "C");
  });
  it("Then the decision is at 44 h from the onset 30 h, and results of both batches are held and flagged", () => {
    expect(inv.walks.map((w) => [w.decision_at, w.estimated_onset])).toEqual([[H(44), H(30)]]);
    expect((inv.dataset.quality_hold ?? []).filter((x) => x.target_kind === "result").length).toBeGreaterThan(1);
    const flagged = inv.dataset.result.filter((r) => r.hold_id != null);
    expect(flagged.length).toBe((inv.dataset.quality_hold ?? []).filter((x) => x.target_kind === "result").length);
    for (const v of flagged) expect([v.version, v.value, v.ingested_at]).toEqual([2, inv.dataset.result.find((r) => r.result_id === v.supersedes)?.value, H(44)]);
  });
  it("Then the versions of U01 are rejected at 176 h with their values kept, those of U02 released at the review point after 384 h, and the deviation is closed at 384 h", () => {
    const flagged = inv.dataset.result.filter((r) => r.hold_id != null);
    const of = (unit: string) => flagged.filter((r) => r.request_id.startsWith(`${unit}-`));
    expect(of("U01").length).toBeGreaterThan(0);
    expect(of("U01").every((v) => v.state === "rejected" && v.reviewed_at === H(176) && v.available_at === null)).toBe(true);
    expect(of("U02").length).toBeGreaterThan(0);
    expect(of("U02").every((v) => v.state === "released" && v.reviewed_at === v.available_at && (v.reviewed_at as number) >= H(384))).toBe(true);
    expect((inv.dataset.deviation ?? []).map((d) => [d.state, d.closed_at])).toEqual([["closed", H(384)]]);
  });
});

describe("FX12e from the engine, investigated under C, C-L and C-E", () => {
  const out: Record<string, Investigation> = {};
  beforeAll(() => {
    for (const n of ["C", "C-L", "C-E"] as const) out[n] = investigated(docOf(fx12e()), n);
  });
  it("Then two walks are made, at 19 h and at 23 h", () => {
    for (const n of ["C", "C-L", "C-E"]) expect(out[n]?.walks.map((w) => w.decision_at), n).toEqual([H(19), H(23)]);
  });
  it("Then the transfer line and the sibling batch are held at 19 h with the equipment edge (C, C-L) and not without it (C-E), where the sibling is held at 23 h by its own signal", () => {
    for (const n of ["C", "C-L"]) {
      expect(heldAt(out[n] as Investigation, H(19)), n).toEqual(expect.arrayContaining(["equipment:TL-1", "batch:B-U02"]));
    }
    expect(heldAt(out["C-E"] as Investigation, H(19))).not.toContain("batch:B-U02");
    expect(heldAt(out["C-E"] as Investigation, H(23))).toContain("batch:B-U02");
  });
});
