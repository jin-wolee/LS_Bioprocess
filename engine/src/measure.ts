import type { MeasureFn, MeasuredResult } from "./analysis.ts";
import type { Profile } from "./generated/profile.schema";
import type { Instruments } from "./instrument.ts";
import type { CultureState } from "./process.ts";
import { param } from "./profiles.ts";
import type { Rng } from "./rng.ts";
import type { SampleRecord } from "./sampling.ts";
import { applyStability } from "./stability.ts";
import type { StabilityEffect } from "./stability.ts";

// What an analyzer run measures and how it ends (spec 2.3): the sample's true values at the draw, moved by the stability effect
// of its hold, read with the analyzer's noise (A077 to A079) and instrument state, checked against the over-range limits at the
// current dilution (A089, A090) and against a run-level QC failure (A088). A reading still above the range at the last dilution ends the visit
// `over_range_unresolved` (spec 2.3; audit A1, F3): there is no higher dilution, and it is never promoted to qc_passed. The L3 core calls this once per run.

export interface AnalyteCfg {
  id: string;
  /** Noise size: a fraction of the true value when noiseRelative (a percent CV in the profile), else an absolute sd; 0 draws nothing. */
  noise: number;
  noiseRelative: boolean;
  /** The instrument factor (bias, drift, lot step) is a percent of the reading (relative analytes only). */
  factor: boolean;
  limit?: number;
}

export interface StageCfg {
  /** The analyzer profile this stage belongs to (spec 4.5): the plan of a mixed fleet holds stages of several profiles. */
  profile: string;
  group: string;
  analytes: AnalyteCfg[];
  service_s: number;
  transfer_s?: number;
  method_id?: string;
  storage: "ice" | "room_temperature" | "frozen";
  /** Dilution factors in the order they are tried; empty means no over-range check. */
  ladder: number[];
}

const FIELDS: Record<string, keyof CultureState> = { vcd: "vcd", viability: "viability", glucose: "glucose", lactate: "lactate", glutamine: "glutamine", titer: "titer", ph: "ph" };

export const valueOf = (state: CultureState, analyte: string): number => {
  const field = FIELDS[analyte];
  if (!field) throw new Error(`unknown analyte ${analyte}: the culture state has no such value`);
  return state[field];
};

export const routeConfig = (analyzer: Profile): StageCfg[] =>
  (analyzer.route ?? []).map((st) => {
    const params = analyzer.params;
    return {
      profile: analyzer.profile_id,
      group: st.group,
      service_s: param(params, st.service, "s"),
      ...(st.transfer !== undefined && { transfer_s: param(params, st.transfer, "s") }),
      ...(st.method_id !== undefined && { method_id: st.method_id }),
      storage: st.storage,
      ladder: (st.dilution_factors ?? []).map((n) => param(params, n, "factor")),
      analytes: st.analytes.map((a) => {
        const noise = a.noise !== undefined ? (params[a.noise] as { value: number; unit: string }) : undefined;
        valueOf({ vcd: 0, viability: 0, glucose: 0, glutamine: 0, lactate: 0, titer: 0, ph: 0 }, a.id); // an unknown analyte is rejected here, not guessed
        return {
          id: a.id,
          noiseRelative: noise?.unit === "%",
          noise: noise ? (noise.unit === "%" ? noise.value / 100 : noise.value) : 0,
          factor: a.relative === true,
          ...(a.limit !== undefined && { limit: (params[a.limit] as { value: number }).value }),
        };
      }),
    };
  });

export interface MeasureDeps {
  seed: number;
  rng: Rng;
  instruments: Instruments;
  samples: ReadonlyMap<string, SampleRecord>;
  route: readonly StageCfg[];
  effects: readonly StabilityEffect[];
  containers: Readonly<Record<string, "open" | "closed">>;
  /** The containers of the bay profile of a unit (spec 4.5.2); a unit not in the map takes `containers`. */
  containersByUnit?: ReadonlyMap<string, Readonly<Record<string, "open" | "closed">>>;
  /** Probability that a run in range fails QC and is repeated (A088). */
  rerunP: number;
}

export const makeMeasure = (d: MeasureDeps): MeasureFn => {
  const rung = new Map<string, number>(); // dilution rung reached by request and visit; a run is never concurrent with its own rerun
  return (ctx) => {
    const stage = d.route[ctx.visit - 1] as StageCfg;
    const id = ctx.request.request_id;
    const sample = d.samples.get(id);
    if (!sample?.true_state) throw new Error(`request ${id} has no drawn sample`);
    const hold = ctx.start_s - sample.drawn_s;
    const containers = d.containersByUnit?.get(sample.unit_id) ?? d.containers;
    const instrument = d.instruments.factorAt(ctx.analyzer, ctx.start_s).factor_pct;
    const rk = `${id}#${ctx.visit}`;
    const at = rung.get(rk) ?? 0;
    const factor = stage.ladder[at] ?? 1;
    let over = false;
    const results = stage.analytes.map((a): MeasuredResult => {
      const st = applyStability(d.effects, a.id, containers[a.id] ?? containers.default ?? "open", valueOf(sample.true_state as CultureState, a.id), hold);
      const z = a.noise > 0 ? d.rng.stream([d.seed, id, a.id, ctx.attempt, "noise"]).gaussian() : 0;
      const noise = (a.noiseRelative ? st.value * a.noise : a.noise) * z;
      const value = (a.factor ? st.value * (1 + instrument / 100) : st.value) + noise;
      if (a.limit !== undefined && value > a.limit * factor) over = true;
      return { analyte: a.id, value, true_value: st.value, noise, ...(st.kind && { stability_kind: st.kind, stability_delta: st.delta as number, ...(st.extrapolated && { extrapolated: true }) }) };
    });
    if (over && at + 1 < stage.ladder.length) {
      rung.set(rk, at + 1);
      return { results, outcome: "over_range", next_dilution_factor: stage.ladder[at + 1] as number };
    }
    if (over && stage.ladder.length > 0) return { results, outcome: "over_range_unresolved" };
    const failed = d.rng.stream([d.seed, id, (stage.analytes[0] as AnalyteCfg).id, ctx.attempt, "qc_failed"]).float() < d.rerunP;
    return failed ? { results, outcome: "qc_failed" } : { results };
  };
};
