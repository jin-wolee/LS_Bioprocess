import { wholeSeconds } from "../clock.ts";
import type { Profile } from "../generated/profile.schema";
import { param } from "../profiles.ts";
import type { Params } from "../profiles.ts";

// Break-out event-type profile (spec 11.4, 11.8.2; data under data/scenarios/profiles/breakout/): what an event type looks like in the process data (the lag, the ramp, which signals move and
// by how much) and which confirming tests it has (turnaround and volume). It is an ordinary profile of kind `breakout`: loadProfile (profiles.ts) has checked the kind, the file against
// data/schemas/profile.schema.json and that every number is {value, unit, ref}. This reader checks only what a schema cannot say: that the break-out fields are present, that the names they
// use resolve (a param or a scenario input), that the alarm signal is one of the signals and moves, and that the units are the ones the engine expects. It reads by name and unit, never by profile id. A volume the ledger gives no number for is declared under `scenario_inputs` and comes from the scenario (spec 11.8.3), and so is a ramp with no default (`ramp_input`), the delays and multipliers of the host effects (rule S13) and the flag that says whether a test covers the organism (A146, A224).

const DAY = 86400;
const HOUR = 3600;

export type Signal = "DO" | "pH";
/** The unit in which the change of each signal is stated: the engine expects exactly this (A197 for DO, A141 for pH). */
const CHANGE_UNIT: Record<Signal, string> = { DO: "% air saturation", pH: "pH" };

export interface TestSpec {
  test: string;
  turnaround_s: number;
  /** The name of the quantity (a parameter of the profile or a scenario input) that is the volume of one portion, in millilitres. */
  volume: string;
  /** How many portions of that volume the test takes (sterility: two media); 1 when the profile names none. */
  portions: number;
  /** The name of the scenario input (unit flag) that says whether the target of the test covers the organism; absent: the test reports the truth (A146). */
  covered_by?: string;
}

/** A scripted change of the growth and death multipliers of an affected unit, from its onset plus the delay (rule S13). Every name is a scenario input. */
export interface HostEffect {
  delay: string;
  growth?: string;
  death?: string;
}

export interface TypeProfile {
  profile_id: string;
  contamination_type: string;
  /** The signal whose true value reaching its alarm limit is the first signal (`signal_at`). */
  alarm_signal: Signal;
  /** Default time from the onset to the first signal, and default length of the ramp that ends at it (A139, A141). A profile with no default ramp names the scenario input that holds it (A219). */
  lag_s: number;
  ramp_s?: number;
  ramp_input?: string;
  effects: HostEffect[];
  /** The change of each signal from its set point at the first signal; the process value follows a linear ramp to it. */
  signals: { signal: Signal; change: number }[];
  tests: TestSpec[];
  /** Scenario inputs the profile needs and gives no default: name, expected unit and ledger id. */
  inputs: Record<string, { unit: string; ref: string }>;
  params: Params;
}

export const loadTypeProfile = (doc: Profile): TypeProfile => {
  const id = doc.profile_id;
  if (doc.contamination_type === undefined) throw new Error(`breakout profile ${id}: contamination_type missing`);
  const params = doc.params;
  const signals = (doc.signals ?? []).map((s) => ({ signal: s.signal, change: param(params, s.change, CHANGE_UNIT[s.signal]) }));
  const alarm = signals.find((s) => s.signal === doc.alarm_signal);
  if (!alarm) throw new Error(`breakout profile ${id}: alarm_signal must be one of its signals`);
  if (alarm.change === 0) throw new Error(`breakout profile ${id}: the change of the alarm signal must not be zero (the sign says low or high alarm)`);
  const inputs = doc.scenario_inputs ?? {};
  /** A scenario input the profile names must be declared, in the unit the engine reads it in. */
  const inputIn = (name: string, unit: string, what: string): void => {
    const declared = inputs[name];
    if (!declared) throw new Error(`breakout profile ${id}: ${what} names ${name}, which is not a scenario input`);
    if (declared.unit !== unit) throw new Error(`breakout profile ${id}: ${what} names ${name}, declared in ${declared.unit}, the engine expects ${unit}`);
  };
  const tests = (doc.tests ?? []).map((t): TestSpec => {
    for (const name of [t.volume, ...(t.portions ? [t.portions] : [])]) {
      if (!(name in params) && !(name in inputs)) throw new Error(`breakout profile ${id}: test ${t.test} names ${name}, which is neither a param nor a scenario input`);
    }
    if (t.covered_by !== undefined) inputIn(t.covered_by, "flag", `test ${t.test}`);
    return { test: t.test, turnaround_s: wholeSeconds(param(params, t.turnaround, "d") * DAY), volume: t.volume, portions: t.portions ? param(params, t.portions, "media") : 1, ...(t.covered_by !== undefined && { covered_by: t.covered_by }) };
  });
  if (tests.length === 0) throw new Error(`breakout profile ${id}: at least one confirming test is needed`);
  // the ramp has a default (the param) or comes from a scenario input, never both
  if (doc.ramp_input !== undefined) {
    if ("signal_ramp_h" in params) throw new Error(`breakout profile ${id}: gives a default ramp (signal_ramp_h) and a ramp_input; a ramp has one source`);
    inputIn(doc.ramp_input, "h", "ramp_input");
  }
  const effects = (doc.host_effects ?? []).map((e): HostEffect => {
    inputIn(e.delay, "d", "a host effect");
    for (const name of [e.growth, e.death]) if (name !== undefined) inputIn(name, "factor", "a host effect");
    return { delay: e.delay, ...(e.growth !== undefined && { growth: e.growth }), ...(e.death !== undefined && { death: e.death }) };
  });
  return {
    profile_id: id, contamination_type: doc.contamination_type, alarm_signal: alarm.signal, signals, tests, inputs, params, effects,
    lag_s: wholeSeconds(param(params, "onset_to_signal_lag_h", "h") * HOUR),
    ...(doc.ramp_input === undefined ? { ramp_s: wholeSeconds(param(params, "signal_ramp_h", "h") * HOUR) } : { ramp_input: doc.ramp_input }),
  };
};
