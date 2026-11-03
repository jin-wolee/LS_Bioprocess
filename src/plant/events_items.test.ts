import { describe, expect, it } from "vitest";
import { eventTimes, logBetween, nextEvent, objectTimes } from "./events.ts";
import { casePlan } from "./fixture_case.ts";

// P7c (docs/design/plant_ui.md sections 4.3 and 9, "As built in P7c"): the additions of a lot, the uses of an equipment item and the reported results of the confirming tests are events of the floor: the
// next-event step stops at them, the live region has a line for each, and the picked lot, item or confirming sample steps between its own instants. Expected values are typed by hand from the case of
// fixture_case.ts (ML-1 added to U01 and U02 at 3000 s, ML-2 to U02 at 6000 s, TL-1 used at 4000 and 8000 s, the results at 20000 and 30000 s).

const plan = casePlan();
const lines = (from: number, to: number, key: string) => logBetween(plan, from, to).filter((i) => i.key === key);

describe("the log of a case", () => {
  it("Given the instant of the additions Then a line for each reactor that took ML-1, with the lot", () => {
    expect(lines(2999, 3000, "addition")).toEqual([{ t: 3000, key: "addition", unit: "U01", item: "ML-1" }, { t: 3000, key: "addition", unit: "U02", item: "ML-1" }]);
  });

  it("Given the instant of a use Then a line with the equipment item and the reactor", () => {
    expect(lines(3999, 4000, "use")).toEqual([{ t: 4000, key: "use", unit: "U01", item: "TL-1" }]);
    expect(lines(7999, 8000, "use")).toEqual([{ t: 8000, key: "use", unit: "U02", item: "TL-1" }]);
  });

  it("Given the instant of the first results Then a line for each reported test with the confirming sample, the test and the outcome as the lab reported it", () => {
    expect(lines(19999, 20000, "confirmed")).toEqual([
      { t: 20000, key: "confirmed", sample: "U01-CONF", test: "bioburden", outcome: "detected" },
      { t: 20000, key: "confirmed", sample: "U02-CONF", test: "bioburden", outcome: "not_detected" },
    ]);
    expect(lines(29999, 30000, "confirmed")).toEqual([{ t: 30000, key: "confirmed", sample: "U01-CONF", test: "sterility", outcome: "detected" }]);
  });

  it("Given the signal and the deviation of a case Then their lines name the signal and the deviation id", () => {
    expect(lines(6999, 7000, "signal")).toEqual([{ t: 7000, key: "signal", unit: "U02", item: "DO" }]);
    expect(lines(7499, 7500, "deviation")).toEqual([{ t: 7500, key: "deviation", unit: "U02", item: "DEV-1" }]);
  });
});

describe("the step to the next event", () => {
  it("Given the floor with nothing picked Then the step stops at an addition, a use and a reported result", () => {
    const times = eventTimes(plan);
    for (const t of [3000, 4000, 6000, 8000, 20000, 30000]) expect(times, `${t} s`).toContain(t);
    expect(nextEvent(times, 2999)).toBe(3000);
    expect(nextEvent(times, 19999)).toBe(20000);
    expect(nextEvent(times, 20000)).toBe(30000);
  });

  it("Given a lot picked Then it steps between the instants of its own uses: ML-1 at 3000 s, SL-A at 1000 and 2000 s", () => {
    expect(objectTimes(plan, { kind: "lot", index: 0 })).toEqual([3000]);
    expect(objectTimes(plan, { kind: "lot", index: 1 })).toEqual([6000]);
    expect(objectTimes(plan, { kind: "lot", index: 2 })).toEqual([1000, 2000]);
  });

  it("Given an equipment item picked Then it steps between its uses, 4000 and 8000 s", () => {
    expect(objectTimes(plan, { kind: "equipment", index: 0 })).toEqual([4000, 8000]);
  });

  it("Given a confirming sample picked Then it steps between its draw and its results: U01-CONF at 9000, 20000 and 30000 s, U02-CONF at 9000 and 20000 s", () => {
    expect(objectTimes(plan, { kind: "confirm", index: 8 })).toEqual([9000, 20000, 30000]);
    expect(objectTimes(plan, { kind: "confirm", index: 9 })).toEqual([9000, 20000]);
  });

  it("Given a reactor picked Then its additions and uses are among its own instants", () => {
    expect(objectTimes(plan, { kind: "reactor", index: 0 })).toEqual(expect.arrayContaining([1000, 3000, 4000, 9000]));
    expect(objectTimes(plan, { kind: "reactor", index: 1 })).toEqual(expect.arrayContaining([3000, 6000, 8000]));
  });
});
