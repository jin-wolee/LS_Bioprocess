import { wholeSeconds } from "./clock.ts";
import type { Event } from "./generated/event.schema";
import { readAll } from "./profiles.ts";
import type { Params } from "./profiles.ts";
import type { Rng } from "./rng.ts";
import { buildSensors, phLoopConfig } from "./sensors.ts";
import type { PhLoopConfig, SensorConfig, SensorSeries } from "./sensors.ts";

// L1 process model (spec 2.1, A011): nutrient-limited growth (Monod on glucose) under a logistic ceiling, death between an early and a late rate by
// the limitation of growth, nutrient use proportional to viable cells and capped by what is present, lactate from the growth rate in effect and a net consumption from the switch day (A085), product from integrated
// viable cells, fed by discrete boluses. Explicit Euler at the integration step (A200).
// The truth run is open loop: nothing from L3, L4 or L5 enters (feedback is false). Every value comes from scenario settings;
// the unit conversions below (1000 mM*g/mol per g/L, 1e-3 g/L per pg/cell/d at 1e6 cells/mL, seconds per hour and day) are not domain values.

const DAY = 86400;

export interface ScriptedEvent {
  /**
   * `stop` ends the unit at that instant (break-out script, spec 11.8.2 rule S2): no later feed, draw or harvest. `multiplier` sets the factor `mu` on the growth multiplier and/or `kd` on the death
   * multiplier of the unit from that instant, on top of the temperature shift (rule S13); a factor it does not name stays as it was, and a factor of 1 changes nothing. The scenario file cannot
   * name either: the break-out script does.
   */
  type: "feed" | "alarm" | "stop" | "multiplier";
  unit_id: string;
  at_s: number;
  mu?: number;
  kd?: number;
}

/** A scripted ramp on a true value of one unit (break-out rule S1): nothing up to `start_s`, linear from there to `change` at `end_s`, held after. The sensor overlay and the pH a sample carries read it alike. */
export interface Ramp { start_s: number; end_s: number; change: number }
export const rampAt = (r: Ramp, t: number): number => (t <= r.start_s ? 0 : r.change * (t >= r.end_s ? 1 : (t - r.start_s) / (r.end_s - r.start_s)));

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
  /** Death rate of a culture that grows freely (A212) and when growth is fully limited (A081). */
  kdMin: number;
  kdLate: number;
  ks: number;
  /** Carrying capacity of the logistic ceiling on growth (A008). */
  xmax: number;
  qGlc: number;
  qGln: number;
  qLac: number;
  /** The lactate switch (A085): on or off, the culture age in seconds from which it applies, and the net rate in pmol/cell/d (negative is consumption). */
  lacOn: boolean;
  lacOnset_s: number;
  qLacNet: number;
  qProd: number;
  mwGlc: number;
  mwLac: number;
  floor: number;
  decision_s: number;
  /** Fixed bolus of a scripted feed, as a fraction of the current culture volume (A192). The rule sizes its own (A050). */
  bolus: number;
  feedGlc: number;
  feedGln: number;
  /** Seconds after the inoculation day at which the shift happens, before the clock time of the daily decision (A195). */
  shiftOffset_s: number;
  shiftMu: number;
  shiftKd: number;
  shiftProd: number;
  volume_l: number;
  /** The working volume of each bay when the scenario names a profile per bay (spec 4.5.2); absent: `volume_l` for every bay. */
  bayVolume_l?: readonly number[];
  ph: number;
  sensors: SensorConfig;
  scripted: ScriptedEvent[];
  /** The seed lot of a unit, by unit id, when the break-out script names one: the inoculation event carries it. Absent: no inoculation does. */
  seedLots?: Readonly<Record<string, string>>;
  /** The scripted fall of the pH of a unit's culture, by unit id, when the break-out script moves pH (one pH truth, spec 11.8.8 C1): a sample drawn from the unit carries it. Absent: the set point. */
  phRamps?: Readonly<Record<string, Ramp>>;
  /** The feedback settings of experiment 2 (spec 6.2); absent in every scenario that stays open loop. Nothing in this file reads it. */
  phLoop?: PhLoopConfig;
}

/** The working volume of a bioreactor profile, in litres (A002, A104, A110). */
export const workingVolume = (bioreactor: Params): number => readAll(bioreactor, { volume: ["working_volume_l", "L"] }).volume;

/** A step or a cadence of the grid (spec 2.1): a whole number of seconds that divides one minute, so that every whole minute is a step. */
export const dividesMinute = (s: number): boolean => Number.isInteger(s) && s >= 1 && 60 % s === 0;

/**
 * The grid of the process (spec 2.1; audit A1, F6): the integration step and the sensor cadence divide one minute, because scheduled events sit on whole minutes (A200), so none falls
 * between two steps. The message of the first of the two a scenario breaks, or null; `processConfig` throws it and the lab's check of a spec asks it first.
 */
export const gridFault = (s: Params): string | null => {
  const v = readAll(s, { step: ["integration_step_s", "s"], cadence: ["sensor_cadence_s", "s"] });
  const grid = "a whole number of seconds that divides one minute (1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30 or 60 s), so that every scheduled event, on a whole minute, is a step";
  if (!dividesMinute(v.step)) return `the integration step must be ${grid} (A200); it is ${v.step} s`;
  if (!dividesMinute(v.cadence)) return `the sensor cadence must be ${grid} (A100, A200); it is ${v.cadence} s`;
  return null;
};

/**
 * The settings that place a scheduled event of the process (the inoculations of A188, the scheduled harvest of A004, the decision of A194, the shift of A195), resolved to whole seconds
 * as the loader resolves them: the message of the first that is not a whole minute, or null. A scenario file may place one off a whole minute (the Time contract rounds it to a whole
 * second, and the event splits its step at its instant, spec 2.1); the lab refuses it in a link (lab_ui.md section 4, "The settings of a spec"), so a run of the page has no event between two steps.
 */
export const scheduleFault = (s: Params): string | null => {
  const v = readAll(s, {
    inocStart: ["inoculation_start_min", "min"], inocStep: ["inoculation_step_min", "min"], cohortInterval: ["cohort_interval_d", "d"], production: ["production_days", "d"],
    decision: ["feed_decision_min", "min"], shift: ["shift_day", "d"],
  });
  const placed: [string, number][] = [
    ["the inoculation start (A188)", v.inocStart * 60], ["the inoculation step (A188)", v.inocStep * 60], ["the cohort interval (A188)", v.cohortInterval * DAY],
    ["the production time (A004)", v.production * DAY], ["the decision time (A194)", v.decision * 60], ["the shift day (A195)", v.shift * DAY],
  ];
  const off = placed.find(([, x]) => wholeSeconds(x) % 60 !== 0);
  return off ? `${off[0]} must place its event on a whole minute, so that it is an integration step (A200); it gives ${wholeSeconds(off[1])} s` : null;
};

export const processConfig = (s: Params, bioreactor: Params, scripted: ScriptedEvent[]): ProcessConfig => {
  const v = readAll(s, {
    reactors: ["reactor_count", "reactors"], baySize: ["bay_size", "reactors"], horizonDays: ["horizon_days", "d"], step: ["integration_step_s", "s"],
    cohortSize: ["cohort_size", "reactors"], cohortIntervalD: ["cohort_interval_d", "d"], inocStartMin: ["inoculation_start_min", "min"], inocStepMin: ["inoculation_step_min", "min"],
    productionDays: ["production_days", "d"], density: ["inoculation_density_e6_per_ml", "1e6 cells/mL"], viability0: ["initial_viability_pct", "%"],
    glucose0: ["initial_glucose_g_per_l", "g/L"], glutamine0: ["initial_glutamine_mm", "mM"], lactate0: ["initial_lactate_g_per_l", "g/L"], titer0: ["initial_titer_g_per_l", "g/L"],
    harvestViability: ["harvest_viability_pct", "%"],
    mu: ["mu_max_per_h", "1/h"], kdMin: ["early_death_per_h", "1/h"], kdLate: ["late_death_per_h", "1/h"], ks: ["glucose_ks_g_per_l", "g/L"], xmax: ["carrying_capacity_e6_per_ml", "1e6 cells/mL"],
    qGlc: ["glucose_uptake_pmol_per_cell_d", "pmol/cell/d"], qGln: ["glutamine_uptake_pmol_per_cell_d", "pmol/cell/d"], qLac: ["lactate_production_pmol_per_cell_d", "pmol/cell/d"],
    lacSwitch: ["lactate_switch_on", "flag"], lacDay: ["lactate_switch_day", "d"], qLacNet: ["lactate_net_rate_pmol_per_cell_d", "pmol/cell/d"],
    qProd: ["productivity_pg_per_cell_d", "pg/cell/d"], mwGlc: ["glucose_molar_mass_g_per_mol", "g/mol"], mwLac: ["lactate_molar_mass_g_per_mol", "g/mol"],
    floor: ["glucose_floor_g_per_l", "g/L"], decisionMin: ["feed_decision_min", "min"], bolusPct: ["feed_bolus_pct", "%"], feedGlc: ["feed_glucose_g_per_l", "g/L"], feedGln: ["feed_glutamine_mm", "mM"],
    shiftDay: ["shift_day", "d"], shiftSp: ["shift_setpoint_c", "C"], shiftMu: ["shift_growth_multiplier", "factor"], shiftKd: ["shift_death_multiplier", "factor"], shiftProd: ["shift_productivity_multiplier", "factor"],
    ph: ["ph_setpoint", "pH"], cadence: ["sensor_cadence_s", "s"], doSp: ["do_setpoint_pct", "% air saturation"], tempSp: ["temperature_setpoint_c", "C"],
    phSd: ["ph_noise_sd", "pH"], doSd: ["do_noise_sd_pct", "% air saturation"], tempSd: ["temperature_noise_sd_c", "C"], lagMin: ["temperature_lag_min", "min"],
  });
  const volume = workingVolume(bioreactor);
  const off = gridFault(s);
  if (off !== null) throw new Error(off);
  if (v.cohortSize <= 0) throw new Error("the cohort size must be positive");
  if (!(v.feedGlc > v.floor)) throw new Error("the glucose of the feed must exceed the glucose floor (A193, A010)");
  if (!(v.xmax > 0)) throw new Error("the carrying capacity must be positive (A008)");
  if (v.lacSwitch !== 0 && v.lacSwitch !== 1) throw new Error("the lactate switch must be 1 (on) or 0 (off) (A085)");
  if (!(v.lacDay >= 0)) throw new Error("the culture day of the lactate switch must not be negative (A085)");
  // every instant and duration derived from a parameter becomes whole seconds here, once (contract: Time)
  const whole = wholeSeconds;
  const phLoop = phLoopConfig(s, v.cadence);
  return {
    reactors: v.reactors, baySize: v.baySize, horizon_s: whole(v.horizonDays * DAY), step_s: v.step,
    cohortSize: v.cohortSize, cohortInterval_s: whole(v.cohortIntervalD * DAY), inocStart_s: whole(v.inocStartMin * 60), inocStep_s: whole(v.inocStepMin * 60),
    production_s: whole(v.productionDays * DAY), density: v.density, viability0: v.viability0, glucose0: v.glucose0, glutamine0: v.glutamine0, lactate0: v.lactate0, titer0: v.titer0,
    harvestViability: v.harvestViability, mu: v.mu, kdMin: v.kdMin, kdLate: v.kdLate, ks: v.ks, xmax: v.xmax, qGlc: v.qGlc, qGln: v.qGln, qLac: v.qLac, lacOn: v.lacSwitch === 1, lacOnset_s: whole(v.lacDay * DAY), qLacNet: v.qLacNet, qProd: v.qProd, mwGlc: v.mwGlc, mwLac: v.mwLac,
    floor: v.floor, decision_s: whole(v.decisionMin * 60), bolus: v.bolusPct / 100, feedGlc: v.feedGlc, feedGln: v.feedGln,
    shiftOffset_s: whole(v.shiftDay * DAY), shiftMu: v.shiftMu, shiftKd: v.shiftKd, shiftProd: v.shiftProd, volume_l: volume, ph: v.ph,
    sensors: { step_s: v.step, cadence_s: v.cadence, phSp: v.ph, phSd: v.phSd, doSp: v.doSp, doSd: v.doSd, tempSp: v.tempSp, tempSd: v.tempSd, tempShiftSp: v.shiftSp, tempLag_s: whole(v.lagMin * 60) },
    scripted,
    ...(phLoop && { phLoop }),
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

export interface State { x: number; d: number; g: number; q: number; l: number; p: number }
export interface Mult { mu: number; kd: number; prod: number }
/** The scripted factors on the growth and death multipliers (rule S13), and the instant from which a stored step of a unit has them. */
export interface Factor { mu: number; kd: number }
export interface FactorStep extends Factor { t: number }
/** An instant between two stored steps at which a moment split the step (spec 2.1), with the state after the moments of that instant. */
export interface Split { t: number; state: State }

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
  /** The multiplier moments that happened, in order, each with the factors in effect from it on (rule S13). Empty when the unit had none. */
  factors: FactorStep[];
  /** The instants at which a moment between two steps split a step, in order (spec 2.1). Empty when every moment sat on a step. */
  splits: Split[];
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
const ONE: Factor = { mu: 1, kd: 1 };
/** The multipliers in effect: the base, or the temperature shift once it has happened (A196), times the scripted factors (rule S13). Every moment that changes a multiplier, and the lookup of a stored step, go through here. */
const multOf = (c: ProcessConfig, shift: boolean, f: Factor = ONE): Mult => {
  const m = shift ? shifted(c) : BASE;
  return f === ONE ? m : { mu: m.mu * f.mu, kd: m.kd * f.kd, prod: m.prod };
};

/** One explicit Euler step of dt seconds, in place; every increment is computed from the state at the start of the step, which is at culture age age_s (0 when the age does not matter). */
export const advance = (c: ProcessConfig, s: State, m: Mult, dt: number, age_s = 0): void => {
  const dh = dt / 3600;
  const dd = dt / DAY;
  const x = s.x;
  // limitation of growth: Monod on glucose under the logistic ceiling, no temperature factor (A011, A109, A008)
  const phi = s.g > 0 ? (s.g / (c.ks + s.g)) * Math.max(0, 1 - x / c.xmax) : 0;
  const mu = c.mu * m.mu * phi;
  const kd = (c.kdMin + (c.kdLate - c.kdMin) * (1 - phi)) * m.kd;
  s.g -= Math.min(s.g, ((c.qGlc * x * c.mwGlc) / 1000) * dd);
  s.q -= Math.min(s.q, c.qGln * x * dd);
  // lactate: production follows the growth rate in effect, mu / mu_max = m_T x phi, so none without glucose and half after the shift (A084, A196, S056, S054);
  // from the switch day the net rate replaces it and lactate stops at zero (A085)
  const lactate = c.lacOn && age_s >= c.lacOnset_s ? c.qLacNet * x : c.qLac * x * m.mu * phi;
  s.l = Math.max(0, s.l + ((lactate * c.mwLac) / 1000) * dd);
  s.p += c.qProd * m.prod * x * 1e-3 * dd;
  s.x += (mu - kd) * x * dh;
  s.d += kd * x * dh;
};

/** The smallest bolus share that brings the glucose of the next decision, 24 h on, to the floor (A050): consumption predicted from the current
 * viable density with no growth, cells and glucose diluted by the bolus. Zero when the prediction already meets the floor. */
const ruleShare = (c: ProcessConfig, s: State): number => {
  const consumption = (c.qGlc * s.x * c.mwGlc) / 1000; // g/L per day
  return Math.max(0, (c.floor + consumption - s.g) / (c.feedGlc - c.floor));
};

/** A bolus of a share f of the current volume: cells and analytes are diluted, glucose and glutamine rise (A192, A193, A208). Returns the volume added in litres. */
const bolus = (c: ProcessConfig, s: State, volume: { l: number }, f: number): number => {
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

type Kind = "stop" | "alarm" | "scripted_feed" | "multiplier" | "shift" | "decision" | "harvest";
interface Moment { t: number; rank: number; kind: Kind; ev?: ScriptedEvent }
/** The scripted moments in the order they apply at an equal instant; a stop comes first, so nothing else happens at the instant a unit is stopped. */
const SCRIPTED: Record<ScriptedEvent["type"], Pick<Moment, "rank" | "kind">> = {
  stop: { rank: -1, kind: "stop" }, alarm: { rank: 0, kind: "alarm" }, feed: { rank: 1, kind: "scripted_feed" }, multiplier: { rank: 2, kind: "multiplier" },
};

/** The unit id of the reactor at index i, counted from 0: U01, U02, ... */
export const unitIdOf = (i: number): string => `U${String(i + 1).padStart(2, "0")}`;
export const batchIdOf = (unit_id: string): string => `B-${unit_id}`;
/** The instant reactor i is inoculated: the start of its cohort plus its place in the cohort (A188). The scenario loader calls it for the break-out script. */
export const inoculationInstant = (c: ProcessConfig, i: number): number => Math.floor(i / c.cohortSize) * c.cohortInterval_s + c.inocStart_s + (i % c.cohortSize) * c.inocStep_s;

const simulate = (c: ProcessConfig, i: number, events: Event[]): Reactor | undefined => {
  const unit_id = unitIdOf(i);
  const t0 = inoculationInstant(c, i);
  if (t0 >= c.horizon_s) return undefined;
  const batch_id = batchIdOf(unit_id);
  const shift_s = Math.floor(t0 / DAY) * DAY + c.shiftOffset_s + c.decision_s;
  const end_s = t0 + c.production_s;
  const last = Math.min(end_s, c.horizon_s);

  // the moments after inoculation, in the order they apply at an equal instant: alarms, scripted feeds, the shift, the daily decision, the scheduled harvest
  const moments: Moment[] = [{ t: end_s, rank: 4, kind: "harvest" }];
  for (let day = Math.floor(t0 / DAY); day * DAY + c.decision_s < last; day++) if (day * DAY + c.decision_s > t0) moments.push({ t: day * DAY + c.decision_s, rank: 3, kind: "decision" });
  if (shift_s > t0 && shift_s < last) moments.push({ t: shift_s, rank: 2, kind: "shift" });
  // a multiplier moment at the inoculation instant applies from the first step (an onset at the inoculation with no delay, spec 11.8.11 C29); every other scripted moment comes after it
  for (const e of c.scripted) if (e.unit_id === unit_id && (e.type === "multiplier" ? e.at_s >= t0 : e.at_s > t0) && e.at_s < last) moments.push({ t: e.at_s, ...SCRIPTED[e.type], ev: e });
  moments.sort((a, b) => a.t - b.t || a.rank - b.rank);

  const size = Math.ceil((last - t0) / c.step_s) + 1;
  const r: Reactor = {
    unit_id, batch_id, bay: Math.floor(i / c.baySize) + 1, slot: i % c.baySize, inoculated_s: t0, harvested_s: last, shift_s, factors: [], splits: [], step_s: c.step_s, n: 0,
    x: new Float64Array(size), d: new Float64Array(size), g: new Float64Array(size), q: new Float64Array(size), l: new Float64Array(size), p: new Float64Array(size),
  };
  const dead0 = (c.density * (100 - c.viability0)) / c.viability0;
  const s: State = { x: c.density, d: dead0, g: c.glucose0, q: c.glutamine0, l: c.lactate0, p: c.titer0 };
  const volume = { l: c.bayVolume_l?.[Math.floor(i / c.baySize)] ?? c.volume_l };
  const mult: Mult = { ...BASE };
  let shiftOn = false;
  let factor = ONE;
  events.push({ type: "inoculation", t: t0, unit_id, batch_id, density_e6_per_ml: c.density, ...(c.seedLots?.[unit_id] !== undefined && { seed_lot_id: c.seedLots[unit_id] }) });
  const process = (t: number, kind: "feed" | "temperature_shift" | "alarm" | "harvest" | "unit_stopped", source: "rule" | "scheduled" | "scripted", amount?: number, amount_unit?: string): void => {
    events.push({ type: "process_event", t, unit_id, batch_id, kind, source, ...(amount !== undefined && { amount, amount_unit }) } as Event);
  };

  // A moment between two steps splits its step (spec 2.1): `reach` integrates the state from `from` to the moment's instant with the multipliers in effect before it. A moment on a step finds
  // the state there already, so a run whose moments all sit on steps integrates whole steps only. A stop or a harvest ends the unit: nothing is integrated past it.
  let from = t0;
  const reach = (at: number): void => {
    if (at <= from) return;
    advance(c, s, mult, at - from, from - t0);
    from = at;
  };
  /** New multipliers from an instant: a change of them splits the step there; the same multipliers again (a factor of 1) leave it whole (rule S13). */
  const rates = (at: number, next: Mult): void => {
    if (next.mu !== mult.mu || next.kd !== mult.kd || next.prod !== mult.prod) reach(at);
    Object.assign(mult, next);
  };
  let m = 0;
  let done = false;
  const apply = (mo: Moment): void => {
    if (mo.kind === "stop") {
      process(mo.t, "unit_stopped", "scripted");
      r.harvested_s = mo.t;
      done = true;
    } else if (mo.kind === "alarm") process(mo.t, "alarm", "scripted");
    else if (mo.kind === "scripted_feed") {
      reach(mo.t);
      process(mo.t, "feed", "scripted", bolus(c, s, volume, c.bolus), "L");
    } else if (mo.kind === "multiplier") {
      const ev = mo.ev as ScriptedEvent;
      factor = { mu: ev.mu ?? factor.mu, kd: ev.kd ?? factor.kd };
      r.factors.push({ t: mo.t, ...factor });
      rates(mo.t, multOf(c, shiftOn, factor));
    } else if (mo.kind === "shift") {
      shiftOn = true;
      rates(mo.t, multOf(c, shiftOn, factor));
      process(mo.t, "temperature_shift", "scheduled", c.sensors.tempShiftSp, "C");
    } else if (mo.kind === "decision") {
      reach(mo.t); // the rule reads the state at its instant
      if (viabilityOf(s) < c.harvestViability) {
        process(mo.t, "harvest", "rule");
        r.harvested_s = mo.t;
        done = true;
      } else {
        const f = ruleShare(c, s);
        if (f > 0) process(mo.t, "feed", "rule", bolus(c, s, volume, f), "L");
      }
    } else {
      process(mo.t, "harvest", "scheduled");
      r.harvested_s = mo.t;
      done = true;
    }
  };

  for (let k = 0; ; k++) {
    const t = t0 + k * c.step_s;
    while (m < moments.length && (moments[m] as Moment).t <= t && !done) apply(moments[m++] as Moment);
    r.x[k] = s.x; r.d[k] = s.d; r.g[k] = s.g; r.q[k] = s.q; r.l[k] = s.l; r.p[k] = s.p;
    r.n = k + 1;
    if (done || t >= last) break;
    // the moments inside the step, each instant in turn, then the rest of the step; an instant that split the step is kept with the state after its moments, for stateAt
    const next = t + c.step_s;
    while (m < moments.length && (moments[m] as Moment).t < next && !done) {
      const at = (moments[m] as Moment).t;
      while (m < moments.length && (moments[m] as Moment).t === at && !done) apply(moments[m++] as Moment);
      if (from === at && !done) r.splits.push({ t: at, state: { ...s } });
    }
    if (done) break;
    advance(c, s, mult, next - from, from - t0);
    from = next;
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

/**
 * The true state of a unit at any instant: the latest stored step or split at or before it (spec 2.1), advanced by the remaining seconds with the same scheme and the multipliers in effect
 * from there, so every moment between the stored step and the instant counts. A stopped or harvested unit keeps the state of its end.
 */
export const stateAt = (run: ProcessRun, unit_id: string, t: number): CultureState => {
  const r = run.byUnit.get(unit_id);
  if (!r) throw new Error(`no such unit: ${unit_id}`);
  if (t < r.inoculated_s) throw new Error(`${unit_id} is not inoculated at ${t}`);
  const k = Math.min(Math.floor((t - r.inoculated_s) / r.step_s), r.n - 1);
  const tk = r.inoculated_s + k * r.step_s;
  const split = r.splits.findLast((x) => x.t > tk && x.t <= t);
  const from = split?.t ?? tk;
  const s: State = split ? { ...split.state } : { x: r.x[k] as number, d: r.d[k] as number, g: r.g[k] as number, q: r.q[k] as number, l: r.l[k] as number, p: r.p[k] as number };
  const dt = Math.min(t, r.harvested_s) - from;
  if (dt > 0) advance(run.cfg, s, multOf(run.cfg, from >= r.shift_s, r.factors.filter((x) => x.t <= from).at(-1) ?? ONE), dt, from - r.inoculated_s);
  const ramp = run.cfg.phRamps?.[unit_id];
  return { vcd: s.x, viability: viabilityOf(s), glucose: s.g, glutamine: s.q, lactate: s.l, titer: s.p, ph: ramp === undefined ? run.cfg.ph : run.cfg.ph + rampAt(ramp, t) };
};
