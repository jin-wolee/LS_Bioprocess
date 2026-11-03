import { describe, expect, it } from "vitest";
import type { TruthOverlay } from "../protocol.ts";
import { breakoutAt } from "./breakout_at.ts";
import { casePlan } from "./fixture_case.ts";

// P7c (docs/design/plant_ui.md section 3.3, "As built in P7c"): what the truth overlay draws of a break-out case at an instant, from the answer of `{ breakout: true }`. The origin is marked from the instant
// it became contaminated (hours, in the answer, turned into seconds: 1 h is 3600 s), or, for a sampling origin that has no such instant, from the draw of the sample it names; a unit reached is marked from
// its onset. Expected values are typed by hand from the case of fixture_case.ts: U01 is unit 0 and U02 unit 1; the sample U01-D00-3 (index 2) is drawn at 3000 s on U01.

type Breakout = Extract<TruthOverlay, { kind: "breakout" }>;
const answer = (origin_kind: string, origin_id: string, hours: number | null, affected: Breakout["affected"] = []): Breakout => ({
  kind: "breakout",
  event: { type: "bacterial", profile: "p", origin_kind, origin_id, horizon_days: 1, horizon_ref: "A189", contaminated_at: hours === null ? null : { value: hours, unit: "h", ref: "A157" } },
  affected,
});
const plan = casePlan();

describe("a lot as the origin (ML-1, contaminated at 1 h = 3600 s)", () => {
  const a = answer("medium_lot", "ML-1", 1, [{ unit: 0, onset_s: 3000 }, { unit: 1, onset_s: 6000 }]);

  it("Given the instants around it Then the origin is marked from 3600 s and not before", () => {
    expect(breakoutAt(plan, a, 3599).origin).toBeNull();
    expect(breakoutAt(plan, a, 3600).origin).toEqual({ kind: "lot", index: 0, id: "ML-1" });
    expect(breakoutAt(plan, a, 40000).origin).toEqual({ kind: "lot", index: 0, id: "ML-1" });
  });

  it("Given the onsets Then a unit is reached from its onset: U01 at 3000 s, U02 at 6000 s", () => {
    expect(breakoutAt(plan, a, 2999).reached).toEqual([]);
    expect(breakoutAt(plan, a, 3000).reached).toEqual([{ unit: 0, onset_s: 3000 }]);
    expect(breakoutAt(plan, a, 5999).reached).toEqual([{ unit: 0, onset_s: 3000 }]);
    expect(breakoutAt(plan, a, 6000).reached).toEqual([{ unit: 0, onset_s: 3000 }, { unit: 1, onset_s: 6000 }]);
  });
});

describe("the other origins", () => {
  it("Given a seed lot contaminated at 0 h Then it is marked from the start", () => {
    expect(breakoutAt(plan, answer("seed_lot", "SL-A", 0), 0).origin).toEqual({ kind: "lot", index: 2, id: "SL-A" });
  });

  it("Given a shared equipment item contaminated at 2 h = 7200 s Then it is marked from 7200 s", () => {
    const a = answer("shared_equipment", "TL-1", 2);
    expect(breakoutAt(plan, a, 7199).origin).toBeNull();
    expect(breakoutAt(plan, a, 7200).origin).toEqual({ kind: "equipment", index: 0, id: "TL-1" });
  });

  it("Given the equipment of a unit contaminated at 2 h Then the origin is that vessel", () => {
    expect(breakoutAt(plan, answer("unit_equipment", "U02", 2), 7200).origin).toEqual({ kind: "unit", index: 1, id: "U02" });
  });

  it("Given a sampling origin, which has no instant of its own Then it is marked on the vessel the sample was drawn from, from the draw (U01-D00-3 at 3000 s)", () => {
    const a = answer("sampling", "U01-D00-3", null);
    expect(breakoutAt(plan, a, 2999).origin).toBeNull();
    expect(breakoutAt(plan, a, 3000).origin).toEqual({ kind: "unit", index: 0, id: "U01" });
  });

  it("Given an origin the plan does not hold, or of a kind the page does not know Then nothing is marked (the units reached still are)", () => {
    expect(breakoutAt(plan, answer("medium_lot", "ML-9", 0), 9000).origin).toBeNull();
    expect(breakoutAt(plan, answer("sampling", "U09-D01-1", null), 9000).origin).toBeNull();
    expect(breakoutAt(plan, answer("comet", "ML-1", 0, [{ unit: 0, onset_s: 10 }]), 9000)).toEqual({ origin: null, reached: [{ unit: 0, onset_s: 10 }] });
  });

  it("Given the same instants in another order Then the same answers (a pure function)", () => {
    const a = answer("medium_lot", "ML-1", 1, [{ unit: 0, onset_s: 3000 }]);
    const ts = [6000, 0, 3600, 2999, 3000];
    const first = ts.map((t) => JSON.stringify(breakoutAt(plan, a, t)));
    expect([...ts].reverse().map((t) => JSON.stringify(breakoutAt(plan, a, t))).reverse()).toEqual(first);
  });
});
