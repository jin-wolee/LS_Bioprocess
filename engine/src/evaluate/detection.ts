import type { Metrics } from "../generated/metrics.schema";
import { ERROR_TYPES } from "../inject/types.ts";
import type { ErrorType } from "../inject/types.ts";
import type { RecordedDataset } from "../record/types.ts";
import { requestOfTarget } from "../record/validate.ts";
import { realised, recordedId } from "./answer_key.ts";
import type { ArchitectureKey } from "./answer_key.ts";
import { ratio } from "./ratio.ts";
import type { Truth } from "./truth.ts";

/**
 * The rules whose flags are "flags of type e" (spec section 5 matrix, column "Detected by", rule ids as in data_model section 8). A type whose
 * detector is a mechanism rather than a rule (audit review, a bridging study, an as-of query) has none: detection is not evaluable for it.
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
 * `evaluable` is false when no rule of the type exists or could run on the architecture, so a recall of 0 is then not "looked and found nothing".
 */
export const detection = (truth: Truth, ds: RecordedDataset, key: ArchitectureKey, notEvaluable: readonly { rule: string; reason: string }[]): Metrics["metrics"]["detection"] => {
  const by_type: Record<string, TypeDetection> = {};
  for (const type of ERROR_TYPES) {
    const rules = RULES_OF[type];
    const blocked = rules.map((id) => notEvaluable.find((x) => x.rule === id)).filter((x) => x !== undefined);
    const evaluable = rules.length > 0 && blocked.length < rules.length;
    const reason = rules.length === 0 ? "no rule of the catalogue detects this type (its detector is a mechanism: audit review, a bridging study or an as-of query)" : evaluable ? null : blocked.map((b) => `${b.rule}: ${b.reason}`).join("; ");
    const truthIds = realised(key, type);
    const recorded = new Set(truthIds.map((id) => recordedId(key, id)));
    const flags = ds.validation_finding.filter((f) => f.action !== "no-op" && rules.includes(f.rule)).map((f) => requestOfTarget(ds, f.target));
    const flagged = new Set(flags.filter((r): r is string => r !== null));
    const onRealised = flags.filter((r) => r !== null && recorded.has(r)).length;
    const clean = truth.requests.filter((r) => !truthIds.includes(r.request_id));
    by_type[type] = {
      evaluable, reason, realised: truthIds.length,
      recall: ratio(truthIds.filter((id) => flagged.has(recordedId(key, id))).length, truthIds.length, "realised opportunities of the type"),
      precision: ratio(onRealised, flags.length, "raised flags of the type"),
      false_alarm: ratio(clean.filter((r) => flagged.has(recordedId(key, r.request_id))).length, clean.length, "requests clean for the type"),
    };
  }
  return { by_type: by_type as Metrics["metrics"]["detection"]["by_type"], not_evaluable: [...notEvaluable], not_modelled: [...key.not_modelled] };
};
