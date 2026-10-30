import type { ObservableEvent } from "../../observe.ts";
import { reviewPoint, reviewVersion } from "../review.ts";
import { retroFlag, vr022Unmet } from "../rules_holds.ts";
import { transit } from "../transitions.ts";
import type { Transition } from "../transitions.ts";
import type { DeviationRow, EquipmentRow, MaterialLotRow, QualityHoldRow, RecordedDataset } from "../types.ts";
import { confirmingOf, governing } from "./verdicts.ts";
import type { Confirming } from "./verdicts.ts";
import { walkBack } from "./walkback.ts";
import type { InvestigationConfig, InvestigationEvent, Signal, WalkBack } from "./types.ts";

export type { InvestigationConfig, InvestigationEvent, ItemKind, Reach, Signal, WalkBack, WalkItem } from "./types.ts";

// The investigation of a break-out event: a step after recording on the recorded side (spec 11.8.2 rule S9; break-out batch 4). It reads the recorded dataset of one architecture, the first signals
// as plain data and the decision settings, and returns the dataset with the deviation, the holds, the retro-flag versions and the states that follow, and what happened in time order. A hold
// is a record and never acts on the plant. For each signal, in time order:
//   at signal + d1 the walk-back runs (directions 1 and 3) as of that instant, a hold is placed on every item it returns that is not held already, and VR-022 flags the released results under them;
//   at the first positive result of the confirming sample a hold waits for, plus d2, the hold becomes quarantine and is rejected at the next review point (A215); when every test of that sample
//   is not detected, the hold is released at the last result plus d2 and its versions are released again at the next review point. When every confirming result is in and every hold is ended the
//   deviation is concluded and closed. The walk-back reads the record as recorded; the decisions never read a later row than their own instant.

const sortedBy = <T>(xs: readonly T[], key: (x: T) => number): T[] => xs.map((x, i) => ({ x, i })).sort((a, b) => key(a.x) - key(b.x) || a.i - b.i).map((v) => v.x);

/** The first signals, from the observable events `signal_observed`, in time order. The recorded tables hold no row for a signal, so the assembly hands them over as plain data. */
export const signalsOf = (events: readonly ObservableEvent[]): Signal[] =>
  sortedBy(events.flatMap((e) => (e.type === "signal_observed" ? [{ unit_id: e.unit_id, batch_id: e.batch_id, at: e.t }] : [])), (s) => s.at);

export interface Investigation {
  dataset: RecordedDataset;
  /** One walk-back per signal, in time order, with every item it returned (also those already held). */
  walks: WalkBack[];
  events: InvestigationEvent[];
  /** VR-022 when the architecture lacks a flag it needs: a released result under a hold stays released. */
  not_evaluable: { rule: string; reason: string }[];
}

export const investigate = (ds: RecordedDataset, signals: readonly Signal[], cfg: InvestigationConfig, log?: Transition[]): Investigation => {
  if (ds.deviation === undefined || ds.quality_hold === undefined) throw new Error("investigate: the dataset has no break-out tables (the recorder was not given the master data of the topology)");
  if (ds.quality_hold.length > 0) throw new Error("investigate: the dataset has holds already; an investigation runs once, on the record as recorded");
  const flags = ds.architecture.flags;
  const actor = flags.audit_trail ? "reviewer" : null;
  const confirming = confirmingOf(ds, cfg.conclusion_delay_s);
  const unmet = vr022Unmet(ds);

  let cur: RecordedDataset = ds;
  const holds: QualityHoldRow[] = [];
  const waits = new Map<string, Confirming | null>();
  const events: InvestigationEvent[] = [];
  const walks: WalkBack[] = [];
  const lots: MaterialLotRow[] = (ds.material_lot ?? []).map((l) => ({ ...l }));
  const equipment: EquipmentRow[] = (ds.equipment ?? []).map((e) => ({ ...e }));
  const devs: DeviationRow[] = ds.deviation.map((d) => ({ ...d }));
  const touched = new Set<string>();
  // what happens to the state of a lot or an equipment item, replayed in time order once every hold is decided (a later signal can hold an item again after an earlier hold on it was released)
  const steps: { t: number; hold: QualityHoldRow; step: "place" | "quarantine" | "release" }[] = [];
  const before = new Map<string, string>(); // a lot or an item: its state before the hold

  /** Is the item still held at the instant? A hold is in force until its confirming sample releases it; a quarantine is final in S3 (no source for a return), so a positive verdict never ends it. */
  const inForce = (h: QualityHoldRow, t: number): boolean => {
    const v = waits.get(h.hold_id)?.verdict;
    return !v || v.kind === "positive" || Math.max(v.at, h.placed_at) > t;
  };

  for (const signal of sortedBy(signals, (s) => s.at)) {
    const decision = signal.at + cfg.decision_delay_s;
    const walk = walkBack(ds, signal, decision, cfg.assumed_lag_s);
    walks.push(walk);
    const dev = devs.filter((d) => d.opened_at <= signal.at).at(-1);
    if (dev === undefined) throw new Error(`investigate: no deviation is open at the signal of ${signal.unit_id} at ${signal.at} s`);
    if (!touched.has(dev.deviation_id)) {
      touched.add(dev.deviation_id);
      dev.estimated_onset = walk.estimated_onset;
      dev.assumed_lag = cfg.assumed_lag_s;
    }
    for (const it of walk.items) {
      if (holds.some((h) => h.target_kind === it.kind && h.target_id === it.id && inForce(h, decision))) continue; // an item already held is not held twice
      const h: QualityHoldRow = {
        hold_id: `H${holds.length + 1}`, deviation_id: dev.deviation_id, target_kind: it.kind, target_id: it.id, kind: "hold", state: transit("quality_hold", "placed", "under_test", "rule", log) as "under_test",
        placed_at: decision, placed_by: actor, reason: actor === null ? null : `direction ${it.direction}: ${it.path}`, released_at: null, released_by: null, outcome: null, available_at: flags.available_at ? decision : null,
      };
      holds.push(h);
      waits.set(h.hold_id, governing(confirming, it.batch, signal));
      events.push({ type: "hold_placed", t: decision, hold_id: h.hold_id });
      steps.push({ t: decision, hold: h, step: "place" });
    }
    if (dev.state === "opened") dev.state = transit("deviation", "opened", "contained", "rule", log) as "contained";
    if (unmet === null) {
      const out = retroFlag({ ...cur, quality_hold: holds }, decision, log);
      cur = out.dataset;
      for (const v of out.flagged) events.push({ type: "result_reflagged", t: decision, result_id: v.result_id, hold_id: v.hold_id as string });
    }
  }

  // the verdicts of the confirming samples: each hold is decided at its own instant
  let result = cur.result;
  let validation_finding = cur.validation_finding;
  const strict = flags.available_at;
  const settleVersion = (hold: QualityHoldRow, outcome: "released" | "rejected", at: number): void => {
    result = result.map((r) => (r.hold_id === hold.hold_id ? reviewVersion(r, outcome, at, strict, log) : r));
    const flagged = new Set(result.filter((r) => r.hold_id === hold.hold_id).map((r) => `result:${r.supersedes}`));
    validation_finding = validation_finding.map((f) => (f.rule === "VR-022" && flagged.has(f.target) ? { ...f, status: "resolved" as const } : f));
  };
  for (const h of holds) {
    const v = waits.get(h.hold_id)?.verdict;
    if (!v) continue;
    const at = Math.max(v.at, h.placed_at);
    if (v.kind === "positive") {
      h.kind = "quarantine";
      h.state = transit("quality_hold", "under_test", "quarantined", "rule", log) as "quarantined";
      events.push({ type: "hold_quarantined", t: at, hold_id: h.hold_id });
      steps.push({ t: at, hold: h, step: "quarantine" });
      const point = reviewPoint(at, cfg.review.roster, cfg.review.timing);
      h.state = transit("quality_hold", "quarantined", "rejected", "reviewer", log) as "rejected";
      [h.outcome, h.released_at, h.released_by] = ["rejected", point, actor];
      events.push({ type: "hold_rejected", t: point, hold_id: h.hold_id });
      settleVersion(h, "rejected", point);
    } else {
      h.state = transit("quality_hold", "under_test", "released", "reviewer", log) as "released";
      [h.outcome, h.released_at, h.released_by] = ["released", at, actor];
      events.push({ type: "hold_released", t: at, hold_id: h.hold_id });
      steps.push({ t: at, hold: h, step: "release" });
      settleVersion(h, "released", reviewPoint(at, cfg.review.roster, cfg.review.timing));
    }
  }

  for (const { hold, step } of sortedBy(steps, (x) => x.t)) {
    const kind = hold.target_kind;
    const row = kind === "material_lot" ? lots.find((l) => l.lot_id === hold.target_id) : kind === "equipment" ? equipment.find((e) => e.equipment_id === hold.target_id) : undefined;
    if (row === undefined || (kind !== "material_lot" && kind !== "equipment")) continue; // a batch and a result have no state of their own here
    const to = step === "place" ? "on_hold" : step === "quarantine" ? "quarantined" : (before.get(hold.hold_id) as string);
    if (step === "place") before.set(hold.hold_id, row.state);
    (row as { state: string }).state = transit(kind, row.state, to, step === "release" ? "reviewer" : "rule", log);
  }

  // concluded when every confirming result is in, closed when every hold is ended; the holds close with their deviation (data_model 15.2)
  if (holds.length > 0 && holds.every((h) => h.outcome !== null) && confirming.length > 0 && confirming.every((c) => c.complete_at !== null)) {
    const concluded = Math.max(...confirming.map((c) => c.complete_at as number));
    const closed_at = Math.max(concluded, ...holds.map((h) => h.released_at as number));
    for (const h of holds) h.state = transit("quality_hold", h.state, "closed", "rule", log) as "closed";
    for (const d of devs.filter((x) => touched.has(x.deviation_id))) {
      d.state = transit("deviation", "contained", "concluded", "rule", log) as "concluded";
      d.state = transit("deviation", "concluded", "closed", "reviewer", log) as "closed";
      [d.closed_at, d.closed_by] = [closed_at, actor];
      events.push({ type: "deviation_closed", t: closed_at, deviation_id: d.deviation_id });
    }
  }

  const dataset: RecordedDataset = { ...cur, result, validation_finding, quality_hold: holds, deviation: devs, material_lot: lots, equipment };
  return { dataset, walks, events: sortedBy(events, (e) => e.t), not_evaluable: unmet === null ? [] : [{ rule: "VR-022", reason: unmet }] };
};
