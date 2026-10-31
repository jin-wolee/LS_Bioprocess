import { describe, expect, it } from "vitest";
import { investigate, signalsOf } from "../../src/record/investigate/investigate.ts";
import { record } from "../../src/record/recorder.ts";
import { FX12A, FX12A_MASTER, FX12E, FX12E_MASTER, H, confirming } from "../support/breakout_streams.ts";
import { byTime } from "../support/cell_stream.ts";
import { CONFIGS } from "../support/cells.ts";
import { CFG, config, names, nameOf, placedAt, rec, recAs, run } from "../support/investigate_setup.ts";

// Break-out batch 4: what the investigation refuses, what it leaves alone and what it does when nothing decides a hold. Expected values are typed from the rules of 11.8.2 S9 and the clarifications
// C20 to C24 of 11.8.10.

describe("The guards", () => {
  it("Given a record made without the master data of a topology When it is investigated Then it is refused", () => {
    const plain = record({ events: FX12A, sensors: [] }, config("C"));
    expect(() => investigate(plain, [], CFG)).toThrow(/no break-out tables/);
  });

  it("Given a dataset that holds holds already When it is investigated again Then it is refused: an investigation runs once, on the record as recorded", () => {
    const once = run(FX12A, FX12A_MASTER, "C").dataset;
    expect(() => investigate(once, signalsOf(FX12A), CFG)).toThrow(/already/);
  });

  it("Given a signal before any deviation is opened When it is investigated Then it is refused, naming the unit", () => {
    expect(() => investigate(rec(FX12A, FX12A_MASTER, "C"), [{ unit_id: "U01", batch_id: "B-U01", at: H(1) }], CFG)).toThrow(/no deviation is open.*U01/);
  });

  it("Given no signal When the investigation runs Then nothing changes and no walk is made", () => {
    const ds = rec(FX12A, FX12A_MASTER, "C");
    const inv = investigate(ds, [], CFG);
    expect(inv.dataset).toEqual({ ...ds, material_lot: ds.material_lot, equipment: ds.equipment });
    expect([inv.walks, inv.events]).toEqual([[], []]);
  });

  it("Given a record When it is investigated Then the record is left as it was, and a second run gives the same bytes", () => {
    const ds = rec(FX12E, FX12E_MASTER, "C");
    const before = structuredClone(ds);
    const first = investigate(ds, signalsOf(FX12E), CFG);
    expect(ds).toEqual(before);
    expect(JSON.stringify(investigate(ds, signalsOf(FX12E), CFG))).toBe(JSON.stringify(first));
  });

  it("Given the observable stream When the signals are taken Then they are the signal_observed events in time order and nothing else", () => {
    expect(signalsOf(FX12E)).toEqual([{ unit_id: "U01", batch_id: "B-U01", at: H(17) }, { unit_id: "U02", batch_id: "B-U02", at: H(21) }]);
    expect(signalsOf([])).toEqual([]);
  });
});

describe("A hold that no confirming sample decides", () => {
  // FX12a with the confirming draws and results taken out of the stream: nothing can quarantine or release a hold.
  const NONE = FX12A.filter((e) => e.type !== "confirm_sample_drawn" && e.type !== "confirm_result");
  const inv = run(NONE, FX12A_MASTER, "C");
  it("Then the ten holds stay under test, the versions stay quarantined and the deviation stays open", () => {
    const ds = inv.dataset;
    expect(ds.quality_hold?.length).toBe(10);
    expect((ds.quality_hold ?? []).every((h) => h.state === "under_test" && h.kind === "hold" && h.outcome === null && h.released_at === null)).toBe(true);
    expect(ds.result.filter((r) => r.hold_id != null).map((r) => r.state)).toEqual(Array(5).fill("quarantined"));
    expect((ds.deviation ?? []).map((d) => [d.state, d.closed_at, d.estimated_onset])).toEqual([["contained", null, H(5)]]);
    expect([...new Set(inv.events.map((e) => e.type))].sort()).toEqual(["hold_placed", "result_reflagged"]);
  });
  it("Then the lots under the holds are on hold, not quarantined", () => {
    expect((inv.dataset.material_lot ?? []).filter((l) => l.state === "on_hold").map((l) => l.lot_id)).toEqual(["SL-1", "ML-1", "ML-2"]);
  });
});

describe("An item whose hold has ended is held again by a later signal", () => {
  // FX12e with both units not detected. Each signal draws its own confirming sample and its holds wait for it (rule S2 as ruled on F8, C22): the holds of 19 h are released at 355 h + 4 h = 359 h,
  // those of 23 h (U02-SIG-CONF) at 359 h + 4 h = 363 h. A third signal of U02 at 500 h (decision 502 h, estimated onset 488 h) draws its own sample at 502 h (a test-only id) and finds nothing held:
  // the batch of U02, the lots of U02, the transfer line, the batch of U01 (a sibling through TL-1) and its two results since 5 h are held again, and released by that sample's negative verdict at
  // 502 + 336 + 4 = 842 h. The versions of the first round (5, released again at 368 h) are not flagged again: a later version exists.
  const NEGATIVE = byTime([
    ...FX12E.filter((e) => e.type !== "confirm_sample_drawn" && e.type !== "confirm_result"),
    ...confirming("U01", 19, "not_detected"), ...confirming("U02", 19, "not_detected"), ...confirming("U02", 23, "not_detected", "U02-SIG-CONF"), ...confirming("U02", 502, "not_detected", "U02-THIRD-CONF"),
  ]);
  const third = { unit_id: "U02", batch_id: "B-U02", at: H(500) };
  const inv = investigate(rec(NEGATIVE, FX12E_MASTER, "C"), [...signalsOf(NEGATIVE), third], CFG);
  const ds = inv.dataset;
  const releasedAt = (placed: number) => [...new Set((ds.quality_hold ?? []).filter((h) => h.placed_at === placed).map((h) => `${h.outcome} ${h.released_at}`))];
  it("Then the holds of 19 h are released at 359 h and those of 23 h at 363 h, and the third signal places the seven items again at 502 h", () => {
    expect(placedAt(ds, H(502))).toEqual(names("batch:B-U01", "batch:B-U02", "equipment:TL-1", "material_lot:ML-2", "material_lot:SL-2", "result:U01-S2", "result:U01-S3"));
    expect([releasedAt(H(19)), releasedAt(H(23))]).toEqual([[`released ${H(359)}`], [`released ${H(363)}`]]);
  });
  it("Then the new holds are decided by the third signal's own sample, at 842 h, and no version is made again", () => {
    expect(releasedAt(H(502))).toEqual([`released ${H(842)}`]);
    expect(ds.result.filter((r) => r.hold_id != null).length).toBe(5);
    expect((ds.deviation ?? []).map((d) => [d.state, d.closed_at])).toEqual([["closed", H(842)]]);
  });
  it("Then a hold on a result names the result by its request, as the tables do", () => {
    const h = (ds.quality_hold ?? []).find((x) => x.placed_at === H(502) && x.target_kind === "result");
    expect(nameOf(ds, "result", h?.target_id as string)).toMatch(/^result:U01-S[23]$/);
  });
});

describe("VR-022 needs all three flags (spec 11.8.2 S11; orchestrator ruling of 2026-10-31: no overwrite in place in S3)", () => {
  // C without available_at, append_only_versions or audit_trail still walks back and places the ten holds of FX12a; VR-022 is not evaluable, so every released result under a hold stays released,
  // no version and no audit event of a flag exists, and the record of the results is exactly what the recorder wrote.
  const CONFIGS_OFF = ["C-available_at", "C-append_only_versions", "C-audit_trail"] as const;
  it.each(CONFIGS_OFF)("Given %s Then ten holds are placed, VR-022 is not evaluable naming the flag, and no result is touched", (name) => {
    const flag = name.slice(2);
    const arch = (CONFIGS.find((c) => c.name === name) as (typeof CONFIGS)[number]).config;
    const ds = recAs(FX12A, FX12A_MASTER, arch);
    const inv = investigate(ds, signalsOf(FX12A), CFG);
    expect(inv.not_evaluable.map((x) => x.rule)).toEqual(["VR-022"]);
    expect(inv.not_evaluable[0]?.reason).toMatch(new RegExp(flag));
    expect(inv.dataset.quality_hold?.length).toBe(10);
    expect(inv.dataset.result).toEqual(ds.result);
    expect(inv.dataset.audit_event).toEqual(ds.audit_event);
    expect(inv.events.some((e) => e.type === "result_reflagged")).toBe(false);
    expect(inv.dataset.validation_finding.filter((f) => f.rule === "VR-022")).toEqual([]);
  });
  it("Given C without audit_trail Then the holds keep no person and no reason (the hold is a record without who and why)", () => {
    const arch = (CONFIGS.find((c) => c.name === "C-audit_trail") as (typeof CONFIGS)[number]).config;
    const inv = investigate(recAs(FX12A, FX12A_MASTER, arch), signalsOf(FX12A), CFG);
    expect((inv.dataset.quality_hold ?? []).every((h) => h.placed_by === null && h.reason === null)).toBe(true);
  });
});
