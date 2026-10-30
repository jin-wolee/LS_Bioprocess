import { beforeAll, describe, expect, it } from "vitest";
import type { ScenarioRun } from "../../src/run.ts";
import { H, docOf, eventsOf, fx12a, h, processOf, runOfDoc, set } from "./support.ts";

// Spec 11.8.2 rule S2: "Every affected unit stops at its own signal_at + d1 (the existing scripted-moment mechanism of process.ts ends the unit there: no later routine draw, no later
// feed, no harvest of the batch)." Layout: U01 consumes the contaminated ML-2 at 36 h, so its onset is 36 h, signal_at 48 h and stop 50 h (180 000 s). Scripted feeds of U01 at 40 h (kept)
// and 55 h (after the stop); U01 and U03 each take the clean lot ML-3 at 52 h, and U01 is stopped by then.

const FEEDS = {
  scripted_events: [
    { type: "feed", unit_id: "U01", at: { value: 2400, unit: "min", ref: "A192" } }, // 40 h
    { type: "feed", unit_id: "U01", at: { value: 3300, unit: "min", ref: "A192" } }, // 55 h
  ],
};
const STOP = H(50);

const later = (): ReturnType<typeof fx12a> => {
  const b = fx12a();
  const consumption = (b.topology as { consumption: object[] }).consumption.map((c, i) => (i === 6 ? { unit_id: "U01", lot_id: "ML-2", at: h(36) } : c));
  return set(b, "topology.consumption", [...consumption, { unit_id: "U01", lot_id: "ML-3", at: h(52) }, { unit_id: "U03", lot_id: "ML-3", at: h(52) }]);
};

describe("The scripted stop ends the unit: no later draw, no later feed, no harvest, and nothing else moves", () => {
  let base: ScenarioRun;
  let run: ScenarioRun;
  beforeAll(() => {
    base = runOfDoc(docOf(undefined, {}, FEEDS));
    run = runOfDoc(docOf(later(), {}, FEEDS));
  });

  it("Given an onset at 36 h, a lag of 12 h and d1 of 2 h When the script runs Then U01 is stopped at 50 h and its series and batch end there", () => {
    expect(processOf(run, "unit_stopped")).toEqual([["U01", STOP, "-"]]);
    expect(run.process.byUnit.get("U01")?.harvested_s).toBe(STOP);
    expect(run.sensors.find((s) => s.unit_id === "U01" && s.signal === "DO")?.n).toBe(STOP / 60 + 1);
  });

  it("Given the unscripted run draws a sample of U01 at or after 50 h When the stop is scripted Then no draw of U01 is at or after the stop and the draws before it are the unscripted run's, id for id", () => {
    const draws = (r: ScenarioRun): [string, number][] => eventsOf(r, "sample_drawn").filter((e) => e.unit_id === "U01").map((e) => [e.sample_id, e.t]);
    expect(draws(base).some(([, t]) => t >= STOP)).toBe(true); // the premise: the stop has something to remove
    expect(draws(run).length).toBeGreaterThan(0);
    expect(draws(run).every(([, t]) => t < STOP)).toBe(true);
    expect(draws(run)).toEqual(draws(base).filter(([, t]) => t < STOP));
  });

  it("Given a scripted feed at 40 h and one at 55 h When U01 stops at 50 h Then only the feed at 40 h happens, and the unit has no harvest event", () => {
    const feeds = (r: ScenarioRun) => processOf(r, "feed").filter(([u]) => u === "U01").map(([, t]) => t);
    expect(feeds(base).filter((t) => t < H(60))).toEqual([H(40), H(55)]);
    expect(feeds(base).some((t) => t > STOP + H(100))).toBe(true); // the unscripted run goes on feeding by the rule, a hundred hours on
    expect(feeds(run)).toEqual([H(40)]);
    expect(processOf(run, "harvest").some(([u]) => u === "U01")).toBe(false);
  });

  it("Given a medium lot taken by the stopped U01 at 52 h When the log is read Then it leaves no record, while U03 taking the same lot at 52 h does", () => {
    expect(processOf(run, "medium_addition").filter(([, , lot]) => lot === "ML-3")).toEqual([["U03", H(1), "ML-3"], ["U03", H(52), "ML-3"]]);
  });

  it("Given U02 and U03 are not affected When the draws and the process events of the two runs are compared Then they are identical", () => {
    const keep = (r: ScenarioRun, unit: string): string[] =>
      r.events.filter((e) => (e.type === "sample_drawn" || e.type === "sample_planned" || e.type === "process_event") && e.unit_id === unit && !(e.type === "process_event" && (e.kind === "medium_addition")))
        .map((e) => JSON.stringify(e));
    for (const unit of ["U02", "U03"]) {
      expect(keep(run, unit).length).toBeGreaterThan(5);
      expect(keep(run, unit)).toEqual(keep(base, unit));
    }
  });
});
