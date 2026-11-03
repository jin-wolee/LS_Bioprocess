import { describe, expect, it } from "vitest";
import { sensorTickEvents } from "../../src/sensors.ts";
import { runScenario } from "../../src/run.ts";
import { configOf, runOf } from "../support/scenarios.ts";
import { makeAjv } from "../support/schemas.ts";

// Contract, Time row (docs/prompts/10 Step 1): all event times are integer seconds. Every instant or duration the engine derives from a
// scenario parameter is rounded to whole seconds once, at load, with floor(x + 0.5). A parameter inside its ledger range can be
// fractional in seconds: a cohort interval of 1.1 d is 95040 s, but 1.1 * 86400 is 95040.00000000001 in floating point.

const AT = (value: number, unit: string, ref: string) => ({ value, unit, ref });
const FRACTIONAL = {
  cohort_interval_d: 1.1, // A188 range 0 to 2 d
  horizon_days: 10.3, // A189 range 14 to 42 d; a shorter horizon keeps the run small
  production_days: 6.7,
  shift_day: 3.3,
  inoculation_start_min: 480.4,
  inoculation_step_min: 15.3,
  feed_decision_min: 600.7,
  staffed_start_min: 480.2,
  staffed_end_weekday_min: 1080.7,
  staffed_end_weekend_min: 840.9,
  shift_change_min: 780.3,
  qc_window_start_min: 480.2,
  qc_window_length_min: 30.7,
  recalibration_interval_h: 2.3,
  edf_deadline_min: 600.7,
  feed_window_start_min: 540.3,
  feed_window_end_min: 660.9,
  burst_center_min: 510.6,
  stagger_bay_start_min: 480.2,
  stagger_window_min: 45.3,
  stagger_bay_offset_min: 45.3,
};
const FIELDS = {
  maintenance: [{ analyzer: "AN-1", start: AT(3 * 1440 + 510.4, "min", "A205"), length: AT(4.1, "h", "A096") }],
  lot_changes: [{ analyzer: "AN-2", at: AT(2 * 1440 + 100.3, "min", "A093") }],
  scripted_events: [{ type: "feed", unit_id: "U03", at: AT(2 * 1440 + 540.3, "min", "A102") }],
};

describe("Contract: integer seconds from fractional parameters", () => {
  it("Given the default scenario with a cohort interval of 1.1 d Then the second cohort is inoculated at 1.1 x 86400 + 28800 rounded to a whole second", () => {
    const run = runOf("default", { settings: { cohort_interval_d: 1.1 } });
    const inoculated = run.process.reactors.map((r) => r.inoculated_s);
    expect(inoculated[6]).toBe(Math.floor(1.1 * 86400 + 0.5) + 28800); // 95040 + 28800
    expect(inoculated.every(Number.isInteger)).toBe(true);
  });

  it.each(["burst", "staggered"] as const)("Given fractional parameters for every instant and duration (%s plan) Then every event time, tick time, window, request and run is an integer and the log validates against event.schema.json", (plan) => {
    const run = runOf("default", { sampling_plan: plan, settings: { ...FRACTIONAL, reactor_count: 12, bay_size: 6 }, fields: FIELDS });
    const validate = makeAjv().getSchema("event.schema.json");
    expect(run.events.length).toBeGreaterThan(500);
    run.events.forEach((e, i) => {
      expect(Number.isInteger(e.t), `${i} ${e.type} t=${e.t}`).toBe(true);
      expect(validate?.(e), `${i} ${JSON.stringify(e)} ${JSON.stringify(validate?.errors?.slice(0, 1))}`).toBe(true);
    });
    for (const s of run.sensors) {
      expect([s.t0_s, s.cadence_s, s.n].every(Number.isInteger), `${s.unit_id} ${s.signal}`).toBe(true);
    }
    for (const e of sensorTickEvents(run.sensors[0] as (typeof run.sensors)[number]).slice(0, 200)) expect(Number.isInteger(e.t)).toBe(true);
    const input = run.l3Input;
    for (const w of input.windows) expect([w.start_s, w.end_s].every(Number.isInteger), `${w.analyzer} ${w.kind}`).toBe(true);
    for (const r of input.requests) expect([r.arrive_s, r.sampled_s, r.deadline_s, r.seq].every(Number.isInteger), r.request_id).toBe(true);
    for (const r of run.runs) expect([r.start_s, r.end_s, r.setup_s].every(Number.isInteger), `${r.request_id}#${r.attempt}`).toBe(true);
    for (const s of run.samples) expect([s.planned_s, s.drawn_s, s.arrived_s, s.deadline_s].every(Number.isInteger), s.sample_id).toBe(true);
    for (const r of run.process.reactors) expect([r.inoculated_s, r.harvested_s, r.shift_s].every(Number.isInteger), r.unit_id).toBe(true);
    expect(run.events.some((e) => e.type === "maintenance_started")).toBe(true);
  });

  it("Then the configuration itself holds whole seconds for every instant and duration it derives from a parameter", () => {
    const cfg = configOf("default", { settings: { ...FRACTIONAL, reactor_count: 12, bay_size: 6 }, fields: FIELDS });
    const p = cfg.process;
    const s = cfg.sampling;
    const a = cfg.analysis;
    const instants = [
      p.horizon_s, p.cohortInterval_s, p.inocStart_s, p.inocStep_s, p.production_s, p.decision_s, p.shiftOffset_s,
      s.start_s, s.endWeekday_s, s.endWeekend_s, s.shiftChange_s, s.deadline_s,
      a.qcStart_s, a.qcLength_s, a.instrument.interval_s, a.instrument.horizon_s,
      ...a.maintenance.flatMap((m) => [m.start_s, m.end_s]), ...a.instrument.lotChanges.map((l) => l.at_s), ...p.scripted.map((e) => e.at_s),
    ];
    expect(instants.every(Number.isInteger)).toBe(true);
    expect(() => runScenario(cfg)).not.toThrow();
  });

  it("Given a fractional integration step or cadence Then the load is refused, not rounded", () => {
    expect(() => configOf("default", { settings: { integration_step_s: 60.5 } })).toThrow(/whole/);
    expect(() => configOf("default", { settings: { sensor_cadence_s: 90.5 } })).toThrow(/whole/);
  });
});
