import { wholeSeconds } from "../../clock.ts";
import { readAll } from "../../profiles.ts";
import type { Params } from "../../profiles.ts";
import { phLoopConfig } from "../../sensors.ts";
import type { PhLoopConfig, SensorConfig } from "../../sensors.ts";

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

