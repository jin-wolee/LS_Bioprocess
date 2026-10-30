import type { Scenario } from "./generated/scenario.schema";
import { wholeSeconds } from "./clock.ts";
import type { Param } from "./generated/profile.schema";
import { checkParams } from "./profiles.ts";
import { exp } from "./xmath.ts";

// Stability effects between sampled_at and run_started_at (spec 2.2): a held sample drifts while it waits. An effect is data in the
// scenario (kind, analyte, container, parameters with refs); the engine applies the kind and reads no analyte or profile name.
//   linear_rate:        value += rate * hold_hours            (viability slope A040, closed-sample pH drift A043)
//   first_order_offset: value += offset * (1 - exp(-hold/tau)) (open-sample pH offset and relaxation, A041, A042)
// An effect whose source covers holds only up to valid_to carries extrapolated: true when the hold is longer (A039, A046).
// The result carries stability fields only when the effect moved the value.

export interface StabilityEffect {
  effect: "linear_rate" | "first_order_offset";
  analyte: string;
  container: "open" | "closed";
  rate_per_h?: number;
  offset?: number;
  tau_s?: number;
  /** Longest hold the source covers, in seconds; absent when the ledger gives no range. */
  validTo_s?: number;
}

export interface Stabilised {
  value: number;
  kind?: StabilityEffect["effect"];
  delta?: number;
  extrapolated?: true;
}

type Raw = NonNullable<Scenario["stability"]>[number];

const valueIn = (p: Param | undefined, unit: string, what: string): number => {
  if (!p) throw new Error(`${what} is missing`);
  if (p.unit !== unit) throw new Error(`${what} has unit ${p.unit}, the engine expects ${unit}`);
  return p.value;
};

export const stabilityConfig = (list: Scenario["stability"] | undefined): StabilityEffect[] =>
  (list ?? []).map((e: Raw) => {
    const where = `stability ${e.effect} for ${e.analyte}`;
    checkParams(Object.fromEntries(Object.entries({ rate: e.rate, valid_to: e.valid_to, offset: e.offset, tau: e.tau }).filter(([, p]) => p !== undefined)), where);
    const out: StabilityEffect = { effect: e.effect, analyte: e.analyte, container: e.container };
    if (e.valid_to) out.validTo_s = wholeSeconds(valueIn(e.valid_to, "min", `${where}: valid_to`) * 60);
    if (e.effect === "linear_rate") {
      if (!e.rate?.unit.endsWith("/h")) throw new Error(`${where}: a rate per hour is needed`);
      out.rate_per_h = e.rate.value;
    } else {
      if (!e.offset) throw new Error(`${where}: offset is missing`);
      out.offset = e.offset.value;
      out.tau_s = wholeSeconds(valueIn(e.tau, "h", `${where}: tau`) * 3600);
    }
    return out;
  });

export const applyStability = (effects: readonly StabilityEffect[], analyte: string, container: "open" | "closed", value: number, hold_s: number): Stabilised => {
  const e = effects.find((x) => x.analyte === analyte && x.container === container);
  if (!e) return { value };
  const delta = e.effect === "linear_rate" ? (e.rate_per_h as number) * (hold_s / 3600) : (e.offset as number) * (1 - exp(-hold_s / (e.tau_s as number)));
  if (delta === 0) return { value };
  const out: Stabilised = { value: value + delta, kind: e.effect, delta };
  if (e.validTo_s !== undefined && hold_s > e.validTo_s) out.extrapolated = true;
  return out;
};
