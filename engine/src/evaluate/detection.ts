import type { EvidenceDetection, Metrics } from "../generated/metrics.schema";
import { ERROR_TYPES } from "../inject/types.ts";
import type { ErrorType } from "../inject/types.ts";
import type { RecordedDataset } from "../record/types.ts";
import { requestOfTarget } from "../record/validate.ts";
import { realised, recordedId } from "./answer_key.ts";
import type { ArchitectureKey } from "./answer_key.ts";
import { EVIDENCE_OF } from "./evidence_flags.ts";
import { NOT_APPLICABLE, ratio } from "./ratio.ts";
import type { Truth } from "./truth.ts";

/**
 * The rules whose flags are "flags of type e" (spec section 5 matrix, rule ids as in data_model section 8). A type whose detector is a named evidence rather
 * than a rule (the audit event of a lost rerun) lists that evidence in `EVIDENCE_OF` (evidence_flags.ts). A type with neither has no detector at all.
 */
export const RULES_OF: Record<ErrorType, readonly string[]> = {
  label_error: ["VR-009", "VR-014"],
  feed_in_gap: ["VR-010"],
  unit_rekey: ["VR-020"],
  clock_offset: ["VR-003", "VR-004"],
  duplicate_replay: ["VR-008b"],
  lost_rerun: [],
  unattributable_record: ["VR-015"],
  planned_vs_actual: [],
};

type TypeDetection = Metrics["metrics"]["detection"]["by_type"]["label_error"];

/**
 * Detection per error type e (spec section 8). A flag is a finding that is not a no-op and whose rule is a rule of the type.
 *  recall      realised opportunities of e that carry a flag of e, over ALL realised opportunities of e. Flagged-only samples never define it.
 *  precision   flags of e that sit on a realised opportunity of e, over ALL raised flags of e.
 *  false alarm requests clean for e (no realised opportunity of e) that carry a flag of e, over ALL requests clean for e.
 * A flag sits on the request whose results the record holds under the flagged id (the key maps a mislabelled sample to that id).
 * A type whose only detector is an evidence check (evidence_flags.ts) raises no alarm: its recall counts the realised opportunities whose request carries
 * the evidence, and its precision and false-alarm rate read "not applicable".
 * `evaluable` is false when no rule or evidence of the type exists or could run on the architecture, so a recall of 0 is then not "looked and found nothing".
 * `by_detector` counts, for the detectors that could run, the flags of a rule or the realised opportunities an evidence check shows; a detector that could not run is not listed.
 */
export const detection = (truth: Truth, ds: RecordedDataset, key: ArchitectureKey, notEvaluable: readonly { rule: string; reason: string }[]): Metrics["metrics"]["detection"] => {
  const by_type: Record<string, TypeDetection | EvidenceDetection> = {};
  for (const type of ERROR_TYPES) {
    const rules = RULES_OF[type];
    const evidence = EVIDENCE_OF[type] ?? [];
    const blocked = rules.map((id) => notEvaluable.find((x) => x.rule === id)).filter((x) => x !== undefined);
    const idle = evidence.filter((e) => !ds.architecture.flags[e.needs]);
    const runnableRules = rules.filter((id) => !blocked.some((b) => b.rule === id));
    const runnableEvidence = evidence.filter((e) => !idle.includes(e));
    const evaluable = runnableRules.length + runnableEvidence.length > 0;
    const reason = rules.length + evidence.length === 0
      ? "no rule or evidence check of the catalogue detects this type"
      : evaluable ? null : [...blocked.map((b) => `${b.rule}: ${b.reason}`), ...idle.map((e) => `${e.name}: needs ${e.needs}, which is off`)].join("; ");
    const truthIds = realised(key, type);
    const recorded = new Set(truthIds.map((id) => recordedId(key, id)));
    // 2026-10-30 S2f F8: only a finding on a result or on a request is a flag of the type (a finding on a controller source event names no request and would lower the precision)
    const byRule = runnableRules.map((id) => ({
      name: id, requests: ds.validation_finding.filter((f) => f.action !== "no-op" && f.rule === id).flatMap((f) => requestOfTarget(ds, f.target) ?? []),
    }));
    const shown = runnableEvidence.map((e) => ({ name: e.name, requests: new Set(e.requests(ds)) }));
    const flags = byRule.flatMap((d) => d.requests);
    const flagged = new Set(flags);
    const onRealised = flags.filter((r) => recorded.has(r)).length;
    const clean = truth.requests.filter((r) => !truthIds.includes(r.request_id));
    const detected = truthIds.filter((id) => flagged.has(recordedId(key, id)) || shown.some((e) => e.requests.has(recordedId(key, id)))).length;
    const common = {
      evaluable, reason, realised: truthIds.length,
      recall: ratio(detected, truthIds.length, "realised opportunities of the type"),
      by_detector: Object.fromEntries([...byRule.map((d) => [d.name, d.requests.length]), ...shown.map((e) => [e.name, truthIds.filter((id) => e.requests.has(recordedId(key, id))).length])]),
    };
    by_type[type] = rules.length === 0 && evidence.length > 0
      ? { ...common, precision: NOT_APPLICABLE, false_alarm: NOT_APPLICABLE }
      : { ...common, precision: ratio(onRealised, flags.length, "raised flags of the type"), false_alarm: ratio(clean.filter((r) => flagged.has(recordedId(key, r.request_id))).length, clean.length, "requests clean for the type") };
  }
  return { by_type: by_type as Metrics["metrics"]["detection"]["by_type"], not_evaluable: [...notEvaluable], not_modelled: [...key.not_modelled] };
};
