import { reactorMetrics } from "../../evaluate/closed_loop.ts";
import type { ReactorMetrics } from "../../evaluate/closed_loop.ts";
import { entityKey } from "../../rng.ts";
import type { Rng } from "../../rng.ts";
import { simulatePhLoop } from "../../sensors.ts";
import { applyStability } from "../../stability.ts";
import { decideReadjust } from "../arms/closed_loop.ts";
import type { ArmOptions } from "../arms/closed_loop.ts";
import { oracleReference } from "../oracle/closed_loop.ts";
import type { TruthValue } from "../oracle/closed_loop.ts";
import type { ResultRow } from "../../record/types.ts";
import type { Shared } from "./closed_loop_shared.ts";

// 2026-10-30 S2c3, experiment 2 (spec 6.2): one arm over all reactors of a seed. The loop of a reactor is run at the sensor cadence; at each readjustment slot the arm decides
// whether to readjust the probe and onto what, from what it holds at that instant. The oracle holds the true pH at the draw of the newest sample with a result; A, B and C
// hold the rows of their recorded structure with the pH values of this arm's world. A sample is valued when its first result exists: the pH of the culture at the draw is
// already known then (the loop has run past it), so no decision ever reads a value from the future.

export interface ArmSpec {
  id: string;
  kind: "oracle" | "architecture" | "sensitivity";
  /** The architecture whose recorded structure the arm reads (not for the oracle). */
  structure?: string;
  /** The modelled variant of C (a sensitivity, reported only). */
  bias_handling?: "exclude" | "model";
}

/**
 * Where every readjustment slot of the arm went (slots with no new value are counted too, so nothing drops out of the denominator), and how many offline pH values the arm
 * held: `extrapolated` of them had a hold beyond the range the source of their stability effect covers (A046, spec section 8 rule 7). The oracle holds none.
 */
export interface ArmCounts {
  slots: number;
  readjusted: number;
  skipped_known_bias: number;
  no_new_result: number;
  values: number;
  extrapolated: number;
}

export interface ArmOutcome {
  id: string;
  kind: ArmSpec["kind"];
  reactors: ReactorMetrics[];
  counts: ArmCounts;
}

export const runArm = (sh: Shared, spec: ArmSpec, rng: Rng): ArmOutcome => {
  const structure = spec.structure === undefined ? undefined : sh.structure[spec.structure];
  if (spec.kind !== "oracle" && !structure) throw new Error(`closed loop: arm ${spec.id} reads no recorded structure`);
  const opts: ArmOptions = { hold_limit_s: sh.hold_limit_s, bias_handling: spec.bias_handling ?? "exclude", open_offset: sh.open_offset };
  const counts: ArmCounts = { slots: 0, readjusted: 0, skipped_known_bias: 0, no_new_result: 0, values: 0, extrapolated: 0 };
  const reactors: ReactorMetrics[] = [];

  for (const r of sh.reactors) {
    // the direction of the probe drift: one keyed draw per reactor, the same in every arm (A094; a simulator choice, grade A)
    const sign = rng.stream(entityKey(sh.seed, r.unit_id, "probe_drift")).float() < 0.5 ? -1 : 1;
    let since = -1;
    let next = 0;
    const values = new Map<string, number>();
    const truths: TruthValue[] = [];
    const rows: ResultRow[] = [];

    const series = simulatePhLoop({ setpoint: sh.setpoint, cfg: sh.cfg }, r.t0_s, r.cadence_s, r.noise, sign, (j, t, past) => {
      counts.slots++;
      for (; next < r.samples.length && (r.samples[next] as (typeof r.samples)[number]).first_t <= t; next++) {
        const s = r.samples[next] as (typeof r.samples)[number];
        const tick = Math.floor((s.drawn_s - r.t0_s) / r.cadence_s);
        if (tick >= j) throw new Error(`closed loop: sample ${s.sample_id} is drawn at tick ${tick}, not before the slot at tick ${j}`);
        const truePh = past.truth[tick] as number;
        truths.push({ sample_id: s.sample_id, result_t: s.first_t, true_ph: truePh });
        // the offline value in this arm's world: the culture's true pH at the draw, moved by the hold in the container (A041 to A043), read with the analyzer noise (A078)
        for (const x of s.results) {
          const st = applyStability(sh.effects, "ph", s.container, truePh, x.hold_s);
          values.set(x.run_id, st.value + x.noise);
          if (structure) {
            counts.values++;
            if (st.extrapolated) counts.extrapolated++;
          }
        }
        for (const row of structure?.ph.get(s.sample_id) ?? []) {
          const value = values.get(row.run_id);
          if (value === undefined) throw new Error(`closed loop: the recorded pH row ${row.result_id} names run ${row.run_id}, which has no result in the lab run`);
          rows.push({ ...row, value });
        }
      }
      if (!structure) {
        const ref = oracleReference(truths, t, since);
        if (!ref) {
          counts.no_new_result++;
          return null;
        }
        since = ref.result_t;
        counts.readjusted++;
        return ref.onto;
      }
      const d = decideReadjust({ ...structure.dataset, result: rows }, t, since, opts);
      if (d.action === "none") {
        counts.no_new_result++;
        return null;
      }
      since = d.measured_at;
      if (d.action === "skip") {
        counts.skipped_known_bias++;
        return null;
      }
      counts.readjusted++;
      return d.onto;
    });
    reactors.push(reactorMetrics(series, sh.setpoint));
  }
  return { id: spec.id, kind: spec.kind, reactors, counts };
};
