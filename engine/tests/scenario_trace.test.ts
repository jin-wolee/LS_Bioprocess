import { beforeAll, describe, expect, it } from "vitest";
import { runL3 } from "../src/analysis.ts";
import type { L3Input } from "../src/analysis.ts";
import type { ScenarioRun } from "../src/run.ts";
import { sensorTickEvents } from "../src/sensors.ts";
import type { SensorSeries } from "../src/sensors.ts";
import { toTraceResult, traceOfRun } from "../src/trace.ts";
import { runOf } from "./support/scenarios.ts";
import { makeAjv } from "./support/schemas.ts";

// Trace export of a scenario run (docs/prompts/11 Step 1): the L3 part exports a trace.json valid against the frozen schema,
// and replaying it through the S1a core gives the same runs. Randomness drawn in the scenario (qc_failed, over_range) travels as forced_outcomes.

describe("Trace export of a scenario run", () => {
  let run: ScenarioRun;
  beforeAll(() => {
    run = runOf("default", { seed: 3 });
  }, 120_000);

  it("Given a scenario run When its L3 part is exported Then trace.json validates against trace.schema.json and carries engine_version and seed", () => {
    const trace = traceOfRun(run.l3Input, run.runs);
    const validate = makeAjv().getSchema("trace.schema.json");
    expect(validate?.(trace), JSON.stringify(validate?.errors?.slice(0, 2))).toBe(true);
    expect(trace).toMatchObject({ schema_version: "1", seed: 3, engine_version: run.l3Input.engine_version });
    expect(trace.requests.length).toBe(run.l3Input.requests.length);
  });

  it("Then the outcomes drawn in the run (reruns for QC failure and over-range) are in forced_outcomes, one per non-passing run, and the export carries no fixture metadata", () => {
    const trace = traceOfRun(run.l3Input, run.runs);
    expect(trace.forced_outcomes.length).toBe(run.runs.filter((r) => r.outcome !== "qc_passed").length);
    expect(trace.forced_outcomes.length).toBeGreaterThan(0);
    expect("expected_result" in trace || "source" in trace).toBe(false);
  });

  it("Given the exported trace When it is replayed through the L3 core Then the runs are identical, to the second", () => {
    const trace = traceOfRun(run.l3Input, run.runs);
    const replay = runL3(structuredClone(trace) as unknown as L3Input);
    expect(toTraceResult(trace, replay.runs)).toEqual(toTraceResult(trace, run.runs));
    expect(replay.runs.length).toBe(run.runs.length);
  });
});

describe("The event log of a scenario run matches the event schema", () => {
  it("Given the default scenario Then every event, and the ticks of one sensor series, validates against event.schema.json, with the log_header first and times in order", () => {
    const run = runOf("default", { seed: 2 });
    const validate = makeAjv().getSchema("event.schema.json");
    expect(run.events[0]).toMatchObject({ type: "log_header", t: 0, seed: 2 });
    const kinds = new Set<string>();
    run.events.forEach((e, i) => {
      kinds.add(e.type);
      expect(validate?.(e), `${i} ${JSON.stringify(e)} ${JSON.stringify(validate?.errors?.slice(0, 1))}`).toBe(true);
      if (i > 0) expect(e.t).toBeGreaterThanOrEqual((run.events[i - 1] as { t: number }).t);
    });
    for (const t of ["inoculation", "process_event", "sample_planned", "sample_drawn", "label_bound", "sample_received", "aliquot_created", "calibration_recorded", "result_measured"]) expect(kinds.has(t), t).toBe(true);
    for (const e of sensorTickEvents(run.sensors[0] as SensorSeries).slice(0, 50)) expect(validate?.(e)).toBe(true);
  });

  // 2026-10-29 lactate calibration (A084, A085): the default culture no longer exceeds an analyzer limit (A089), so it logs no dilution_applied; a culture that starts above the 6 g/L lactate limit does
  it("Given a culture that starts at 8 g/L lactate, above the 6 g/L limit Then the over_range rerun and its dilution_applied validate too", () => {
    const run = runOf("default", { seed: 2, settings: { reactor_count: 6, bay_size: 6, cohort_size: 6, horizon_days: 8, production_days: 6, initial_lactate_g_per_l: 8 } });
    const validate = makeAjv().getSchema("event.schema.json");
    const dilutions = run.events.filter((e) => e.type === "dilution_applied" || (e.type === "rerun_requested" && e.reason === "over_range"));
    expect(dilutions.some((e) => e.type === "dilution_applied")).toBe(true);
    for (const e of dilutions) expect(validate?.(e), JSON.stringify(e)).toBe(true);
  });

  it("Then a skipped draw validates too (micro-scale profile)", () => {
    const run = runOf("default", { profiles: { bioreactor: "micro_mini_parallel" }, settings: { reactor_count: 6, bay_size: 6 } });
    const validate = makeAjv().getSchema("event.schema.json");
    const skipped = run.events.filter((e) => e.type === "draw_skipped_volume_budget");
    expect(skipped.length).toBeGreaterThan(0);
    for (const e of skipped) expect(validate?.(e)).toBe(true);
  });
});
