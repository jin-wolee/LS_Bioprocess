import { describe, expect, it } from "vitest";
import { batchIdOf, inoculationInstant, unitIdOf } from "../../src/process.ts";
import { configOf, runOf, SMALL } from "../support/scenarios.ts";

// Break-out batch 2, structure-only step (spec 11.8.5 row 2): the inoculation instant of a unit moves out of `simulate` into a function the loader can call. The values below are
// hand arithmetic from the default scenario (cohorts of 6 reactors, one cohort a day, the first at 480 min, 15 min between reactors), not read from the engine, and the test is
// green before and after the move: it pins that the move changes no instant.

describe("The inoculation instant of a unit, as a function of the process configuration", () => {
  const c = configOf("default").process;

  it.each([
    [0, 28_800], // U01: 480 min
    [1, 29_700], // U02: 480 + 15 min
    [5, 33_300], // U06: 480 + 5 x 15 min
    [6, 115_200], // U07: first of the second cohort, 1 d + 480 min
    [23, 292_500], // U24: third day... cohort 4 starts at 3 d: 259 200 + 480 min + 5 x 15 min
  ])("Given the default scenario When the instant of reactor index %i is asked Then it is %i s", (i, expected) => {
    expect(inoculationInstant(c, i)).toBe(expected);
  });

  it("Given the small scenario When the instants are compared with the reactors of the run Then every reactor was inoculated at that instant, under that unit and batch id", () => {
    const run = runOf("default", { settings: SMALL });
    const cfg = configOf("default", { settings: SMALL }).process;
    expect(run.process.reactors.length).toBe(6);
    run.process.reactors.forEach((r, i) => {
      expect(r.inoculated_s).toBe(inoculationInstant(cfg, i));
      expect(r.unit_id).toBe(unitIdOf(i));
      expect(r.batch_id).toBe(batchIdOf(r.unit_id));
    });
  });

  it("Given an index When the unit and batch ids are built Then they are U and B-U with two digits (three from the hundredth reactor)", () => {
    expect([unitIdOf(0), unitIdOf(8), unitIdOf(23), unitIdOf(99)]).toEqual(["U01", "U09", "U24", "U100"]);
    expect(batchIdOf("U07")).toBe("B-U07");
  });
});
