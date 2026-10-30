import type { Event } from "../generated/event.schema";
import type { ProcessRun } from "../process.ts";
import type { Rng } from "../rng.ts";
import { entityKey } from "../rng.ts";
import type { SamplingConfig, SamplingRun } from "../sampling.ts";
import type { BreakoutConfig } from "./config.ts";
import type { BreakoutPlan } from "./plan.ts";

// The events of the break-out script that the process and the sampling do not emit themselves (spec 11.4, 11.8.2): the records of what each unit consumed and used, the hidden onsets, the
// first signals, the one deviation, and the confirming draws with their results. They are the truth run's, identical for every architecture (11.1 rule 4). The stop is not here: it is a
// moment of the unit in process.ts. The tests report the truth: a result is `detected` exactly when the unit is affected.

const DAY = 86400;

/** The operator of a confirming draw: the same roster and shift rule as a routine draw (sampling.ts), drawn from the stream keyed by the confirming sample (rule S5). */
const operatorOf = (s: SamplingConfig, t: number, draw: { int(from: number, to: number): number }): string => {
  const day = Math.floor(t / DAY);
  const weekend = day % 7 >= 5;
  const shift = weekend || t - day * DAY < s.shiftChange_s ? 0 : 1;
  return `OP-${String(shift * s.opsPerShift + 1 + draw.int(0, (weekend ? s.weekendOps : s.opsPerShift) - 1)).padStart(2, "0")}`;
};

export const breakoutEvents = (b: BreakoutConfig, plan: BreakoutPlan, seed: number, sampling: SamplingConfig, proc: ProcessRun, run: SamplingRun, rng: Rng): Event[] => {
  const out: Event[] = [];
  const batch = (unit_id: string): string => (proc.byUnit.get(unit_id) as { batch_id: string }).batch_id;
  // what a unit consumed and used, while it ran: a stopped or harvested unit consumes and uses nothing more
  for (const r of plan.records) {
    const reactor = proc.byUnit.get(r.unit_id);
    if (!reactor || r.t < reactor.inoculated_s || r.t >= reactor.harvested_s) continue;
    out.push({ type: "process_event", t: r.t, unit_id: r.unit_id, batch_id: reactor.batch_id, kind: r.kind, source: "scripted", ...(r.kind === "medium_addition" ? { lot_id: r.item_id } : { equipment_id: r.item_id }) });
  }
  for (const u of plan.units) {
    out.push({ type: "contamination_onset", t: u.onset_s, unit_id: u.unit_id, batch_id: u.batch_id, contamination_type: b.profile.contamination_type, origin_kind: plan.origin.kind, origin_id: plan.origin.id });
  }
  const limit = (b.profile.signals.find((s) => s.signal === b.profile.alarm_signal) as { change: number }).change < 0 ? "low" : "high";
  for (const u of plan.units) out.push({ type: "signal_observed", t: u.signal_s, unit_id: u.unit_id, batch_id: u.batch_id, signal: b.profile.alarm_signal, limit });
  const first = plan.units.find((u) => u.signal_s === plan.deviation_s) as { unit_id: string; batch_id: string };
  out.push({ type: "deviation_opened", t: plan.deviation_s, deviation_id: "DEV-1", unit_id: first.unit_id, batch_id: first.batch_id, trigger: "signal" });

  // the confirming samples: drawn at the decision instant unless the volume budget refuses them (the cap of the unit, A207, counts the routine draws up to this instant)
  for (const c of plan.confirm) {
    const reactor = proc.byUnit.get(c.unit_id) as { bay: number };
    const cap = (sampling.bays?.[reactor.bay - 1] ?? sampling).capUl;
    const used = run.samples.filter((x) => x.unit_id === c.unit_id && x.state === "drawn" && x.drawn_s <= plan.decision_s).reduce((sum, x) => sum + x.volume_ul, 0);
    if (used + c.volume_ul > cap + 1e-9) {
      out.push({ type: "draw_skipped_volume_budget", t: plan.decision_s, sample_id: c.sample_id, unit_id: c.unit_id, batch_id: batch(c.unit_id), volume_ul: c.volume_ul, cumulative_ul: used });
      continue;
    }
    const operator_id = operatorOf(sampling, plan.decision_s, rng.stream(entityKey(seed, c.sample_id, "confirm")));
    const tests = c.aliquots.map((a) => ({ aliquot_id: a.aliquot_id, test: a.test, volume_ul: a.volume_ul }));
    out.push({ type: "confirm_sample_drawn", t: plan.decision_s, sample_id: c.sample_id, unit_id: c.unit_id, batch_id: c.batch_id, operator_id, volume_ul: c.volume_ul, tests: tests as [(typeof tests)[number], ...typeof tests] });
    for (const a of c.aliquots) out.push({ type: "confirm_result", t: a.result_s, sample_id: c.sample_id, aliquot_id: a.aliquot_id, test: a.test, outcome: c.affected ? "detected" : "not_detected" });
  }
  return out;
};

