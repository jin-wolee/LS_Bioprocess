import { describe, expect, it } from "vitest";
import { evaluationSettings } from "../../src/evaluate/config.ts";
import { staffedSeconds, utilisation } from "../../src/evaluate/utilisation.ts";
import { labSeed } from "../../src/experiments/assembly/lab/seed_setup.ts";
import type { RunSpec } from "../../src/experiments/assembly/lab/spec.ts";
import { runSeed } from "../../src/experiments/assembly/run_seed.ts";
import type { Event } from "../../src/generated/event.schema";
import { parseArchitecture } from "../../src/record/architecture.ts";
import { ROSTER } from "../support/eval_fixture.ts";
import { labData } from "../support/lab_data.ts";
import { SMALL } from "../support/scenarios.ts";

// Audit A1, finding F4 (2026-11-02), fixed in A2: the utilisation per staffed window divided by days x 10 h, while the roster gives a weekend day 6 h (A201). The author's decision of
// the same day: the denominator is, over the analyzers and the days of the horizon, the hours the roster staffs that day (a weekday's window and a weekend day's, A098 and A201),
// cut at the horizon; the net time after QC and maintenance is not taken off. Expected values below are typed by hand from the roster, never read from the code under test.
// Day 0 is a Monday (A188); the roster is 08:00 to 18:00 on a weekday (10 h), 08:00 to 14:00 on a weekend day (6 h).

const data = labData();
const H = 3600;
const DAY = 24 * H;
const cellsOf = (settings: RunSpec["settings"]) => {
  const spec: RunSpec = { schema_version: "1", scenario: "default", settings, architectures: ["a_manual"], seeds: [1] };
  return runSeed(labSeed(data, spec, 1, data.architectures.map(parseArchitecture).filter((a) => a.id === "a_manual")).input).cells;
};

describe("F4 (fixed by A2): the staffed-window denominator follows the roster", () => {
  it("Given the default scenario, seed 1 When utilisation is evaluated Then the staffed-window denominator is 2 x (15 x 10 + 6 x 6) x 3600 analyzer-seconds", () => {
    const spec: RunSpec = { schema_version: "1", scenario: "default", settings: {}, architectures: ["a_manual"], seeds: [1] };
    const out = runSeed(labSeed(data, spec, 1, data.architectures.map(parseArchitecture).filter((a) => a.id === "a_manual")).input);
    expect(out.cells[0]?.metrics.utilisation.per_staffed_window.with_setup.den).toBe(2 * (15 * 10 + 6 * 6) * 3600);
  });

  it("Given seed 1 of the default scenario Then the share is 107460 s of busy time over 1339200 s, as the roster gives (the number before the fix was 107460 / 1512000)", () => {
    const u = cellsOf({})[0]?.metrics.utilisation;
    expect(u?.per_staffed_window.with_setup).toMatchObject({ num: 107460, den: 1339200, value: 107460 / 1339200 });
    expect(u?.per_staffed_window.without_setup).toMatchObject({ num: 107460, den: 1339200 });
    expect(u?.per_24h.with_setup).toMatchObject({ num: 107460, den: 2 * 21 * DAY }); // the 24 h figure was right and is unchanged
    expect(u?.staffed_window_s).toBe(10 * H); // the echo names the weekday window
  });

  it("Given a run of 6 days from a Monday, which ends inside the weekend (Saturday is the last day) Then the denominator is 2 x (5 x 10 + 1 x 6) x 3600 = 403200", () => {
    const u = cellsOf({ ...SMALL, horizon_days: 6, production_days: 5 })[0]?.metrics.utilisation;
    expect(u?.days).toBe(6);
    expect(u?.per_staffed_window.with_setup.den).toBe(2 * (5 * 10 + 1 * 6) * H);
    expect(u?.per_24h.with_setup.den).toBe(2 * 6 * DAY);
  });

  it("Given a roster the scenario changes (a weekday closing at 17:00) Then the denominator follows the roster, not the evaluation's 10 h", () => {
    const u = cellsOf({ ...SMALL, horizon_days: 5, production_days: 4, staffed_end_weekday_min: 17 * 60 })[0]?.metrics.utilisation;
    expect(u?.per_staffed_window.with_setup.den).toBe(2 * 5 * 9 * H); // five weekdays of 9 h on two analyzers
    expect(u?.staffed_window_s).toBe(9 * H);
  });

  it("Given the bundled default scenario Then its roster is the 10 h weekday window of A098 and the 6 h weekend window of A201", () => {
    const spec: RunSpec = { schema_version: "1", scenario: "default", settings: {}, architectures: ["a_manual"], seeds: [1] };
    const roster = labSeed(data, spec, 1, data.architectures.map(parseArchitecture).filter((a) => a.id === "a_manual")).input.config.roster;
    expect([roster.start_s, roster.end_weekday_s, roster.end_weekend_s]).toEqual([8 * H, 18 * H, 14 * H]);
    expect(evaluationSettings(data.evaluation).staffed_window_s).toBe(roster.end_weekday_s - roster.start_s);
  });
});

describe("staffedSeconds: the seconds one analyzer is staffed in a horizon", () => {
  const cases: [string, number, number][] = [
    ["one Monday", 1, 10 * H],
    ["a week from a Monday: five weekdays and two weekend days", 7, (5 * 10 + 2 * 6) * H],
    ["the default horizon of 21 days: 15 weekdays and 6 weekend days", 21, (15 * 10 + 6 * 6) * H],
    ["8 days: the second Monday is a weekday again", 8, (6 * 10 + 2 * 6) * H],
    ["6 days, ending with Saturday", 6, (5 * 10 + 1 * 6) * H],
    ["5.5 days, a horizon at noon on Saturday cuts that day's window (08:00 to 12:00 is 4 h)", 5.5, (5 * 10 + 4) * H],
    ["half a day, noon on Monday: 08:00 to 12:00 is 4 h", 0.5, 4 * H],
    ["a quarter of a day, 06:00 on Monday: the window has not opened", 0.25, 0],
    ["no days", 0, 0],
  ];
  for (const [what, days, seconds] of cases) {
    it(`Given ${what} Then ${seconds} s`, () => expect(staffedSeconds(ROSTER, days)).toBe(seconds));
  }

  it("Given a roster whose weekend closes with the weekday Then every day has the weekday window", () => {
    expect(staffedSeconds({ ...ROSTER, end_weekend_s: ROSTER.end_weekday_s }, 7)).toBe(7 * 10 * H);
  });

  it("Given a horizon that is not a whole number of seconds when written in days Then the seconds are rounded to a whole second (a third of a day is 28800 s)", () => {
    expect(staffedSeconds({ start_s: 0, end_weekday_s: DAY, end_weekend_s: DAY }, 1 / 3)).toBe(28800);
  });
});

describe("utilisation over a horizon with a weekend: hand events, two analyzers, six days", () => {
  // 6 days from a Monday: staffed per analyzer 5 x 10 + 6 = 56 h = 201600 s, so 403200 s for two. One visit of 4032 s without setup is exactly 1 percent of that.
  const ids = { request_id: "R1", attempt: 1, visit: 1, analyzer: "AN-1" };
  const events: Event[] = [{ type: "visit_started", t: 1000, ...ids, setup_s: 0 }, { type: "run_started", t: 1000, ...ids }, { type: "visit_finished", t: 5032, ...ids }];

  it("Given one visit of 4032 s Then the share per staffed window is 4032 / 403200 = 0.01 and per 24 h is 4032 / (2 x 6 x 86400)", () => {
    const u = utilisation(events, { analyzers: 2, days: 6, roster: ROSTER });
    expect(u.per_staffed_window.with_setup).toMatchObject({ num: 4032, den: 403200, value: 0.01 });
    expect(u.per_24h.with_setup).toMatchObject({ num: 4032, den: 1036800 });
  });

  it("Given the profile of each analyzer Then a profile of one analyzer has the denominator 201600 (its share of the same staffed seconds)", () => {
    const u = utilisation(events, { analyzers: 2, days: 6, roster: ROSTER, profiles: { "AN-1": "allinone_atline", "AN-2": "hplc" } });
    expect(u.by_profile?.map((p) => [p.profile, p.per_staffed_window.with_setup.den, p.per_24h.with_setup.den])).toEqual([
      ["allinone_atline", 201600, 6 * DAY],
      ["hplc", 201600, 6 * DAY],
    ]);
  });
});
