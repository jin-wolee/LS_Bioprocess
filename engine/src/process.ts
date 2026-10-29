import { wholeSeconds } from "./clock.ts";
import type { Event } from "./generated/event.schema";
import { readAll } from "./profiles.ts";
import type { Params } from "./profiles.ts";
import type { Rng } from "./rng.ts";
import { buildSensors } from "./sensors.ts";
import type { SensorConfig, SensorSeries } from "./sensors.ts";

// L1 process model (spec 2.1, A011): nutrient-limited growth (Monod on glucose) with first-order death, nutrient use proportional
// to viable cells, product from integrated viable cells, fed by discrete boluses. Explicit Euler at the integration step (A200).
// The truth run is open loop: nothing from L3, L4 or L5 enters (feedback is false). Every value comes from scenario settings;
// the unit conversions below (1000 mM*g/mol per g/L, 1e-3 g/L per pg/cell/d at 1e6 cells/mL, seconds per hour and day) are not domain values.

const DAY = 86400;

export interface ScriptedEvent {
  type: "feed" | "alarm";
  unit_id: string;
  at_s: number;
}

export interface ProcessConfig {
  reactors: number;
  baySize: number;
  horizon_s: number;
  step_s: number;
  cohortSize: number;
  cohortInterval_s: number;
  inocStart_s: number;
  inocStep_s: number;
  production_s: number;
  density: number;
  viability0: number;
  glucose0: number;
  glutamine0: number;
  lactate0: number;
  titer0: number;
  harvestViability: number;
  mu: number;
  kd: number;
  ks: number;
  qGlc: number;
  qGln: number;
  qLac: number;
  qProd: number;
  mwGlc: number;
  mwLac: number;
  floor: number;
  decision_s: number;
  /** Bolus as a fraction of the current culture volume (A192). */
  bolus: number;
  feedGlc: number;
  feedGln: number;
  /** Seconds after the inoculation day at which the shift happens, before the clock time of the daily decision (A195). */
  shiftOffset_s: number;
  shiftMu: number;
  shiftKd: number;
  shiftProd: number;
  volume_l: number;
  ph: number;
  sensors: SensorConfig;
  scripted: ScriptedEvent[];
}

export const processConfig = (s: Params, bioreactor: Params, scripted: ScriptedEvent[]): ProcessConfig => {
  const v = readAll(s, {
    reactors: ["reactor_count", "reactors"], baySize: ["bay_size", "reactors"], horizonDays: ["horizon_days", "d"], step: ["integration_step_s", "s"],
    cohortSize: ["cohort_size", "reactors"], cohortIntervalD: ["cohort_interval_d", "d"], inocStartMin: ["inoculation_start_min", "min"], inocStepMin: ["inoculation_step_min", "min"],
    productionDays: ["production_days", "d"], density: ["inoculation_density_e6_per_ml", "1e6 cells/mL"], viability0: ["initial_viability_pct", "%"],
    glucose0: ["initial_glucose_g_per_l", "g/L"], glutamine0: ["initial_glutamine_mm", "mM"], lactate0: ["initial_lactate_g_per_l", "g/L"], titer0: ["initial_titer_g_per_l", "g/L"],
    harvestViability: ["harvest_viability_pct", "%"],
    mu: ["mu_max_per_h", "1/h"], kd: ["death_per_h", "1/h"], ks: ["glucose_ks_g_per_l", "g/L"],
    qGlc: ["glucose_uptake_pmol_per_cell_d", "pmol/cell/d"], qGln: ["glutamine_uptake_pmol_per_cell_d", "pmol/cell/d"], qLac: ["lactate_production_pmol_per_cell_d", "pmol/cell/d"],
    qProd: ["productivity_pg_per_cell_d", "pg/cell/d"], mwGlc: ["glucose_molar_mass_g_per_mol", "g/mol"], mwLac: ["lactate_molar_mass_g_per_mol", "g/mol"],
    floor: ["glucose_floor_g_per_l", "g/L"], decisionMin: ["feed_decision_min", "min"], bolusPct: ["feed_bolus_pct", "%"], feedGlc: ["feed_glucose_g_per_l", "g/L"], feedGln: ["feed_glutamine_mm", "mM"],
    shiftDay: ["shift_day", "d"], shiftSp: ["shift_setpoint_c", "C"], shiftMu: ["shift_growth_multiplier", "factor"], shiftKd: ["shift_death_multiplier", "factor"], shiftProd: ["shift_productivity_multiplier", "factor"],
    ph: ["ph_setpoint", "pH"], cadence: ["sensor_cadence_s", "s"], doSp: ["do_setpoint_pct", "% air saturation"], tempSp: ["temperature_setpoint_c", "C"],
    phSd: ["ph_noise_sd", "pH"], doSd: ["do_noise_sd_pct", "% air saturation"], tempSd: ["temperature_noise_sd_c", "C"], lagMin: ["temperature_lag_min", "min"],
  });
  const { volume } = readAll(bioreactor, { volume: ["working_volume_l", "L"] });
  if (!Number.isInteger(v.step) || v.step <= 0) throw new Error("the integration step must be a whole number of seconds, at least 1 (A200)");
  if (!Number.isInteger(v.cadence) || v.cadence <= 0) throw new Error("the sensor cadence must be a whole number of seconds, at least 1 (A100)");
  if (v.cohortSize <= 0) throw new Error("the cohort size must be positive");
  // every instant and duration derived from a parameter becomes whole seconds here, once (contract: Time)
  const whole = wholeSeconds;
  return {
    reactors: v.reactors, baySize: v.baySize, horizon_s: whole(v.horizonDays * DAY), step_s: v.step,
    cohortSize: v.cohortSize, cohortInterval_s: whole(v.cohortIntervalD * DAY), inocStart_s: whole(v.inocStartMin * 60), inocStep_s: whole(v.inocStepMin * 60),
    production_s: whole(v.productionDays * DAY), density: v.density, viability0: v.viability0, glucose0: v.glucose0, glutamine0: v.glutamine0, lactate0: v.lactate0, titer0: v.titer0,
    harvestViability: v.harvestViability, mu: v.mu, kd: v.kd, ks: v.ks, qGlc: v.qGlc, qGln: v.qGln, qLac: v.qLac, qProd: v.qProd, mwGlc: v.mwGlc, mwLac: v.mwLac,
    floor: v.floor, decision_s: whole(v.decisionMin * 60), bolus: v.bolusPct / 100, feedGlc: v.feedGlc, feedGln: v.feedGln,
    shiftOffset_s: whole(v.shiftDay * DAY), shiftMu: v.shiftMu, shiftKd: v.shiftKd, shiftProd: v.shiftProd, volume_l: volume, ph: v.ph,
    sensors: { step_s: v.step, cadence_s: v.cadence, phSp: v.ph, phSd: v.phSd, doSp: v.doSp, doSd: v.doSd, tempSp: v.tempSp, tempSd: v.tempSd, tempShiftSp: v.shiftSp, tempLag_s: whole(v.lagMin * 60) },
    scripted,
  };
};

/** The true state of a culture, by analyte id: what a sample drawn at that instant contains. */
export interface CultureState {
  vcd: number;
  viability: number;
  glucose: number;
  glutamine: number;
  lactate: number;
  titer: number;
  ph: number;
}

interface State { x: number; d: number; g: number; q: number; l: number; p: number }
interface Mult { mu: number; kd: number; prod: number }

export interface Reactor {
  unit_id: string;
  batch_id: string;
  bay: number;
  /** Position inside the bay, from 0. */
  slot: number;
  inoculated_s: number;
  /** The harvest instant, or the horizon when the batch is still open at its end. */
  harvested_s: number;
  /** Instant of the temperature shift (A195); the multipliers of A196 apply from here. */
  shift_s: number;
  step_s: number;
  /** Number of stored steps: index k is the state at inoculated_s + k * step_s, after the events of that instant. */
  n: number;
  x: Float64Array;
  d: Float64Array;
  g: Float64Array;
  q: Float64Array;
  l: Float64Array;
  p: Float64Array;
}

export interface ProcessRun {
  cfg: ProcessConfig;
  reactors: Reactor[];
  byUnit: Map<string, Reactor>;
  events: Event[];
  sensors: SensorSeries[];
}

const BASE: Mult = { mu: 1, kd: 1, prod: 1 };
const shifted = (c: ProcessConfig): Mult => ({ mu: c.shiftMu, kd: c.shiftKd, prod: c.shiftProd });

/** One explicit Euler step of dt seconds, in place; every increment is computed from the state at the start of the step. */
const advance = (c: ProcessConfig, s: State, m: Mult, dt: number): void => {
  const dh = dt / 3600;
  const dd = dt / DAY;
  const x = s.x;
  const mu = s.g > 0 ? (c.mu * m.mu * s.g) / (c.ks + s.g) : 0;
  const kd = c.kd * m.kd;
  s.g = Math.max(0, s.g - ((c.qGlc * x * c.mwGlc) / 1000) * dd);
  s.q = Math.max(0, s.q - c.qGln * x * dd);
  s.l += ((c.qLac * x * c.mwLac) / 1000) * dd;
  s.p += c.qProd * m.prod * x * 1e-3 * dd;
  s.x += (mu - kd) * x * dh;
  s.d += kd * x * dh;
};

/** A bolus of a share of the current volume: cells and analytes are diluted, glucose and glutamine rise (A192, A193, A208). Returns the volume added in litres. */
const bolus = (c: ProcessConfig, s: State, volume: { l: number }): number => {
  const f = c.bolus;
  const added = f * volume.l;
  volume.l += added;
  const k = 1 + f;
  s.x /= k;
  s.d /= k;
  s.l /= k;
  s.p /= k;
  s.g = (s.g + f * c.feedGlc) / k;
  s.q = (s.q + f * c.feedGln) / k;
  return added;
};

const viabilityOf = (s: State): number => (100 * s.x) / (s.x + s.d);

type Kind = "alarm" | "scripted_feed" | "shift" | "decision" | "harvest";
interface Moment { t: number; rank: number; kind: Kind }

const simulate = (c: ProcessConfig, i: number, events: Event[]): Reactor | undefined => {
  const unit_id = `U${String(i + 1).padStart(2, "0")}`;
  const t0 = Math.floor(i / c.cohortSize) * c.cohortInterval_s + c.inocStart_s + (i % c.cohortSize) * c.inocStep_s;
  if (t0 >= c.horizon_s) return undefined;
  const batch_id = `B-${unit_id}`;
  const shift_s = Math.floor(t0 / DAY) * DAY + c.shiftOffset_s + c.decision_s;
  const end_s = t0 + c.production_s;
  const last = Math.min(end_s, c.horizon_s);

  // the moments after inoculation, in the order they apply at an equal instant: alarms, scripted feeds, the shift, the daily decision, the scheduled harvest
  const moments: Moment[] = [{ t: end_s, rank: 4, kind: "harvest" }];
  for (let day = Math.floor(t0 / DAY); day * DAY + c.decision_s < last; day++) if (day * DAY + c.decision_s > t0) moments.push({ t: day * DAY + c.decision_s, rank: 3, kind: "decision" });
  if (shift_s > t0 && shift_s < last) moments.push({ t: shift_s, rank: 2, kind: "shift" });
  for (const e of c.scripted) if (e.unit_id === unit_id && e.at_s > t0 && e.at_s < last) moments.push({ t: e.at_s, rank: e.type === "alarm" ? 0 : 1, kind: e.type === "alarm" ? "alarm" : "scripted_feed" });
  moments.sort((a, b) => a.t - b.t || a.rank - b.rank);

  const size = Math.ceil((last - t0) / c.step_s) + 1;
  const r: Reactor = {
    unit_id, batch_id, bay: Math.floor(i / c.baySize) + 1, slot: i % c.baySize, inoculated_s: t0, harvested_s: last, shift_s, step_s: c.step_s, n: 0,
    x: new Float64Array(size), d: new Float64Array(size), g: new Float64Array(size), q: new Float64Array(size), l: new Float64Array(size), p: new Float64Array(size),
  };
  const dead0 = (c.density * (100 - c.viability0)) / c.viability0;
  const s: State = { x: c.density, d: dead0, g: c.glucose0, q: c.glutamine0, l: c.lactate0, p: c.titer0 };
  const volume = { l: c.volume_l };
  const mult: Mult = { ...BASE };
  events.push({ type: "inoculation", t: t0, unit_id, batch_id, density_e6_per_ml: c.density });
  const process = (t: number, kind: "feed" | "temperature_shift" | "alarm" | "harvest", source: "rule" | "scheduled" | "scripted", amount?: number, amount_unit?: string): void => {
    events.push({ type: "process_event", t, unit_id, batch_id, kind, source, ...(amount !== undefined && { amount, amount_unit }) } as Event);
  };

  let m = 0;
  let done = false;
  for (let k = 0; ; k++) {
    const t = t0 + k * c.step_s;
    while (m < moments.length && (moments[m] as Moment).t <= t && !done) {
      const mo = moments[m++] as Moment;
      if (mo.kind === "alarm") process(mo.t, "alarm", "scripted");
      else if (mo.kind === "scripted_feed") process(mo.t, "feed", "scripted", bolus(c, s, volume), "L");
      else if (mo.kind === "shift") {
        Object.assign(mult, shifted(c));
        process(mo.t, "temperature_shift", "scheduled", c.sensors.tempShiftSp, "C");
      } else if (mo.kind === "decision") {
        if (viabilityOf(s) < c.harvestViability) {
          process(mo.t, "harvest", "rule");
          r.harvested_s = mo.t;
          done = true;
        } else if (s.g < c.floor) process(mo.t, "feed", "rule", bolus(c, s, volume), "L");
      } else {
        process(mo.t, "harvest", "scheduled");
        r.harvested_s = mo.t;
        done = true;
      }
    }
    r.x[k] = s.x; r.d[k] = s.d; r.g[k] = s.g; r.q[k] = s.q; r.l[k] = s.l; r.p[k] = s.p;
    r.n = k + 1;
    if (done || t >= last) break;
    advance(c, s, mult, c.step_s);
  }
  return r;
};

export const runProcess = (c: ProcessConfig, seed: number, rng: Rng): ProcessRun => {
  const events: Event[] = [];
  const reactors: Reactor[] = [];
  for (let i = 0; i < c.reactors; i++) {
    const r = simulate(c, i, events);
    if (r) reactors.push(r);
  }
  const sensors = reactors.flatMap((r) => buildSensors(c.sensors, r, seed, rng));
  events.sort((a, b) => a.t - b.t); // stable: emission order breaks ties
  return { cfg: c, reactors, byUnit: new Map(reactors.map((r) => [r.unit_id, r])), events, sensors };
};

/** The true state of a unit at any instant: the stored step before it, advanced by the remaining seconds with the same scheme. */
export const stateAt = (run: ProcessRun, unit_id: string, t: number): CultureState => {
  const r = run.byUnit.get(unit_id);
  if (!r) throw new Error(`no such unit: ${unit_id}`);
  if (t < r.inoculated_s) throw new Error(`${unit_id} is not inoculated at ${t}`);
  const k = Math.min(Math.floor((t - r.inoculated_s) / r.step_s), r.n - 1);
  const tk = r.inoculated_s + k * r.step_s;
  const s: State = { x: r.x[k] as number, d: r.d[k] as number, g: r.g[k] as number, q: r.q[k] as number, l: r.l[k] as number, p: r.p[k] as number };
  const dt = Math.min(t, r.harvested_s) - tk;
  if (dt > 0) advance(run.cfg, s, tk >= r.shift_s ? shifted(run.cfg) : BASE, dt);
  return { vcd: s.x, viability: viabilityOf(s), glucose: s.g, glutamine: s.q, lactate: s.l, titer: s.p, ph: run.cfg.ph };
};
