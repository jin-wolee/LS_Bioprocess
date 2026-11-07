import { gridFault, scheduleFault } from "../../../process.ts";
import type { ScenarioDoc } from "./setup.ts";

// The settings a link or the form can carry, checked in one place against physical possibility (docs/design/lab_ui.md section 4, "The settings of a spec"; audit A1, findings F5
// and F6, the author's decision of 2026-11-02, made total in the rework of the same day). Every setting of every bundled scenario has a kind (engine/tests/lab/spec_bounds.test.ts fails on
// one without), and a value its kind does not allow is refused; a value inside the bounds but outside the ledger range of its id is only a warning on the page, as before. Three kinds allow
// any finite number, each for its reason: a set point (the controller's target, which the scenario chooses), a signed quantity (a net rate or a step whose sign is part of its meaning) and an
// offset (an order of two windows, either way a plan). The grid of the process (spec section 2.1) is asked of the engine, so that the reason is the engine's: the step and the cadence, which
// the loader refuses too, and the settings that place a scheduled event, which a link must put on a whole minute.

type Kind =
  | "count" | "probability" | "rerun_probability" | "share_pct" | "viability" | "concentration" | "duration" | "instant" | "rate" | "factor" | "spread" | "switch" | "constant" | "set_point" | "signed" | "offset";

const KINDS: Readonly<Record<string, Kind>> = {
  reactor_count: "count", bay_size: "count", analyzer_count: "count", cohort_size: "count", operators_per_shift: "count", weekend_operators: "count", samples_per_reactor_per_day: "count",
  second_sample_fraction: "probability", burst_share: "probability", rerun_probability: "rerun_probability", technique_error_probability: "probability",
  feed_bolus_pct: "share_pct", volume_cap_pct: "share_pct",
  initial_viability_pct: "viability", harvest_viability_pct: "viability",
  inoculation_density_e6_per_ml: "concentration", initial_glucose_g_per_l: "concentration", initial_glutamine_mm: "concentration", initial_lactate_g_per_l: "concentration",
  initial_titer_g_per_l: "concentration", carrying_capacity_e6_per_ml: "concentration", glucose_ks_g_per_l: "concentration", glucose_floor_g_per_l: "concentration",
  feed_glucose_g_per_l: "concentration", feed_glutamine_mm: "concentration",
  horizon_days: "duration", production_days: "duration", cohort_interval_d: "duration", inoculation_step_min: "duration", temperature_lag_min: "duration", transport_lo_min: "duration",
  transport_hi_min: "duration", stagger_window_min: "duration", qc_window_length_min: "duration", recalibration_interval_h: "duration", ph_probe_readjust_interval_h: "duration",
  integration_step_s: "duration", sensor_cadence_s: "duration",
  inoculation_start_min: "instant", feed_decision_min: "instant", shift_day: "instant", lactate_switch_day: "instant", staffed_start_min: "instant", staffed_end_weekday_min: "instant",
  staffed_end_weekend_min: "instant", shift_change_min: "instant", burst_center_min: "instant", feed_window_start_min: "instant", feed_window_end_min: "instant",
  stagger_bay_start_min: "instant", edf_deadline_min: "instant", qc_window_start_min: "instant",
  mu_max_per_h: "rate", early_death_per_h: "rate", late_death_per_h: "rate", glucose_uptake_pmol_per_cell_d: "rate", glutamine_uptake_pmol_per_cell_d: "rate",
  lactate_production_pmol_per_cell_d: "rate", productivity_pg_per_cell_d: "rate", ph_probe_drift_per_d: "rate",
  shift_growth_multiplier: "factor", shift_death_multiplier: "factor", shift_productivity_multiplier: "factor",
  ph_noise_sd: "spread", do_noise_sd_pct: "spread", temperature_noise_sd_c: "spread", burst_sd_min: "spread", drift_pct: "spread", bias_pct: "spread", ph_controller_deadband: "spread",
  lactate_switch_on: "switch", ph_probe_readjust_on: "switch",
  glucose_molar_mass_g_per_mol: "constant", lactate_molar_mass_g_per_mol: "constant",
  ph_setpoint: "set_point", do_setpoint_pct: "set_point", temperature_setpoint_c: "set_point", shift_setpoint_c: "set_point",
  lactate_net_rate_pmol_per_cell_d: "signed", lot_step_pct: "signed",
  stagger_bay_offset_min: "offset",
};

const ANY = (): boolean => true; // the value is a finite number already (checkRunSpec)
const RULES: Readonly<Record<Kind, { ok: (v: number) => boolean; says: string }>> = {
  count: { ok: (v) => Number.isInteger(v) && v >= 1, says: "a count, a whole number of at least 1" },
  probability: { ok: (v) => v >= 0 && v <= 1, says: "a probability, from 0 to 1" },
  rerun_probability: { ok: (v) => v >= 0 && v < 1, says: "a probability from 0 inclusive to 1 exclusive" },
  share_pct: { ok: (v) => v >= 0 && v <= 100, says: "a share in percent, from 0 to 100" },
  viability: { ok: (v) => v > 0 && v <= 100, says: "a viability, above 0 and at most 100 percent" },
  concentration: { ok: (v) => v >= 0, says: "a concentration, not below 0" },
  duration: { ok: (v) => v > 0, says: "a duration, above 0" },
  instant: { ok: (v) => v >= 0, says: "an instant, not below 0 (a clock time of the day or a culture day)" },
  rate: { ok: (v) => v >= 0, says: "a rate, not below 0" },
  factor: { ok: (v) => v >= 0, says: "a factor, not below 0" },
  spread: { ok: (v) => v >= 0, says: "a spread, not below 0 (a standard deviation, a size of drift or bias, a deadband)" },
  switch: { ok: (v) => v === 0 || v === 1, says: "a switch, 0 or 1" },
  constant: { ok: (v) => v > 0, says: "a physical constant, above 0" },
  set_point: { ok: ANY, says: "a set point, any finite number" },
  signed: { ok: ANY, says: "a signed quantity, any finite number" },
  offset: { ok: ANY, says: "an offset, any finite number" },
};

/** The cap on the size of one run: a view constant that bounds the Worker's time (as the cap of 16 actions bounds the plant's link), not a domain number, so it has no ledger id. */
export const RUN_SIZE_CAP = 10_000_000;

/**
 * The size of one run: the count of the things the engine keeps a state for (the reactors, the analyzers, and the operators of a weekday and of a weekend shift) times the steps of the
 * finer of the two grids over the horizon. The default scenario: (24 + 2 + 2 + 1) x 21 x 1440 = 876,960.
 */
export const runSize = (v: Readonly<Record<string, number>>): number => {
  const n = (name: string): number => v[name] ?? Number.NaN;
  const things = n("reactor_count") + n("analyzer_count") + n("operators_per_shift") + n("weekend_operators");
  return (things * n("horizon_days") * 86400) / Math.min(n("integration_step_s"), n("sensor_cadence_s"));
};

/** The kind of a setting, or undefined for a name the table does not list. */
export const kindOf = (name: string): Kind | undefined => KINDS[name];

/** The message of a value its kind does not allow, or null. */
export const settingFault = (name: string, value: number): string | null => {
  const kind = KINDS[name];
  return kind && !RULES[kind].ok(value) ? `setting ${name} must be ${RULES[kind].says}; it is ${value}` : null;
};

/** The first rule the settings of a spec break, as the message of `invalid_spec`, or null. `given` are the settings the spec gives (finite numbers, names of the scenario's settings). */
export const checkSettings = (given: Readonly<Record<string, number>>, doc: ScenarioDoc): string | null => {
  for (const [name, value] of Object.entries(given)) {
    const fault = settingFault(name, value);
    if (fault !== null) return fault;
  }
  const settings = Object.fromEntries(Object.entries(doc.settings).map(([name, s]) => [name, { ...s, value: given[name] ?? s.value }]));
  const grid = gridFault(settings) ?? scheduleFault(settings);
  if (grid !== null) return grid;
  const size = runSize(Object.fromEntries(Object.entries(settings).map(([name, s]) => [name, s.value])));
  if (size > RUN_SIZE_CAP) return `the run is too large for the page: its size, (reactors + analyzers + operators of a weekday and a weekend shift) x horizon / the finer of the integration step and the sensor cadence, is ${Math.round(size)}, above the cap of ${RUN_SIZE_CAP} (a bound of the Worker's time, not a domain number)`;
  return null;
};
