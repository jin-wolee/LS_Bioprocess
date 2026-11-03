import { describe, expect, it } from "vitest";
import { casePlan } from "./fixture_case.ts";
import { itemsAt, itemsCounts, tapeOf } from "./items_at.ts";
import { C_HOLDS } from "./fixture_case.ts";
import { LOOK } from "./scene_look.ts";

// P7c (docs/design/plant_ui.md section 3.2, "As built in P7c"): `itemsAt(plan, t, lens)` is a pure function of the plan, the instant and the hall the lens reads. The expected values are hand arithmetic on the
// case of fixture_case.ts, read with LOOK.link_s = 1200 s (a view constant): ML-1 is added to U01 and U02 at 3000 s, SL-A is taken at 1000 s and 2000 s, TL-1 is used at 4000 s and 8000 s; U01-CONF and
// U02-CONF are drawn at 9000 s, U01-SIG-CONF at 12000 s, U02-SIG-CONF was skipped; the results fall at 20000 s (two) and 30000 s (one); the holds of c_context are at 7500, 10000 and 25000 s.

const plan = casePlan();
const C = "c_context";
const links = (t: number, lens = C) => itemsAt(plan, t, lens).links.map((l) => [l.kind, l.item, l.unit, Number(l.progress.toFixed(4))]);

describe("LOOK.link_s", () => {
  it("Given the stretch of a link Then it is 1200 simulated seconds, as for a feed", () => expect(LOOK.link_s).toBe(1200));
});

describe("the links of a lot or an item to a vessel at an addition or a use", () => {
  it("Given an instant before every use Then there is no link", () => {
    expect(links(0)).toEqual([]);
    expect(links(999)).toEqual([]);
  });

  it("Given the instant of the first inoculation Then SL-A is linked to U01 at progress 0, and one second later at 1/1200", () => {
    expect(links(1000)).toEqual([["lot", 2, 0, 0]]);
    expect(links(1001)).toEqual([["lot", 2, 0, 0.0008]]);
  });

  it("Given 2999 s Then SL-A is linked to U02 (999 s of 1200 gone) and to nothing else: its use on U01 ended at 2200 s", () => {
    expect(links(2999)).toEqual([["lot", 2, 1, 0.8325]]);
  });

  it("Given 3000 s Then ML-1 is linked to U01 and to U02 at progress 0 (one lot, two vessels, two links), and SL-A to U02 at 1000/1200", () => {
    expect(links(3000)).toEqual([["lot", 0, 0, 0], ["lot", 0, 1, 0], ["lot", 2, 1, 0.8333]]);
  });

  it("Given 3200 s Then the link of SL-A is gone (a use at 2000 s is 1200 s old: the stretch is half open)", () => {
    expect(links(3199).map((l) => l[1])).toEqual([0, 0, 2]);
    expect(links(3200).map((l) => l[1])).toEqual([0, 0]);
  });

  it("Given 4000 s Then the equipment item is linked to U01 at progress 0, and ML-1 is still linked at 1000/1200; given 4200 s Then ML-1 is gone and TL-1 is at 200/1200", () => {
    expect(links(4000)).toEqual([["lot", 0, 0, 0.8333], ["lot", 0, 1, 0.8333], ["equipment", 0, 0, 0]]);
    expect(links(4200)).toEqual([["equipment", 0, 0, 0.1667]]);
  });

  it("Given the end of the run Then there is no link", () => expect(links(40000)).toEqual([]));

  it("Given a plan with no lots and no equipment (a run that is not a case) Then there are no links, no tape and no shelf", () => {
    const bare = JSON.parse(JSON.stringify({ ...plan, samples: plan.samples.filter((s) => s.kind === "routine"), lots: undefined, equipment: undefined, confirms: undefined })) as typeof plan;
    expect(itemsAt(bare, 3000, C)).toEqual({ links: [], tape: { lots: [], equipment: [], units: [null, null] }, shelf: [] });
  });
});

describe("the tape: the holds of the hall the lens reads", () => {
  const tape = (t: number, lens = C) => {
    const s = itemsAt(plan, t, lens).tape;
    return { lots: s.lots, equipment: s.equipment, units: s.units };
  };

  it("Given 7499 s Then nothing is held; given 7500 s Then U02, ML-1 and TL-1 are held (one band)", () => {
    expect(tape(7499)).toEqual({ lots: [null, null, null], equipment: [null], units: [null, null] });
    expect(tape(7500)).toEqual({ lots: ["held", null, null], equipment: ["held"], units: [null, "held"] });
  });

  it("Given 10000 s Then U02 and ML-1 are quarantined (two bands) and TL-1 is still held", () => {
    expect(tape(10000)).toEqual({ lots: ["quarantined", null, null], equipment: ["held"], units: [null, "quarantined"] });
  });

  it("Given 25000 s Then ML-1 and TL-1 are released and U02 stays quarantined; the re-flag at 26000 s and the closing at 27000 s change no tape", () => {
    expect(tape(25000)).toEqual({ lots: [null, null, null], equipment: [null], units: [null, "quarantined"] });
    expect(tape(27000)).toEqual(tape(25000));
    expect(tape(40000)).toEqual(tape(25000));
  });

  it("Given the other hall as the lens Then its own holds are drawn: a_manual holds U02 from 9000 s and no lot, whatever c_context did (a hold is one record's decision)", () => {
    expect(tape(9000, "a_manual")).toEqual({ lots: [null, null, null], equipment: [null], units: [null, "held"] });
    expect(tape(10000, "a_manual").units).toEqual([null, "held"]);
    expect(tape(7500, "a_manual").units).toEqual([null, null]);
  });

  it("Given a lens that is not a hall of the plan Then no tape", () => {
    expect(tape(10000, "b_lims_lite")).toEqual({ lots: [null, null, null], equipment: [null], units: [null, null] });
  });

  it("Given tapeOf on the holds Then a hold on a sample is no tape, and a release of an item never held leaves it bare", () => {
    expect(tapeOf(C_HOLDS, "sample", 0, 40000)).toBeNull();
    expect(tapeOf(C_HOLDS, "lot", 1, 40000)).toBeNull();
    expect(tapeOf(C_HOLDS, "lot", 0, 7500)).toBe("held");
    expect(tapeOf(C_HOLDS, "lot", 0, 10000)).toBe("quarantined");
    expect(tapeOf([{ t: 5, event: "hold_released", on: "lot", target: 0 }], "lot", 0, 10)).toBeNull();
  });
});

describe("the confirmation shelf: a tube from its draw, a stamp for each test from its result", () => {
  const shelf = (t: number) => itemsAt(plan, t, C).shelf.map((x) => [plan.samples[x.sample]?.id, x.slot, x.stamps.map((s) => [s.test, s.outcome, s.k])]);

  it("Given 8999 s Then the shelf is empty; given 9000 s Then U01-CONF is in slot 0 and U02-CONF in slot 1, with no stamp", () => {
    expect(shelf(8999)).toEqual([]);
    expect(shelf(9000)).toEqual([["U01-CONF", 0, []], ["U02-CONF", 1, []]]);
  });

  it("Given the draw skipped for the volume budget at 9500 s Then it has no tube and takes no slot: U01-SIG-CONF drawn at 12000 s is in slot 2", () => {
    expect(shelf(9500).map((x) => x[0])).toEqual(["U01-CONF", "U02-CONF"]);
    expect(shelf(12000)).toEqual([["U01-CONF", 0, []], ["U02-CONF", 1, []], ["U01-SIG-CONF", 2, []]]);
  });

  it("Given 19999 s Then no stamp; given 20000 s Then U01-CONF has a stamp that reads detected (bioburden) and U02-CONF one that reads not detected", () => {
    expect(shelf(19999).flatMap((x) => x[2] as unknown[])).toEqual([]);
    expect(shelf(20000)).toEqual([["U01-CONF", 0, [["bioburden", "detected", 0]]], ["U02-CONF", 1, [["bioburden", "not_detected", 0]]], ["U01-SIG-CONF", 2, []]]);
  });

  it("Given 30000 s Then U01-CONF has a second stamp (sterility, detected) above the first: the first does not move", () => {
    expect(shelf(30000)[0]).toEqual(["U01-CONF", 0, [["bioburden", "detected", 0], ["sterility", "detected", 1]]]);
  });

  it("Given a plan with more confirming samples than the shelf has slots (two for each of two vessels) Then the ones past the last slot have no tube", () => {
    const extra = Array.from({ length: 3 }, (_, i) => ({ ...(plan.samples[8] as (typeof plan.samples)[number]), id: `X${i}`, drawn_s: 13000 + i }));
    const crowded = { ...plan, samples: [...plan.samples, ...extra] };
    // the slots are 4: U01-CONF, U02-CONF, U01-SIG-CONF and X0; X1 and X2 have none
    expect(itemsAt(crowded, 14000, C).shelf.map((x) => crowded.samples[x.sample]?.id)).toEqual(["U01-CONF", "U02-CONF", "U01-SIG-CONF", "X0"]);
  });
});

describe("the counts the host writes", () => {
  it("Given 4000, 10000 and 30000 s with the lens on c_context Then the counts are the links standing, the tubes on the shelf, the stamps and the tapes by state and kind", () => {
    expect(itemsCounts(itemsAt(plan, 4000, C))).toEqual({ links: 3, shelf: 0, stamps: 0, held: { lot: 0, equipment: 0, unit: 0 }, quarantined: { lot: 0, equipment: 0, unit: 0 } });
    expect(itemsCounts(itemsAt(plan, 10000, C))).toEqual({ links: 0, shelf: 2, stamps: 0, held: { lot: 0, equipment: 1, unit: 0 }, quarantined: { lot: 1, equipment: 0, unit: 1 } });
    expect(itemsCounts(itemsAt(plan, 30000, C))).toEqual({ links: 0, shelf: 3, stamps: 3, held: { lot: 0, equipment: 0, unit: 0 }, quarantined: { lot: 0, equipment: 0, unit: 1 } });
  });
});

describe("the seek property", () => {
  it("Given a shuffled list of instants Then each answer is the one an ordered list gives (no state between calls)", () => {
    const instants = [0, 999, 1000, 2999, 3000, 3199, 3200, 4000, 4200, 7499, 7500, 8999, 9000, 9500, 10000, 12000, 19999, 20000, 25000, 26000, 30000, 40000];
    const ordered = instants.map((t) => JSON.stringify(itemsAt(plan, t, C)));
    const shuffled = [...instants.keys()].sort((a, b) => ((a * 7919) % 23) - ((b * 7919) % 23));
    for (const k of shuffled) expect(JSON.stringify(itemsAt(plan, instants[k] as number, C))).toBe(ordered[k]);
  });
});
