import { describe, expect, it } from "vitest";
import type { PlanCard, ScenePlan } from "../protocol.ts";
import { handPlan } from "./fixture.ts";
import { hallsAt, hallsEpoch } from "./halls_at.ts";

// P5a (docs/design/plant_ui.md sections 3.3, 4.2 and 4.3): `hallsAt(plan, t)`, the cards on the shelves at an instant as a pure function of the plan, beside `sceneAt`. The hand plan of fixture.ts
// gets three halls, with every instant typed by hand:
//   A (no flag on): the cards of samples 4, 1 and 0 (given in that order), shown at 2970, 2900 and 2700 s; the record stores no availability, no sampled_at and no version stack.
//   C (available_at and append_only_versions): sample 2 (U01-D00-3, a failed QC run and a rerun) shown at 3700 s, available at 4510 s, its first version written at 3970 s and its second at 4510 s,
//       a finding VR-012 raised at 3970 s on the first and VR-010 at 4510 s on the second; samples 0 and 1, both shown at 2700 s, the first available at 2970 s.
//   B: a record with no card.
// The place of a card on the shelves is its rank by (shown_s, then sample index) among all the cards of its hall, whatever the instant.

const slots = (sampled: boolean): PlanCard["slots"] => [
  { name: "unit", stored: true }, { name: "sampled_at", stored: sampled }, sampled ? { name: "context", stored: true, basis: "sampled_at" } : { name: "context", stored: true, basis: "measured_at" }, { name: "value", stored: true },
];
const card = (sample: number, shown_s: number, extra: Partial<PlanCard> = {}, sampled = false): PlanCard => ({ sample, shown_s, available_s: null, slots: slots(sampled), findings: [], version_s: [shown_s + 100], ...extra });

const plan = (): ScenePlan => ({
  ...handPlan(),
  layout: { ...handPlan().layout, architectures: ["a_manual", "b_lims_lite", "c_context"] },
  records: [
    { architecture: "a_manual", flags_on: [], cards: [card(4, 2970), card(1, 2900), card(0, 2700)] },
    { architecture: "b_lims_lite", flags_on: ["audit_trail"], cards: [] },
    {
      architecture: "c_context", flags_on: ["available_at", "append_only_versions"],
      cards: [
        card(2, 3700, { available_s: 4510, version_s: [3970, 4510], findings: [{ rule: "VR-010", raised_s: 4510 }, { rule: "VR-012", raised_s: 3970 }] }, true),
        card(0, 2700, { available_s: 2970, version_s: [2970] }, true),
        card(1, 2700, { available_s: null, version_s: [2900] }, true),
      ],
    },
  ],
});
const at = (t: number) => hallsAt(plan(), t);
const hall = (t: number, architecture: string) => at(t).find((h) => h.architecture === architecture);

describe("The cards present at an instant", () => {
  it("Given the first card shown at 2700 s Then no hall holds a card before it and the cards come in from their shown_s on, second by second", () => {
    expect(at(2699).map((h) => h.cards.length)).toEqual([0, 0, 0]);
    expect(at(2700).map((h) => h.cards.length)).toEqual([1, 0, 2]);
    expect(at(2899).map((h) => h.cards.length)).toEqual([1, 0, 2]);
    expect(at(2900).map((h) => h.cards.length)).toEqual([2, 0, 2]);
    expect(at(2970).map((h) => h.cards.length)).toEqual([3, 0, 2]);
    expect(at(3699).map((h) => h.cards.length)).toEqual([3, 0, 2]);
    expect(at(3700).map((h) => h.cards.length)).toEqual([3, 0, 3]);
  });

  it("Given the halls Then there is one row for each hall of the plan, in its order, with the architecture, the flags on and the number of cards the hall will hold", () => {
    expect(at(0).map((h) => [h.architecture, h.flags_on, h.total])).toEqual([["a_manual", [], 3], ["b_lims_lite", ["audit_trail"], 0], ["c_context", ["available_at", "append_only_versions"], 3]]);
  });

  it("Given a card Then it names its sample by the index into the plan's samples", () => {
    expect(hall(2970, "a_manual")?.cards.map((c) => c.sample)).toEqual([0, 1, 4]);
  });
});

describe("The place of a card on the shelves is fixed for the run", () => {
  it("Given the cards of A given as samples 4, 1, 0 shown at 2970, 2900, 2700 Then their places are 2, 1, 0 by shown_s", () => {
    expect(hall(2970, "a_manual")?.cards.map((c) => [c.sample, c.place])).toEqual([[0, 0], [1, 1], [4, 2]]);
  });

  it("Given two cards of C shown at the same second (samples 0 and 1) Then the lower sample index takes the lower place, and the later card (sample 2) the next", () => {
    expect(hall(3700, "c_context")?.cards.map((c) => [c.sample, c.place])).toEqual([[0, 0], [1, 1], [2, 2]]);
  });

  it("Given a card Then its place is the same at every instant from its arrival on, and does not change when another card arrives before or after it", () => {
    const placeOf = (t: number, architecture: string, sample: number) => hall(t, architecture)?.cards.find((c) => c.sample === sample)?.place;
    for (const t of [2900, 2970, 3000, 3700, 100000]) expect(placeOf(t, "a_manual", 1)).toBe(1);
    // the card of sample 4 arrives last in A and takes the last place; the card of sample 0 arrived first and keeps place 0 whether or not the others are there
    expect(placeOf(2700, "a_manual", 0)).toBe(0);
    expect(placeOf(2970, "a_manual", 4)).toBe(2);
    // in C the late card (sample 2, shown at 3700 s) leaves the places 0 and 1 of the two early cards as they were
    expect([2700, 3000, 3700].map((t) => placeOf(t, "c_context", 0))).toEqual([0, 0, 0]);
  });
});

describe("The slots of a card", () => {
  it("Given the plan's slots Then the card carries them as they are: stored or not stored, with the join basis; a slot is not a verdict", () => {
    const a = hall(2700, "a_manual")?.cards[0];
    expect(a?.slots).toEqual([
      { name: "unit", stored: true }, { name: "sampled_at", stored: false }, { name: "context", stored: true, basis: "measured_at" }, { name: "value", stored: true },
    ]);
    expect(hall(2700, "c_context")?.cards[0]?.slots[1]).toEqual({ name: "sampled_at", stored: true });
  });
});

describe("A card turns knowable from its available_s, where the architecture stores it", () => {
  it("Given C with the first card available at 2970 s Then it is not knowable at 2969 s and is from 2970 s; the card with no availability never is", () => {
    const knowable = (t: number) => hall(t, "c_context")?.cards.map((c) => [c.sample, c.knowable]);
    expect(knowable(2969)).toEqual([[0, false], [1, false]]);
    expect(knowable(2970)).toEqual([[0, true], [1, false]]);
    expect(knowable(100000)).toEqual([[0, true], [1, false], [2, true]]);
    expect(hall(100000, "c_context")?.knowable).toBe(2);
  });

  it("Given A, which stores no availability Then no card is ever knowable", () => {
    expect(hall(1e9, "a_manual")?.cards.some((c) => c.knowable)).toBe(false);
    expect(hall(1e9, "a_manual")?.knowable).toBe(0);
  });

  it("Given the counts of a hall Then shown is the number of cards present and knowable the number that are knowable", () => {
    expect(at(2970).map((h) => [h.shown, h.knowable])).toEqual([[3, 0], [0, 0], [2, 1]]);
    expect(at(1e9).map((h) => [h.shown, h.knowable])).toEqual([[3, 0], [0, 0], [3, 2]]);
  });
});

describe("The version stack and the pennants of a card follow the instants the record wrote them", () => {
  const sample2 = (t: number) => hall(t, "c_context")?.cards.find((c) => c.sample === 2);

  it("Given sample 2 of C, first version at 3970 s and second at 4510 s Then the stack behind the card is 0 before the second version and 1 from it", () => {
    expect([3700, 3969, 3970, 4509].map((t) => sample2(t)?.stack)).toEqual([0, 0, 0, 0]);
    expect([4510, 100000].map((t) => sample2(t)?.stack)).toEqual([1, 1]);
  });

  it("Given the finding VR-012 raised at 3970 s and VR-010 at 4510 s Then a pennant for each from its instant, sorted by rule", () => {
    expect([3700, 3969].map((t) => sample2(t)?.pennants)).toEqual([[], []]);
    expect(sample2(3970)?.pennants).toEqual(["VR-012"]);
    expect(sample2(4509)?.pennants).toEqual(["VR-012"]);
    expect(sample2(4510)?.pennants).toEqual(["VR-010", "VR-012"]);
  });

  it("Given a card with one version Then it has no stack, and a card of A that overwrites in place has none either", () => {
    expect(hall(100000, "c_context")?.cards.filter((c) => c.sample !== 2).map((c) => c.stack)).toEqual([0, 0]);
    expect(hall(100000, "a_manual")?.cards.map((c) => c.stack)).toEqual([0, 0, 0]);
  });

  it("Given a card that has no version yet (a run row is there and no result) Then the stack is 0 and not negative", () => {
    const p = plan();
    p.records[0] = { architecture: "a_manual", flags_on: [], cards: [card(0, 2700, { version_s: [] })] };
    expect(hallsAt(p, 2800)[0]?.cards[0]?.stack).toBe(0);
  });
});

describe("hallsAt is a pure function of the plan and the instant", () => {
  it("Given a shuffled list of instants Then each answer is the one from an ordered list: seeking, pausing and playing backwards need no replay", () => {
    const instants = Array.from({ length: 60 }, (_, i) => i * 90);
    const order = [...instants.keys()].sort((a, b) => ((a * 37) % 61) - ((b * 37) % 61)); // a fixed integer shuffle
    const p = plan();
    const forward = instants.map((t) => JSON.stringify(hallsAt(p, t)));
    const shuffled = new Map(order.map((i) => [i, JSON.stringify(hallsAt(p, instants[i] as number))]));
    for (const i of order) expect(shuffled.get(i), `t=${instants[i]}`).toBe(forward[i]);
    expect([...instants].reverse().map((t) => JSON.stringify(hallsAt(plan(), t)))).toEqual([...forward].reverse());
  });

  it("Given the same plan asked for twice Then the plan is unchanged and the answers are equal copies, not shared state", () => {
    const p = plan();
    const before = JSON.stringify(p);
    const first = hallsAt(p, 4000);
    const second = hallsAt(p, 4000);
    expect(JSON.stringify(p)).toBe(before);
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
    first[0]?.cards.pop();
    expect(hallsAt(p, 4000)).toEqual(second);
  });

  it("Given a plan with no hall yet (the halls come after plant_ready) Then there are no rows", () => {
    expect(hallsAt({ ...plan(), records: [] }, 5000)).toEqual([]);
  });
});

describe("hallsEpoch: the shelves change only at the instants the record wrote something", () => {
  // The instants at which something on a shelf changes, from the plan above: a card is shown (2700, 2900, 2970 in A; 2700 and 3700 in C), a version is written (A: 2800, 3000, 3070; C: 2900, 2970, 3970,
  // 4510), a finding is raised (3970, 4510) or a card turns knowable (2970, 4510). Without repeats and in order they are 2700, 2800, 2900, 2970, 3000, 3070, 3700, 3970 and 4510: nine.
  it("Given the nine instants Then the epoch is how many of them are not later than the clock", () => {
    const epoch = (t: number) => hallsEpoch(plan(), t);
    expect([0, 2699, 2700, 2799, 2800, 2970, 3699, 3700, 3970, 4509, 4510, 1e9].map(epoch)).toEqual([0, 0, 1, 1, 2, 4, 6, 7, 8, 8, 9, 9]);
  });

  it("Given two instants with the same epoch Then the shelves at both are the same, so a frame between them need not draw them again", () => {
    const p = plan();
    for (let t = 0; t < 5000; t += 7) expect(JSON.stringify(hallsAt(p, t + 3)) === JSON.stringify(hallsAt(p, t)) || hallsEpoch(p, t + 3) !== hallsEpoch(p, t), `t=${t}`).toBe(true);
    expect(hallsEpoch({ ...p, records: [] }, 5000)).toBe(0);
  });
});
