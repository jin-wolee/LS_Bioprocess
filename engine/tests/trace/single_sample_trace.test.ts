import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { runSeed } from "../../src/experiments/assembly/run_seed.ts";
import type { SeedOutput } from "../../src/experiments/assembly/run_seed.ts";
import { canonicalJson } from "../../src/trace.ts";
import type { ScenarioRun } from "../../src/run.ts";
import { CONFIGS } from "../support/cells.ts";
import { ROOT } from "../support/paths.ts";
import { inputOf } from "../support/sc_run.ts";
import { runOf } from "../support/scenarios.ts";
import { SCENARIO, buildTrace, pickSample } from "../support/trace_sample.ts";
import type { SingleSampleTrace } from "../support/trace_sample.ts";
import { BEGIN, END, stamp, traceTable, withTable } from "../support/trace_table.ts";

// Single-sample failure trace (docs/prompts/20 Step 10). The pick rule is tested on a hand-built truth log; the fixture is a golden that this file reads and never writes
// (it is created once by engine/tests/support/trace_cli.ts, its checksum is in tests/fixtures/trace/CHECKSUMS.txt, not in tests/golden/CHECKSUMS.txt: orchestrator decision).

const read = (...parts: string[]): string => readFileSync(join(ROOT, ...parts), "utf8");
const events = (...e: Record<string, unknown>[]): ScenarioRun["events"] => e as unknown as ScenarioRun["events"];
const fake = (e: ScenarioRun["events"]): ScenarioRun => ({ events: e, samples: [], operators: [], l3Input: { requests: [], analyzers: [] } }) as unknown as ScenarioRun;

// Test-only values. Unit U1 (batch B1) has feeds at 1000 and 5000; unit U2 (batch B2) has none.
const drawn = (sample_id: string, t: number, unit = "U1", batch = "B1"): Record<string, unknown> => ({ type: "sample_drawn", t, sample_id, unit_id: unit, batch_id: batch, operator_id: "OP-1", volume_ul: 200, true_state: {} });
const sample = (sample_id: string, drew: number, started: number, unit = "U1", batch = "B1"): Record<string, unknown>[] => [
  drawn(sample_id, drew, unit, batch),
  { type: "sample_received", t: drew + 10, sample_id },
  { type: "run_started", t: started, request_id: sample_id, attempt: 1, visit: 1, analyzer: "AN-1" },
  { type: "result_measured", t: started + 50, request_id: sample_id, attempt: 1, visit: 1, analyzer: "AN-1", analyte: "glucose", value: 1, true_value: 1, noise: 0 },
];
const feed = (t: number, unit = "U1", batch = "B1"): Record<string, unknown> => ({ type: "process_event", t, unit_id: unit, batch_id: batch, kind: "feed", source: "scripted" });

describe("SC-trace pick rule", () => {
  it("Given samples around two feeds When the rule is applied Then it picks the lowest id whose [sampled_at, run.started_at] contains a feed of its own unit and batch, both ends counting", () => {
    const run = fake(events(
      feed(1000), feed(5000),
      ...sample("U1-D00-1", 1100, 1200), // after the first feed, before the second: no feed inside
      ...sample("U1-D00-3", 100, 200), // before every feed
      ...sample("U1-D00-4", 5000, 5100), // the feed at 5000 falls exactly on the draw: the left end counts, so it qualifies
      ...sample("U1-D00-2", 900, 1000), // the feed at 1000 falls exactly on the run start: the right end counts
      ...sample("U2-D00-1", 4900, 5100, "U2", "B2"), // a feed of unit U1 at 5000 lies inside, but it is not this unit's
    ));
    const p = pickSample(run);
    expect(p.sample_id).toBe("U1-D00-2");
    expect(p.feeds_in_interval).toEqual([1000]);
    expect([p.sampled_at, p.arrived_at, p.run_started_at, p.measured_at]).toEqual([900, 910, 1000, 1050]);
    expect(p.feeds_of_batch).toEqual([1000, 5000]);
  });

  it("Then the truth context is counted with the feed at the draw instant included and the feed at the run start excluded from the draw, as data_model section 7 defines the epoch", () => {
    const p = pickSample(fake(events(feed(1000), ...sample("U1-D00-2", 900, 1000))));
    expect(p.context_at_draw).toEqual({ feed_epoch: 0, batch_phase: "before_shift" }); // 1000 > 900
    expect(p.context_at_measurement).toEqual({ feed_epoch: 1, batch_phase: "before_shift" }); // 1000 <= 1050
  });

  it("When no sample has a feed inside its interval Then the pick fails loudly instead of choosing another", () => {
    expect(() => pickSample(fake(events(feed(10), ...sample("U1-D00-1", 100, 200))))).toThrow(/no sample of SC3/);
  });
});

describe("SC-trace fixture", () => {
  const text = read("tests", "fixtures", "trace", "single_sample_trace.json");
  const fixture = JSON.parse(text) as SingleSampleTrace;
  let run: ScenarioRun;
  let out: SeedOutput;

  beforeAll(() => {
    run = runOf(SCENARIO.id, { seed: SCENARIO.seed });
    const [a, b, c] = CONFIGS.slice(0, 3).map((x) => x.config);
    out = runSeed(inputOf(run, SCENARIO.id, [a, b, c] as NonNullable<typeof a>[], SCENARIO.days));
  }, 120_000);

  it("Given the fixture on disk When its sha256 is compared with tests/fixtures/trace/CHECKSUMS.txt Then they are equal (the test only reads)", () => {
    const line = read("tests", "fixtures", "trace", "CHECKSUMS.txt").trim();
    expect(line).toBe(`${createHash("sha256").update(text).digest("hex")}  single_sample_trace.json`);
  });

  it("Given the SC3 truth log When the rule of the brief is applied again Then it picks the sample the fixture holds, and the fixture states the rule", () => {
    const { rule, ...pick } = fixture.pick;
    expect(pickSample(run)).toEqual(pick);
    expect(rule).toMatch(/lowest sample_id/);
    expect(pick.feeds_in_interval.length).toBeGreaterThan(0);
  });

  it("Given the real recorders When A, B and C are run again on the same truth Then their rows for the sample equal the fixture (a golden: a recorder change shows here and needs the author's approval)", () => {
    expect(JSON.parse(canonicalJson(buildTrace(run, out.datasets, out.key_text)))).toEqual(JSON.parse(canonicalJson(fixture)));
  });

  it("Given a feed strictly after the draw Then the verdicts follow spec section 5, typed from the flag table: no two_clocks means no sampled_at and a measured_at join, so A and B are wrong on the context, and C, which joins by sampled_at, is right", () => {
    expect(fixture.pick.feeds_in_interval.some((t) => t > fixture.pick.sampled_at)).toBe(true); // the case of the page; a feed exactly at the draw would be counted by both epochs
    const { a_manual: a, b_lims_lite: b, c_context: c } = fixture.architectures;
    for (const x of [a, b]) {
      expect(x?.answers.sampled_at).toEqual({ answer: null, verdict: "unanswerable" });
      expect(x?.answers.process_context.verdict).toBe("wrong");
      expect(x?.tables.process_context?.join_basis).toBe("measured_at");
    }
    expect(c?.answers.sampled_at.verdict).toBe("correct");
    expect(c?.answers.process_context.verdict).toBe("correct");
    expect(c?.tables.process_context?.join_basis).toBe("sampled_at");
    expect(a?.answers.process_context.answer).toEqual(fixture.pick.context_at_measurement); // A and B read the epoch at the measurement, C the epoch at the draw
    expect(c?.answers.process_context.answer).toEqual(fixture.pick.context_at_draw);
  });

  it("Then the fixture covers A, B and C, each with the sample's rows and an answer to the three questions with a verdict of the closed list", () => {
    expect(Object.keys(fixture.architectures)).toEqual(["a_manual", "b_lims_lite", "c_context"]);
    for (const a of Object.values(fixture.architectures)) {
      expect(a.tables.sample.length).toBe(1);
      expect(Object.keys(a.answers)).toEqual(["process_context", "sampled_at", "unit"]);
      for (const q of Object.values(a.answers)) expect(["correct", "wrong", "unanswerable"]).toContain(q.verdict);
    }
  });
});

describe("SC-trace page", () => {
  const fixture = JSON.parse(read("tests", "fixtures", "trace", "single_sample_trace.json")) as SingleSampleTrace;
  const page = read("docs", "design", "single_sample_trace.md");

  it("Given the fixture When the table is generated again Then the page holds exactly that table between its markers (drift fails here)", () => {
    expect(page).toContain(traceTable(fixture));
    expect(withTable(page, fixture)).toBe(page);
  });

  it("When a cell of the generated block is edited by hand Then the regenerated page differs, so the drift test would fail", () => {
    const edited = page.replace(/\*\*(correct|wrong|unanswerable)\*\*/, "**edited**");
    expect(edited).not.toBe(page);
    expect(withTable(edited, fixture)).toBe(page);
    expect(edited).not.toContain(traceTable(fixture));
  });

  it("Then the page has the markers once, and a page without them is an error rather than a silent loss of the table", () => {
    expect(page.split(BEGIN).length - 1).toBe(1);
    expect(page.split(END).length - 1).toBe(1);
    expect(() => withTable("no markers", fixture)).toThrow(/no trace-table markers/);
  });

  it("Then the stamp format is seconds plus day and clock (day 0 is a Monday)", () => {
    expect(stamp(3 * 86400 + 9 * 3600 + 5 * 60 + 7)).toBe("291907 (day 3 09:05:07)");
    expect(stamp(null)).toBe("null");
  });
});
