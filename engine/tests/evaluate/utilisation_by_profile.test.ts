import { describe, expect, it } from "vitest";
import { runSeed } from "../../src/experiments/assembly/run_seed.ts";
import { truthFromRun } from "../../src/evaluate/truth.ts";
import { utilisation } from "../../src/evaluate/utilisation.ts";
import type { Event } from "../../src/generated/event.schema";
import { runScenario } from "../../src/run.ts";
import { configOf, SMALL } from "../support/scenarios.ts";
import { WORLD, seedInput } from "../support/eval_fixture.ts";
import { makeAjv } from "../support/schemas.ts";
import { readJson } from "../support/paths.ts";
import type { Json } from "../support/schemas.ts";

// Utilisation per analyzer profile (ADR-0015, spec section 4.5.6): the busy time of the profile's instruments over their number times the days times the window, in both
// windows and with and without setup. The pooled figure stays. Expected numbers are hand arithmetic from the events below.

const visit = (request_id: string, n: number, analyzer: string, loaded: number, setup: number, ended: number): Event[] => {
  const ids = { request_id, attempt: 1, visit: n, analyzer };
  return [{ type: "visit_started", t: loaded, ...ids, setup_s: setup }, { type: "run_started", t: loaded + setup, ...ids }, { type: "visit_finished", t: ended, ...ids }];
};
// AN-1 and AN-3 are all-in-one analyzers (AN-3 never used), AN-2 is an HPLC.
//   AN-1: R1 1000 to 1270 and R2 2000 to 2270, no setup: 270 + 270 = 540 busy, 540 productive.
//   AN-2: R1 visit 2, loaded at 1270, a fixture-only setup of 100 s, run 1370 to 1430: 160 busy, 60 productive.
const EVENTS: Event[] = [...visit("R1", 1, "AN-1", 1000, 0, 1270), ...visit("R2", 1, "AN-1", 2000, 0, 2270), ...visit("R1", 2, "AN-2", 1270, 100, 1430)];
const PROFILES = { "AN-1": "allinone_atline", "AN-2": "hplc", "AN-3": "allinone_atline" };
const SPAN = { analyzers: 3, days: 1, staffed_window_s: 36000, profiles: PROFILES };

describe("utilisation by profile: hand events, two profiles, three instruments, one day", () => {
  const u = utilisation(EVENTS, SPAN);
  const [aio, hplc] = u.by_profile ?? [];

  it("Given the map of instruments to profiles Then there is one entry per profile, in the order they first appear, with their instrument counts (2 and 1)", () => {
    expect(u.by_profile?.map((p) => [p.profile, p.instruments])).toEqual([["allinone_atline", 2], ["hplc", 1]]);
  });

  it("Given the all-in-one (540 s busy on two instruments) Then 540 over 2 x 36000 per staffed window and over 2 x 86400 per 24 h, setup or not", () => {
    for (const k of ["with_setup", "without_setup"] as const) {
      expect(aio?.per_staffed_window[k], k).toMatchObject({ num: 540, den: 72000, value: 540 / 72000 });
      expect(aio?.per_24h[k], k).toMatchObject({ num: 540, den: 172800, value: 540 / 172800 });
    }
  });

  it("Given the HPLC (160 s busy with its setup, 60 s productive, one instrument) Then 160 and 60 over 36000, and over 86400", () => {
    expect(hplc?.per_staffed_window.with_setup).toMatchObject({ num: 160, den: 36000 });
    expect(hplc?.per_staffed_window.without_setup).toMatchObject({ num: 60, den: 36000 });
    expect(hplc?.per_24h.with_setup).toMatchObject({ num: 160, den: 86400 });
    expect(hplc?.per_24h.without_setup).toMatchObject({ num: 60, den: 86400 });
  });

  it("Given the entries Then each denominator is worded and names its profile and its window", () => {
    expect(hplc?.per_staffed_window.with_setup.denominator).toMatch(/hplc.*staffed windows.*setup time counts/);
    expect(hplc?.per_24h.without_setup.denominator).toMatch(/hplc.*24 h.*setup time does not count/);
  });

  it("Given the pooled figure Then it is unchanged: 700 s busy over 3 x 36000", () => {
    expect(u.per_staffed_window.with_setup).toMatchObject({ num: 700, den: 108000 });
    expect(u.analyzers).toBe(3);
  });

  it("Given no map of instruments to profiles Then there is no by_profile (the hand worlds of the other tests)", () => {
    expect("by_profile" in utilisation(EVENTS, { analyzers: 3, days: 1, staffed_window_s: 36000 })).toBe(false);
  });
});

describe("utilisation by profile: a run", () => {
  const one = runScenario(configOf("default", { settings: SMALL }));
  const mixed = runScenario(configOf("default", { settings: { ...SMALL, rerun_probability: 0 }, fields: { analyzer_profiles: ["allinone_atline", "hplc"] } as never }));
  const days = 8;
  const span = (r: typeof one) => ({ analyzers: r.l3Input.analyzers.length, days, staffed_window_s: 36000, profiles: r.instrumentProfiles });

  it("Given a fleet of one profile Then its single entry has the counts of the pooled figure, in all four cells", () => {
    const u = utilisation(one.events, span(one));
    expect(u.by_profile).toHaveLength(1);
    const p = (u.by_profile ?? [])[0];
    expect(p?.instruments).toBe(2);
    for (const w of ["per_staffed_window", "per_24h"] as const) {
      for (const k of ["with_setup", "without_setup"] as const) expect([p?.[w][k].num, p?.[w][k].den], `${w} ${k}`).toEqual([u[w][k].num, u[w][k].den]);
    }
  });

  it("Given the all-in-one beside an HPLC Then each profile's productive time is its service time (270 s, 60 s) times its finished visits, counted from the log", () => {
    const u = utilisation(mixed.events, span(mixed));
    const finished = (analyzer: string): number => mixed.events.filter((e) => e.type === "visit_finished" && e.analyzer === analyzer).length;
    expect(finished("AN-1")).toBeGreaterThan(0);
    expect(u.by_profile?.map((p) => [p.profile, p.instruments, p.per_staffed_window.without_setup.num])).toEqual([
      ["allinone_atline", 1, 270 * finished("AN-1")],
      ["hplc", 1, 60 * finished("AN-2")],
    ]);
  });

  it("Given a run Then the truth carries the profile of each instrument, by instrument id", () => {
    expect(truthFromRun(mixed).analyzer_profiles).toEqual({ "AN-1": "allinone_atline", "AN-2": "hplc" });
  });

  it("Given the hand world of the evaluator (four visits of 500 s on one analyzer) with its profile named Then every cell's metrics hold one entry of 2000 s over 36000 s and over 86400 s", () => {
    const out = runSeed(seedInput({ truth: { ...WORLD, analyzer_profiles: { "AN-1": "allinone_atline" } } }));
    for (const cell of out.cells) {
      const entry = (cell.metrics.utilisation.by_profile ?? [])[0];
      expect([entry?.profile, entry?.instruments], cell.architecture).toEqual(["allinone_atline", 1]);
      expect(entry?.per_staffed_window.with_setup).toMatchObject({ num: 2000, den: 36000 });
      expect(entry?.per_24h.without_setup).toMatchObject({ num: 2000, den: 86400 });
    }
  });
});

describe("the metrics schema", () => {
  const ajv = makeAjv();
  ajv.addSchema(readJson<Json>("schemas", "metrics.schema.json"));
  it("Given a utilisation block with by_profile Then the metrics schema accepts it, and rejects an entry without its profile", () => {
    const u = utilisation(EVENTS, SPAN);
    const validate = ajv.getSchema("metrics.schema.json#/properties/metrics/properties/utilisation");
    expect(validate).toBeDefined();
    expect(validate?.(JSON.parse(JSON.stringify(u)))).toBe(true);
    const broken = JSON.parse(JSON.stringify(u)) as { by_profile: Record<string, unknown>[] };
    delete broken.by_profile[0]?.profile;
    expect(validate?.(broken)).toBe(false);
  });
});
