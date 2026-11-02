import type { Metrics } from "../generated/metrics.schema";
import { resultsAsOf } from "../record/asof.ts";
import { hasValue } from "../record/types.ts";
import type { RecordedDataset } from "../record/types.ts";
import { recordedId } from "./answer_key.ts";
import type { ArchitectureKey } from "./answer_key.ts";
import { NOW } from "./query.ts";
import { ratio } from "./ratio.ts";
import { mean, variance } from "./stats.ts";
import type { RequestFacts, Truth } from "./truth.ts";

type Out = Metrics["metrics"];

export interface Contrast {
  analyte: string;
  /** The two groups are the analyzers that measured the final attempt (truth). */
  group_a: string;
  group_b: string;
}

/**
 * Phantom effect size (spec section 8): the absolute difference between the recorded and the true group effect, over the pooled truth SD,
 * for a contrast whose true effect is zero by design (the same population measured on two analyzers). The caller names the contrast; the
 * function does not check that the true effect is zero, it reports it (`true_effect`). Denominator: requests in the contrast (`n_a`, `n_b`).
 * The pooled SD is that of the true values; null (no value) when it is zero or a group is empty.
 */
export const phantomEffect = (truth: Truth, ds: RecordedDataset, key: ArchitectureKey, c: Contrast): Out["phantom_effect"] => {
  const finalTruth = new Map<string, { attempt: number; analyzer: string; value: number }>();
  for (const e of truth.events) {
    if (e.type !== "result_measured" || e.analyte !== c.analyte) continue;
    const prev = finalTruth.get(e.request_id);
    if (!prev || e.attempt >= prev.attempt) finalTruth.set(e.request_id, { attempt: e.attempt, analyzer: e.analyzer, value: e.true_value });
  }
  const recorded = new Map<string, number>();
  for (const r of resultsAsOf(ds, NOW).filter(hasValue)) if (r.analyte === c.analyte && !recorded.has(r.request_id)) recorded.set(r.request_id, r.value);
  const a: { truth: number; rec: number }[] = [];
  const b: { truth: number; rec: number }[] = [];
  for (const [id, t] of finalTruth) {
    const rec = recorded.get(recordedId(key, id));
    if (rec === undefined) continue;
    if (t.analyzer === c.group_a) a.push({ truth: t.value, rec });
    else if (t.analyzer === c.group_b) b.push({ truth: t.value, rec });
  }
  const denominator = "requests in the contrast (both groups, with a recorded result)";
  const side = (g: typeof a, f: "truth" | "rec"): number | null => mean(g.map((x) => x[f]));
  const effect = (f: "truth" | "rec"): number | null => (a.length === 0 || b.length === 0 ? null : (side(a, f) as number) - (side(b, f) as number));
  const dof = a.length + b.length - 2;
  const ss = (variance(a.map((x) => x.truth)) ?? 0) * (a.length - 1) + (variance(b.map((x) => x.truth)) ?? 0) * (b.length - 1);
  const sd = dof > 0 ? Math.sqrt(ss / dof) : null;
  const trueEffect = effect("truth");
  const recEffect = effect("rec");
  const value = sd !== null && sd > 0 && trueEffect !== null && recEffect !== null ? Math.abs(recEffect - trueEffect) / sd : null;
  return { analyte: c.analyte, group_a: c.group_a, group_b: c.group_b, n_a: a.length, n_b: b.length, true_effect: trueEffect, recorded_effect: recEffect, pooled_truth_sd: sd, value, denominator };
};

/**
 * Rerun traceability rate (spec section 8): reruns whose original and link are recoverable, over ALL requests that had a rerun. Recoverable,
 * per visit and per item as the engine numbers its attempts (audit A1, F2: attempts count per visit): for every item, version 1 still holds the
 * value its first attempt reported (none for a run over range at the last dilution, spec 2.3), and versions 2 to the number of attempts of that
 * item's visit each supersede the one before. The reason of a rerun is recorded by no architecture of S2 and is not scored.
 */
export const rerunTraceability = (truth: Truth, facts: ReadonlyMap<string, RequestFacts>, ds: RecordedDataset, key: ArchitectureKey): Out["rerun_traceability"] => {
  const reran = truth.requests.filter((r) => (facts.get(r.request_id)?.reruns ?? 0) > 0);
  let traced = 0;
  for (const r of reran) {
    const f = facts.get(r.request_id) as RequestFacts;
    const rows = ds.result.filter((x) => x.request_id === recordedId(key, r.request_id));
    const ok = [...f.items].every(([analyte, item]) => {
      const mine = rows.filter((x) => x.analyte === analyte);
      const v1 = mine.find((x) => x.version === 1);
      if (!v1 || v1.value !== f.original.get(analyte)) return false;
      let prev = v1;
      for (let k = 2; k <= item.attempts; k++) {
        const next = mine.find((x) => x.version === k);
        if (!next || next.supersedes !== prev.result_id) return false;
        prev = next;
      }
      return true;
    });
    if (ok) traced += 1;
  }
  return ratio(traced, reran.length, "requests with at least one rerun (original and link recoverable; the reason is recorded by no architecture and is not scored)");
};
