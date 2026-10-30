import { wholeSeconds } from "../clock.ts";
import type { Profile } from "../generated/profile.schema";
import { param } from "../profiles.ts";
import type { Params } from "../profiles.ts";

// Break-out event-type profile (spec 11.4, 11.8.2; data under scenarios/profiles/breakout/): what an event type looks like in the process data (the lag, the ramp, which signals move and
// by how much) and which confirming tests it has (turnaround and volume). It is an ordinary profile of kind `breakout`: loadProfile (profiles.ts) has checked the kind, the file against
// schemas/profile.schema.json and that every number is {value, unit, ref}. This reader checks only what a schema cannot say: that the break-out fields are present, that the names they
// use resolve (a param or a scenario input), that the alarm signal is one of the signals and moves, and that the units are the ones the engine expects. It reads by name and unit, never by profile id. A volume the ledger gives no number for is declared under `scenario_inputs` and comes from the scenario (spec 11.8.3).

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
}

export interface TypeProfile {
  profile_id: string;
  contamination_type: string;
  /** The signal whose true value reaching its alarm limit is the first signal (`signal_at`). */
  alarm_signal: Signal;
  /** Default time from the onset to the first signal, and default length of the ramp that ends at it (A139, A141). */
  lag_s: number;
  ramp_s: number;
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
  const tests = (doc.tests ?? []).map((t): TestSpec => {
    for (const name of [t.volume, ...(t.portions ? [t.portions] : [])]) {
      if (!(name in params) && !(name in inputs)) throw new Error(`breakout profile ${id}: test ${t.test} names ${name}, which is neither a param nor a scenario input`);
    }
    return { test: t.test, turnaround_s: wholeSeconds(param(params, t.turnaround, "d") * DAY), volume: t.volume, portions: t.portions ? param(params, t.portions, "media") : 1 };
  });
  if (tests.length === 0) throw new Error(`breakout profile ${id}: at least one confirming test is needed`);
  return {
    profile_id: id, contamination_type: doc.contamination_type, alarm_signal: alarm.signal, signals, tests, inputs, params,
    lag_s: wholeSeconds(param(params, "onset_to_signal_lag_h", "h") * HOUR), ramp_s: wholeSeconds(param(params, "signal_ramp_h", "h") * HOUR),
  };
};
