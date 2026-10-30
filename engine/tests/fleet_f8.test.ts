import { describe, expect, it } from "vitest";
import type { Event } from "../src/generated/event.schema";
import { runScenario } from "../src/run.ts";
import { configOf } from "./support/scenarios.ts";
import { readJson } from "./support/paths.ts";

// F8, the hand fixture of routing rule B (spec section 4.5.4): tests/fixtures/mixed_fleet/F8_mixed_fleet.json. The expected instruments, visits and analytes were typed by hand
// from the bundled profile files and the spec, with their derivation in the file; nothing is copied from engine output.

interface F8 {
  inputs: { scenario: string; settings: Record<string, number>; analyzer_profiles: string[] };
  expected: {
    instruments: { id: string; group: string; initial_method: string | null }[];
    visits: { visit: number; group: string; analyzer: string; service_s: number; setup_s: number; transfer_s: number; analytes: string[] }[];
    results_per_sample_without_a_rerun: number;
    results_per_analyte_per_sample_without_a_rerun: number;
    visits_per_sample: number;
    min_samples_without_a_rerun: number;
  };
}

const fx = readJson<F8>("tests", "fixtures", "mixed_fleet", "F8_mixed_fleet.json");
const run = runScenario(configOf(fx.inputs.scenario, { settings: fx.inputs.settings, fields: { analyzer_profiles: fx.inputs.analyzer_profiles } as never }));
const ofType = <T extends Event["type"]>(type: T) => run.events.filter((e): e is Extract<Event, { type: T }> => e.type === type);
const rerun = new Set(ofType("rerun_requested").map((e) => e.request_id));
const clean = [...new Set(ofType("request_queued").map((e) => e.request_id))].filter((id) => !rerun.has(id));

describe("F8 Mixed fleet: an all-in-one beside an HPLC", () => {
  it("Given the fleet [all-in-one, HPLC] When the scenario loads Then the instruments are AN-1 (AIO) and AN-2 (HPLC, method installed)", () => {
    expect(run.l3Input.analyzers).toEqual(fx.expected.instruments);
  });

  it("Given the fleet When it runs Then enough samples have no rerun for the check to mean something", () => {
    expect(clean.length).toBeGreaterThanOrEqual(fx.expected.min_samples_without_a_rerun);
  });

  it("Given a sample without a rerun Then it makes the two visits of the fixture, on the instruments, with the service times and no setup", () => {
    for (const id of clean) {
      const runs = run.runs.filter((r) => r.request_id === id).sort((a, b) => a.visit - b.visit);
      expect(runs.length, id).toBe(fx.expected.visits_per_sample);
      for (const want of fx.expected.visits) {
        const got = runs[want.visit - 1];
        expect([got?.visit, got?.analyzer, (got?.end_s ?? 0) - (got?.start_s ?? 0), got?.setup_s], `${id} visit ${want.visit}`).toEqual([want.visit, want.analyzer, want.service_s, want.setup_s]);
      }
    }
  });

  it("Given a sample without a rerun Then the HPLC visit joins its queue when the all-in-one visit ends (no transfer), in the group of the fixture", () => {
    for (const id of clean) {
      const queued = ofType("request_queued").filter((e) => e.request_id === id).sort((a, b) => a.visit - b.visit);
      const finished = ofType("visit_finished").find((e) => e.request_id === id && e.visit === 1);
      expect(queued.map((e) => e.group), id).toEqual(fx.expected.visits.map((v) => v.group));
      expect((queued[1] as { t: number }).t - (finished as { t: number }).t, id).toBe(fx.expected.visits[1]?.transfer_s);
    }
  });

  it("Given a sample without a rerun Then each analyte is measured once, 7 results in all, the six of the all-in-one on visit 1 and the titer on visit 2", () => {
    for (const id of clean) {
      const results = ofType("result_measured").filter((e) => e.request_id === id);
      expect(results.length, id).toBe(fx.expected.results_per_sample_without_a_rerun);
      for (const v of fx.expected.visits) expect(results.filter((e) => e.visit === v.visit).map((e) => e.analyte).sort(), `${id} visit ${v.visit}`).toEqual(v.analytes);
      const perAnalyte = new Map<string, number>();
      for (const e of results) perAnalyte.set(e.analyte, (perAnalyte.get(e.analyte) ?? 0) + 1);
      expect([...perAnalyte.values()].every((n) => n === fx.expected.results_per_analyte_per_sample_without_a_rerun), id).toBe(true);
    }
  });

  it("Given the fleet Then a sample is closed only when both visits have passed", () => {
    const passed = new Map<string, number>();
    for (const r of run.runs) if (r.outcome === "qc_passed") passed.set(r.request_id, (passed.get(r.request_id) ?? 0) + 1);
    for (const s of run.samples.filter((x) => x.state !== "skipped")) expect(s.state === "closed", s.sample_id).toBe(passed.get(s.sample_id) === fx.expected.visits_per_sample);
  });
});
