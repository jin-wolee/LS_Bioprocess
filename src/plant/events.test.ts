import { describe, expect, it } from "vitest";
import { eventTimes, logBetween, nextEvent, previousEvent } from "./events.ts";
import { handPlan } from "./fixture.ts";

// P4 (docs/design/plant_ui.md sections 4.2, 4.3 and 9): the instants of the plan that the floor draws (the steps of "next event"), and the lines of the event log of the text alternative. Both are
// read from the hand plan of fixture.ts; the expected lists are typed by hand from it.

const plan = handPlan();

describe("The event instants", () => {
  it("Given the hand plan Then the first instants are the QC window at 0, both inoculations, the window end, the three draws, the three arrivals and the first visit's end", () => {
    // 0 QC window of AN-1; 1000 U01 inoculated; 1500 QC window over; 2000 U02 inoculated, AN-2's maintenance and the first draw; 2100 and 2200 the next draws; 2700, 2800, 2900 the arrivals
    // (the first also the start of a visit); 2970 the first visit ends and the next begins; 3000 a feed and a draw
    expect(eventTimes(plan).slice(0, 11)).toEqual([0, 1000, 1500, 2000, 2100, 2200, 2700, 2800, 2900, 2970, 3000]);
  });

  it("Given the last window closes at 30000 s Then nothing comes after it, and nothing is listed twice or out of order", () => {
    const times = eventTimes(plan);
    expect(times.at(-1)).toBe(30000);
    expect(times).toEqual([...new Set(times)].sort((a, b) => a - b));
    expect(times.every((t) => t >= 0 && t <= plan.horizon_s)).toBe(true);
  });

  it("Given a run that starts and ends a setup and a calibration Then those instants are steps too", () => {
    const times = eventTimes(plan);
    for (const t of [5000, 11700, 11820, 12090, 12000, 9000]) expect(times, `t = ${t}`).toContain(t);
  });

  it("Given the clock at an event Then next is the one after it and previous the one before it", () => {
    const times = eventTimes(plan);
    expect(nextEvent(times, 2000)).toBe(2100);
    expect(previousEvent(times, 2000)).toBe(1500);
    expect(nextEvent(times, 2970)).toBe(3000);
  });

  it("Given a clock between two events Then next and previous are the two around it", () => {
    const times = eventTimes(plan);
    expect(nextEvent(times, 2050)).toBe(2100);
    expect(previousEvent(times, 2050)).toBe(2000);
  });

  it("Given the clock before the first and after the last event Then there is no previous and no next", () => {
    const times = eventTimes(plan);
    expect(previousEvent(times, 0)).toBeNull();
    expect(nextEvent(times, 30000)).toBeNull();
    expect(nextEvent(times, 40000)).toBeNull();
    expect(nextEvent(times, -1)).toBe(0);
  });
});

describe("The event log", () => {
  const keys = (from: number, to: number): string[] => logBetween(plan, from, to).map((i) => i.key).sort();
  const item = (from: number, to: number, key: string) => logBetween(plan, from, to).find((i) => i.key === key);

  it("Given the interval (1999, 2000] Then it holds U02's inoculation, AN-2's maintenance begin and the first draw", () => {
    expect(keys(1999, 2000)).toEqual(["drawn", "inoculation", "window.maintenance.start"]);
    expect(item(1999, 2000, "drawn")).toMatchObject({ t: 2000, sample: "U01-D00-1", operator: "OP-01", unit: "U01" });
    expect(item(1999, 2000, "inoculation")).toMatchObject({ unit: "U02" });
    expect(item(1999, 2000, "window.maintenance.start")).toMatchObject({ analyzer: "AN-2" });
  });

  it("Given an interval is open at its start and closed at its end Then an event at the start is not in it and an event at the end is", () => {
    expect(keys(2000, 2100)).toEqual(["drawn"]);
    expect(item(2000, 2100, "drawn")).toMatchObject({ sample: "U02-D00-1" });
    expect(keys(2001, 2099)).toEqual([]);
  });

  it("Given the arrival at 2700 s and the visit that starts then Then both are logged", () => {
    expect(keys(2699, 2700)).toEqual(["arrived", "started"]);
    expect(item(2699, 2700, "started")).toMatchObject({ sample: "U01-D00-1", analyzer: "AN-1" });
  });

  it("Given a visit ends at 2970 s with QC passed and the next begins Then the log says finished with the outcome, and started", () => {
    expect(keys(2969, 2970)).toEqual(["finished", "started"]);
    expect(item(2969, 2970, "finished")).toMatchObject({ sample: "U01-D00-1", analyzer: "AN-1", outcome: "qc_passed" });
  });

  it("Given the failed run ends at 3970 s Then the outcome is qc_failed", () => {
    expect(item(3969, 3970, "finished")).toMatchObject({ sample: "U01-D00-3", outcome: "qc_failed" });
  });

  it("Given a rule feed and a draw at 3000 s, a shift at 3600 s, an alarm at 4000 s and a harvest at 9000 s Then each is a line with its reactor", () => {
    expect(keys(2999, 3000)).toEqual(["drawn", "feed"]);
    expect(item(2999, 3000, "feed")).toMatchObject({ unit: "U01" });
    expect(item(3599, 3600, "shift")).toMatchObject({ unit: "U01" });
    expect(item(3999, 4000, "alarm")).toMatchObject({ unit: "U01" });
    expect(item(8999, 9000, "harvest")).toMatchObject({ unit: "U01" });
    expect(item(11999, 12000, "stopped")).toMatchObject({ unit: "U02" });
    expect(item(6999, 7000, "signal")).toMatchObject({ unit: "U02" });
    expect(item(7499, 7500, "deviation")).toMatchObject({ unit: "U02" });
  });

  it("Given the skipped draw at 5000 s Then the line names the sample and the reactor and no operator, and the calibration is at 5000 s too", () => {
    expect(keys(4999, 5000)).toEqual(["calibration", "skipped"]);
    const skipped = item(4999, 5000, "skipped");
    expect(skipped).toMatchObject({ sample: "U02-D00-2", unit: "U02" });
    expect(skipped?.operator).toBeUndefined();
    expect(item(4999, 5000, "calibration")).toMatchObject({ analyzer: "AN-1" });
  });

  it("Given the closed window of AN-1 from 20000 s to 30000 s Then it is logged at both ends", () => {
    expect(item(19999, 20000, "window.closed.start")).toMatchObject({ analyzer: "AN-1" });
    expect(item(29999, 30000, "window.closed.end")).toMatchObject({ analyzer: "AN-1" });
  });

  it("Given a window of the plan that ends after the horizon Then no end is logged for it", () => {
    const long = handPlan();
    long.windows.push({ analyzer: 1, kind: "closed", from_s: 39000, to_s: 50000 });
    const items = logBetween(long, 38999, 60000);
    expect(items.map((i) => i.key)).toEqual(["window.closed.start"]);
  });
});
