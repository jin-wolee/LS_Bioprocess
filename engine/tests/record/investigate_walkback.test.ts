import { describe, expect, it } from "vitest";
import type { ObservableEvent } from "../../src/observe.ts";
import { signalsOf } from "../../src/record/investigate/investigate.ts";
import { walkBack } from "../../src/record/investigate/walkback.ts";
import type { LineageEdgeRow, ProcessEventRow, RecordedDataset } from "../../src/record/types.ts";
import { FX12A, FX12A_MASTER, FX12E, FX12E_MASTER, H, inoculationFrom, routine } from "../support/breakout_streams.ts";
import { byTime } from "../support/cell_stream.ts";
import { CONFIGS } from "../support/cells.ts";
import { ALL, names, rec, recAs, returned } from "../support/investigate_setup.ts";
import type { Name } from "../support/investigate_setup.ts";

// Break-out batch 4, direction 1 and direction 3 of the walk-back (spec 11.4 L5, 11.8.2 rule S8; data_model 15.4), on hand-built variants of FX12a and FX12e. Expected values are typed from the
// rules: direction 1 takes the batch and its results at or after signal minus assumed lag; direction 3 goes exactly one step back along consumed_in, seeded_from and used_in to the lots, the
// seed parent and the equipment, forward from those to the other batches, and for each of those the results at or after its first use of the shared item; every read is as of the decision time.

const walk = (ds: RecordedDataset, events: readonly ObservableEvent[], at = H(19), lag = H(12)) => walkBack(ds, (signalsOf(events)[0] as ReturnType<typeof signalsOf>[number]), at, lag);
const items = (w: ReturnType<typeof walk>, ds: RecordedDataset, direction: 1 | 3) => returned(w.items.filter((i) => i.direction === direction), ds);

describe("Direction 1 and the assumed lag (rule S1: a shorter lag loses recall, a longer one loses precision)", () => {
  it.each(ALL)("Given %s When the assumed lag is 6 h Then the estimated onset is 11 h and only U01-S3 (14 h) is returned with the batch", (n: Name) => {
    const ds = rec(FX12A, FX12A_MASTER, n);
    expect(items(walk(ds, FX12A, H(19), H(6)), ds, 1)).toEqual(names("batch:B-U01", "result:U01-S3"));
  });
  it.each(ALL)("Given %s When the assumed lag is 24 h Then the estimated onset is before the first draw and all three results are returned", (n: Name) => {
    const ds = rec(FX12A, FX12A_MASTER, n);
    expect(items(walk(ds, FX12A, H(19), H(24)), ds, 1)).toEqual(names("batch:B-U01", "result:U01-S1", "result:U01-S2", "result:U01-S3"));
  });
});

describe("Direction 3 goes exactly one step back", () => {
  // U04 is seeded from SL-2, the seed lot of U02, and shares nothing with U01. A walk of two steps back (from the sibling U02 to its own lots and on to its siblings) would reach U04.
  const U04: ObservableEvent[] = [inoculationFrom("U04", "SL-2"), ...routine("U04", 1, 6)];
  const TWO = byTime([...FX12A, ...U04]);
  it("Given a batch two steps from U01 When the walk-back of U01 runs under C Then U04, its result and the seed lot SL-2 are not returned, and the rest is the FX12a cell", () => {
    const ds = rec(TWO, FX12A_MASTER, "C");
    const w = walk(ds, TWO);
    expect(items(w, ds, 3)).toEqual(names("material_lot:SL-1", "material_lot:ML-1", "material_lot:ML-2", "batch:B-U02", "result:U02-S1", "result:U02-S2", "result:U02-S3"));
    expect(items(w, ds, 1)).toEqual(names("batch:B-U01", "result:U01-S2", "result:U01-S3"));
  });
  it("Given the same stream Then U04 is a sibling of U02 when U02 is the signalling batch (one step from U02)", () => {
    const ds = rec(TWO, FX12A_MASTER, "C");
    const w = walkBack(ds, { unit_id: "U02", batch_id: "B-U02", at: H(17) }, H(19), H(12));
    expect(items(w, ds, 3)).toContain("batch:B-U04");
  });
});

describe("A flag that is off hides its edges even if the dataset holds them (rule S8)", () => {
  it("Given B with the lot rows and the lot edges of C grafted on When direction 3 runs Then lots are not reachable and no lot or sibling through a lot is returned", () => {
    const b = rec(FX12A, FX12A_MASTER, "B");
    const c = rec(FX12A, FX12A_MASTER, "C");
    const grafted: RecordedDataset = { ...b, material_lot: c.material_lot ?? [], lineage_edge: [...(b.lineage_edge ?? []), ...(c.lineage_edge ?? [])] };
    const w = walk(grafted, FX12A);
    expect(w.reachable).toEqual({ direction3: true, lots: false, equipment: true });
    expect(items(w, grafted, 3)).toEqual([]);
  });
  it("Given C-E with the equipment row and the used_in edges of C grafted on When direction 3 runs Then equipment is not reachable and TL-1 and B-U02 are not returned through it", () => {
    const e = rec(FX12E, FX12E_MASTER, "C-E");
    const c = rec(FX12E, FX12E_MASTER, "C");
    const grafted: RecordedDataset = { ...e, equipment: c.equipment ?? [], lineage_edge: [...(e.lineage_edge ?? []), ...(c.lineage_edge ?? []).filter((x) => x.relation === "used_in")] };
    const w = walk(grafted, FX12E);
    expect(w.reachable).toEqual({ direction3: true, lots: true, equipment: false });
    expect(items(w, grafted, 3)).toEqual(names("material_lot:SL-1", "material_lot:ML-1"));
  });
});

describe("The as-of cut at the decision time (data_model section 5 and 15.4)", () => {
  // U03 consumes the lot ML-1 that U01 consumed, entered into the record at 25 h: the consumption took place at 15 h (back-dated) or at 30 h (later).
  const lateEvent = (id: string, at: number, ingested: number): ProcessEventRow => ({ event_id: id, batch_id: "B-U03", unit_id: "U03", kind: "medium_addition", occurred_at: at, amount: null, source: "scripted", ingested_at: ingested, lot_id: "ML-1", equipment_id: null });
  const lateEdge = (id: string, event: string, at: number, available: number | null): LineageEdgeRow => ({ edge_id: id, from_kind: "material_lot", from_id: "ML-1", to_kind: "process_event", to_id: event, relation: "consumed_in", occurred_at: at, available_at: available });
  const withLate = (ds: RecordedDataset, stamped: boolean, at: number, entered: number): RecordedDataset => ({
    ...ds, process_event: [...ds.process_event, lateEvent("PE99", at, entered)], lineage_edge: [...(ds.lineage_edge ?? []), lateEdge("E99", "PE99", at, stamped ? entered : null)],
  });
  const strict = (): RecordedDataset => rec(FX12A, FX12A_MASTER, "C");
  const loose = (): RecordedDataset => recAs(FX12A, FX12A_MASTER, (CONFIGS.find((c) => c.name === "C-available_at") as (typeof CONFIGS)[number]).config);

  it("Given available_at on When a consumption of 15 h is entered at 25 h Then the walk-back at 19 h does not know it and U03 is not a sibling", () => {
    const ds = withLate(strict(), true, H(15), H(25));
    const w = walk(ds, FX12A);
    expect(items(w, ds, 3)).not.toContain("batch:B-U03");
    expect(items(w, ds, 3)).not.toContain("result:U03-S3");
  });
  it("Given available_at on When the walk-back is as of 26 h Then U03 is a sibling and its result since 15 h (U03-S3 at 16 h) is returned, U03-S2 (10 h) is not", () => {
    const ds = withLate(strict(), true, H(15), H(25));
    const w = walk(ds, FX12A, H(26));
    expect(items(w, ds, 3)).toEqual(expect.arrayContaining(["batch:B-U03", "result:U03-S3"]));
    expect(items(w, ds, 3)).not.toContain("result:U03-S2");
  });
  it("Given available_at off (C without it) When the same late entry is read at 19 h Then it leaks: only its valid time, 15 h, can cut, and U03 is a sibling", () => {
    const ds = withLate(loose(), false, H(15), H(25));
    const w = walk(ds, FX12A);
    expect(items(w, ds, 3)).toEqual(expect.arrayContaining(["batch:B-U03", "result:U03-S3"]));
  });
  it.each([["available_at on", true], ["available_at off", false]] as const)("Given %s When a consumption of 30 h is entered at 30 h Then it is a sibling as of 31 h and not as of 19 h", (_label, stamped) => {
    const ds = withLate(stamped ? strict() : loose(), stamped, H(30), H(30));
    expect(items(walk(ds, FX12A, H(19)), ds, 3)).not.toContain("batch:B-U03");
    expect(items(walk(ds, FX12A, H(31)), ds, 3)).toContain("batch:B-U03");
  });
  it("Given FX12e under B (no available_at) When direction 3 runs at 19 h Then U02-S4 (drawn at 20 h, measured at 21 h) is not returned: a result is cut by its own time", () => {
    const ds = rec(FX12E, FX12E_MASTER, "B");
    expect(items(walk(ds, FX12E), ds, 3)).toEqual(names("equipment:TL-1", "batch:B-U02", "result:U02-S2", "result:U02-S3"));
  });
});
