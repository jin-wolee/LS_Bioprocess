import { wholeSeconds } from "../clock.ts";
import type { Param } from "../generated/profile.schema";
import type { Scenario } from "../generated/scenario.schema";
import { checkParams, loadProfile } from "../profiles.ts";
import type { ProfileLookup } from "../profiles.ts";
import { loadTypeProfile } from "./profile.ts";
import type { TestSpec, TypeProfile } from "./profile.ts";

// The `breakout` block of a scenario (spec 11.4, 11.8.2; schemas/scenario.schema.json), read into seconds and checked for everything that does not need the process: the inputs that have no
// default (A176, A177 and the ones the event-type profile names), the ramp inside the lag, and the names the topology uses. What needs the units (their inoculation, their end) is checked
// by plan.ts. Every refusal names the input at fault and, where it has one, its ledger id.

const HOUR = 3600;
const DAY = 86400;

export type Origin =
  | { kind: "seed_lot"; lot_id: string; contaminated_s: number }
  | { kind: "medium_lot"; lot_id: string; contaminated_s: number }
  | { kind: "shared_equipment"; equipment_id: string; contaminated_s: number }
  | { kind: "unit_equipment"; unit_id: string; at_s: number }
  | { kind: "sampling"; sample_id: string };

export interface Lot { lot_id: string; kind: "seed" | "medium"; prepared_s: number }
export interface Equipment { equipment_id: string; name: string }
/** A seed lot has no `at_s`: it is consumed at the inoculation of its unit. */
export interface Consumption { unit_id: string; lot_id: string; at_s?: number }
export interface Use { unit_id: string; equipment_id: string; at_s: number }
/**
 * One confirming test of the event type with its volume in millilitres (all portions) resolved from the profile or from the scenario input. `covers` is false only for a test whose target the
 * scenario says does not cover the organism (A146, A224): it then reports not_detected for an affected unit.
 */
export interface ConfirmTest { test: string; turnaround_s: number; volume_ml: number; covers: boolean }
/** A scripted change of the growth and death multipliers of an affected unit at its onset plus the delay (rule S13). A factor not named stays as it was. */
export interface Effect { delay_s: number; mu?: number; kd?: number }

export interface BreakoutConfig {
  profile: TypeProfile;
  lag_s: number;
  ramp_s: number;
  origin: Origin;
  lots: Lot[];
  equipment: Equipment[];
  consumption: Consumption[];
  use: Use[];
  /** A176: from the first signal to the scripted response, and from a positive result to the hold. */
  signal_to_response_s: number;
  positive_to_hold_s: number;
  confirm: string[];
  tests: ConfirmTest[];
  effects: Effect[];
  /** The scenario inputs as given, printed with every result. */
  inputs: Record<string, Param>;
}

/** Seconds as the hours the scenario states them in, for messages: 12, 5.01. */
export const hoursText = (s: number): string => String(s / HOUR);

type Block = NonNullable<Scenario["breakout"]>;

const needs = (scenario: string, input: string, ref: string, what: string): Error =>
  new Error(`scenario ${scenario}: breakout needs the input ${input} (${ref}, ${what}); it has no default and the scenario must give it`);

/** `lookup` is the lookup every profile goes through: the event-type profile is an ordinary profile of kind `breakout`. */
export const loadBreakout = (b: Block, scenario: string, lookup: ProfileLookup): BreakoutConfig => {
  const fail = (m: string): never => {
    throw new Error(`scenario ${scenario}: ${m}`);
  };
  let profile;
  try {
    profile = loadTypeProfile(loadProfile(lookup("breakout", b.profile), "breakout"));
  } catch (e) {
    return fail(`breakout profile ${b.profile} could not be loaded (${(e as Error).message})`);
  }

  // inputs without a default, in the order the spec lists them: A176, A177, then the ones the profile names
  const response = b.response as Block["response"] | undefined;
  if (response === undefined) throw needs(scenario, "response", "A176", "the two delays of the scripted response");
  if (response.signal_to_response === undefined) throw needs(scenario, "response.signal_to_response", "A176", "the delay from the first signal to the scripted response");
  if (response.positive_to_hold === undefined) throw needs(scenario, "response.positive_to_hold", "A176", "the delay from a positive result to the hold");
  const topology = b.topology as Block["topology"] | undefined;
  if (topology === undefined) throw needs(scenario, "topology", "A177", "which units consume which lot or use which equipment item, and when");
  const given = b.inputs ?? {};
  checkParams(given, `scenario ${scenario}: breakout inputs`);
  for (const name of Object.keys(given)) if (!(name in profile.inputs)) fail(`breakout inputs.${name} is not an input of the profile ${profile.profile_id}`);
  for (const [name, spec] of Object.entries(profile.inputs)) if (!(name in given)) throw needs(scenario, `inputs.${name}`, spec.ref, `an input of the profile ${profile.profile_id}, in ${spec.unit}`);

  const quantity = (p: Param, unit: string, where: string): number => {
    checkParams({ [where]: p }, `scenario ${scenario}: breakout`);
    if (p.unit !== unit) fail(`breakout ${where} has unit ${p.unit}, the engine expects ${unit}`);
    return p.value;
  };
  const hours = (p: Param, where: string): number => wholeSeconds(quantity(p, "h", where) * HOUR);
  const delay = (p: Param, where: string): number => {
    const s = hours(p, where);
    return s >= 0 ? s : fail(`breakout ${where} must not be negative (A176)`);
  };

  /** The ledger id of a scenario input the profile declares. */
  const refOf = (name: string): string => (profile.inputs[name] as { ref: string }).ref;
  /** The value of a scenario input, in the unit the profile declares for it. */
  const input = (name: string): number => quantity(given[name] as Param, (profile.inputs[name] as { unit: string }).unit, `inputs.${name}`);
  const nonNegative = (name: string): number => {
    const v = input(name);
    return v >= 0 ? v : fail(`breakout inputs.${name} must not be negative (${refOf(name)})`);
  };
  // the logical bounds of a host effect (rule S13; the ledger's A221 and A223), by the role the profile gives the input and never by its id: a plateau never speeds growth, a fall of viability
  // never slows death. The plausible ranges of the delays (A220, A222) are a source's spread, not bounds: they are printed as assumed inputs and not refused.
  const growthFactor = (name: string): number => {
    const v = nonNegative(name);
    return v <= 1 ? v : fail(`breakout inputs.${name} ${v} is above 1: a growth plateau never speeds growth, so the factor lies in 0 to 1 (${refOf(name)})`);
  };
  const deathFactor = (name: string): number => {
    const v = nonNegative(name);
    return v >= 1 ? v : fail(`breakout inputs.${name} ${v} is below 1: a fall of viability never slows death, so the factor is at least 1 (${refOf(name)})`);
  };

  // the lag runs from the onset to the first signal and the ramp ends there, inside it (ruling D4). The ramp is the profile's default, which the block may override, or the scenario input the
  // profile names when it has no default (A219); a block that gives `ramp` to such a profile would say one thing two ways, and is refused.
  const lagRef = profile.params.onset_to_signal_lag_h?.ref ?? "A139";
  const lag_s = b.lag === undefined ? profile.lag_s : hours(b.lag, "lag");
  let ramp_s: number;
  let rampRef: string;
  if (profile.ramp_input !== undefined) {
    if (b.ramp !== undefined) fail(`breakout ramp is not accepted for the profile ${profile.profile_id}: it takes its ramp from inputs.${profile.ramp_input} (${refOf(profile.ramp_input)})`);
    ramp_s = hours(given[profile.ramp_input] as Param, `inputs.${profile.ramp_input}`);
    rampRef = refOf(profile.ramp_input);
  } else {
    ramp_s = b.ramp === undefined ? (profile.ramp_s as number) : hours(b.ramp, "ramp");
    rampRef = profile.params.signal_ramp_h?.ref ?? "A141";
  }
  if (lag_s <= 0) fail(`breakout lag ${hoursText(lag_s)} h must be above 0 (${lagRef})`);
  if (ramp_s <= 0) fail(`breakout ramp ${hoursText(ramp_s)} h must be above 0 (${rampRef})`);
  if (ramp_s > lag_s) fail(`breakout ramp ${hoursText(ramp_s)} h is longer than the lag ${hoursText(lag_s)} h: the ramp ends at the first signal, inside the lag (${lagRef}, ${rampRef})`);

  const lots: Lot[] = (topology.lots ?? []).map((l) => ({ lot_id: l.lot_id, kind: l.kind, prepared_s: hours(l.prepared_at, `topology.lots ${l.lot_id} prepared_at`) }));
  const equipment: Equipment[] = (topology.equipment ?? []).map((e) => ({ equipment_id: e.equipment_id, name: e.name }));
  for (const [what, ids] of [["lot", lots.map((l) => l.lot_id)], ["equipment item", equipment.map((e) => e.equipment_id)]] as const) {
    const dup = ids.find((id, i) => ids.indexOf(id) !== i);
    if (dup !== undefined) fail(`breakout topology declares the ${what} ${dup} twice`);
  }
  const lotOf = (id: string, where: string): Lot => lots.find((l) => l.lot_id === id) ?? fail(`breakout ${where} names the lot ${id}, which is not declared in topology.lots (A177)`);
  const itemOf = (id: string, where: string): Equipment => equipment.find((e) => e.equipment_id === id) ?? fail(`breakout ${where} names the equipment item ${id}, which is not declared in topology.equipment (A177)`);

  const seededBy = new Map<string, string>();
  const consumption: Consumption[] = (topology.consumption ?? []).map((c) => {
    const lot = lotOf(c.lot_id, "topology.consumption");
    if (lot.kind === "seed") {
      if (c.at !== undefined) fail(`breakout topology.consumption gives the seed lot ${c.lot_id} an at for ${c.unit_id}: a seed lot is consumed at the inoculation of its unit, so it takes no at`);
      const other = seededBy.get(c.unit_id);
      if (other !== undefined && other !== c.lot_id) fail(`breakout topology.consumption seeds ${c.unit_id} from two lots, ${other} and ${c.lot_id}; a batch has at most one seed lot (K17)`);
      seededBy.set(c.unit_id, c.lot_id);
      return { unit_id: c.unit_id, lot_id: c.lot_id };
    }
    if (c.at === undefined) fail(`breakout topology.consumption of ${c.lot_id} by ${c.unit_id} has no at: a medium lot needs an at, the instant of its consumption (A177)`);
    return { unit_id: c.unit_id, lot_id: c.lot_id, at_s: hours(c.at as Param, `topology.consumption ${c.unit_id} ${c.lot_id} at`) };
  });
  const use: Use[] = (topology.use ?? []).map((u) => {
    itemOf(u.equipment_id, "topology.use");
    return { unit_id: u.unit_id, equipment_id: u.equipment_id, at_s: hours(u.at, `topology.use ${u.unit_id} ${u.equipment_id} at`) };
  });

  const o = b.origin;
  let origin: Origin;
  if (o.kind === "sampling") origin = { kind: "sampling", sample_id: o.sample_id };
  else if (o.kind === "unit_equipment") origin = { kind: "unit_equipment", unit_id: o.unit_id, at_s: hours(o.at, "origin at") };
  else if (o.kind === "shared_equipment") {
    itemOf(o.equipment_id, "origin");
    origin = { kind: "shared_equipment", equipment_id: o.equipment_id, contaminated_s: hours(o.contaminated_at, "origin contaminated_at") };
  } else {
    const lot = lotOf(o.lot_id, "origin");
    if (lot.kind !== (o.kind === "seed_lot" ? "seed" : "medium")) fail(`breakout origin names ${o.lot_id}, a ${lot.kind} lot, but its kind is ${o.kind}`);
    origin = { kind: o.kind, lot_id: o.lot_id, contaminated_s: hours(o.contaminated_at, "origin contaminated_at") };
  }

  const volumeOf = (name: string): number => {
    const p = profile.params[name];
    if (p) return p.unit === "mL" ? p.value : fail(`breakout profile ${profile.profile_id}: ${name} has unit ${p.unit}, the engine expects mL`);
    const v = quantity(given[name] as Param, "mL", `inputs.${name}`);
    return v > 0 ? v : fail(`breakout inputs.${name} must be above 0 (${refOf(name)})`);
  };
  /** Does the test report an affected unit as detected? Only a test whose coverage is a scenario input can say no (A146, A224). */
  const covers = (t: TestSpec): boolean => {
    if (t.covered_by === undefined) return true;
    const v = input(t.covered_by);
    return v === 0 || v === 1 ? v === 1 : fail(`breakout inputs.${t.covered_by} must be 0 or 1 (${refOf(t.covered_by)})`);
  };
  const tests: ConfirmTest[] = profile.tests.map((t) => ({ test: t.test, turnaround_s: t.turnaround_s, volume_ml: volumeOf(t.volume) * t.portions, covers: covers(t) }));
  const effects: Effect[] = profile.effects.map((e) => ({
    delay_s: wholeSeconds(nonNegative(e.delay) * DAY), ...(e.growth !== undefined && { mu: growthFactor(e.growth) }), ...(e.death !== undefined && { kd: deathFactor(e.death) }),
  }));

  return {
    profile, lag_s, ramp_s, origin, lots, equipment, consumption, use, confirm: [...b.confirm], tests, effects, inputs: given,
    signal_to_response_s: delay(response.signal_to_response, "response.signal_to_response"), positive_to_hold_s: delay(response.positive_to_hold, "response.positive_to_hold"),
  };
};
