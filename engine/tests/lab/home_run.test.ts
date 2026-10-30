import { describe, expect, it } from "vitest";
import { homeRun } from "../../src/experiments/assembly/lab/home.ts";
import { checkRunSpec } from "../../src/experiments/assembly/lab/spec.ts";
import { scenarioInfos } from "../../src/experiments/assembly/lab/ready.ts";
import { readJson } from "../support/paths.ts";
import { labData } from "../support/lab_data.ts";

// The `run` request in its Home form (docs/design/lab_ui.md sections 3 and 4): one seed, no architectures, the summary of one run of the scenario.
// Expected values come from the golden summaries, which the S1b batch wrote once from a recorded command; the lab function is not their source.

const data = labData();
const home = (over: Record<string, unknown> = {}) => {
  const checked = checkRunSpec({ schema_version: "1", scenario: "default", settings: {}, architectures: [], seeds: [1], ...over }, data);
  if (!checked.ok) throw new Error(`the spec of the test is invalid: ${checked.message}`);
  return checked.spec;
};

interface Golden {
  event_count: number;
  event_counts: Record<string, number>;
}

describe("homeRun: the summary of one run", () => {
  it.each([1, 2, 3])("Given the default scenario and seed %i When the Home run is made Then the summary equals tests/golden/default_seed%i.summary.json", (seed) => {
    const golden = readJson<Golden>("tests", "golden", `default_seed${seed}.summary.json`);
    const out = homeRun(data, home({ seeds: [seed] }));
    expect(out).toMatchObject({ ok: true, summary: { events: golden.event_count, event_counts: golden.event_counts } });
  });

  it("Given a setting override When the run is made Then the setting changes the run and the spec is returned as checked", () => {
    const plain = homeRun(data, home());
    const small = homeRun(data, home({ settings: { reactor_count: 6, bay_size: 6, cohort_size: 6 } }));
    if (!plain.ok || !small.ok) throw new Error("both runs must be accepted");
    expect(small.summary.events).toBeLessThan(plain.summary.events);
    // 24 reactors in cohorts of 6 and 6 reactors in one cohort of 6: the inoculation events are 24 and 6 (one per reactor)
    expect(plain.summary.event_counts.inoculation).toBe(24);
    expect(small.summary.event_counts.inoculation).toBe(6);
  });

  it("Given the same spec twice When the run is made Then the summary is identical (seeded, no wall clock)", () => {
    expect(homeRun(data, home({ seeds: [2] }))).toEqual(homeRun(data, home({ seeds: [2] })));
  });
});

describe("homeRun: what the Home form refuses", () => {
  it("Given two seeds and no architecture Then the form is refused: a run that records nothing counts the events of one run", () => {
    expect(homeRun(data, home({ seeds: [1, 2] }))).toMatchObject({ ok: false, message: expect.stringMatching(/exactly one seed/) });
  });

  it("Given a value the scenario itself rejects When the run is made Then the engine's exception reaches the caller with its English message (rule 4 of section 4)", () => {
    expect(() => homeRun(data, home({ settings: { cohort_size: 0 } }))).toThrow(/the cohort size must be positive/);
  });
});

describe("scenarioInfos: the inputs the page shows with their ids", () => {
  const info = scenarioInfos(data);

  it("Given the bundled data Then the scenario default is listed with its description and profiles from the file", () => {
    const file = readJson<{ description: string; profiles: Record<string, string> }>("scenarios", "default.json");
    expect(info.map((s) => s.id)).toEqual(["default", "sc02_shift_burst", "sc03_feed_in_gap", "sc05_one_analyzer_down"]);
    expect(info[0]?.description).toBe(file.description);
    expect(info[0]?.profiles).toEqual(file.profiles);
  });

  it("Given the file Then every setting is listed in file order as name, value, unit and ledger id, and the first is reactor_count (A001)", () => {
    const file = readJson<{ settings: Record<string, { value: number; unit: string; ref: string }> }>("scenarios", "default.json");
    const settings = info[0]?.settings ?? [];
    expect(settings.length).toBe(Object.keys(file.settings).length);
    expect(settings[0]).toEqual({ name: "reactor_count", value: 24, unit: "reactors", ref: "A001" });
    expect(settings.every((s) => /^[AS]\d{3}$/.test(s.ref))).toBe(true);
  });
});
