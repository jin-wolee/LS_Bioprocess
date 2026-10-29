import type { Rule, RuleConfig } from "./rule_types.ts";
import { ENTRY_RULES } from "./rules_entry.ts";
import { KEY_RULES } from "./rules_keys.ts";
import { QC_RULES } from "./rules_qc.ts";
import { TIME_RULES } from "./rules_time.ts";
import { transit } from "./transitions.ts";
import type { Transition } from "./transitions.ts";
import type { RecordedDataset, ResultRow, ResultState, ValidationFindingRow } from "./types.ts";

// Detection = the validation rule catalogue of data_model section 8 applied to a recorded dataset (S2b). Rules change the state of a row
// (hold, quarantine, reject) and write a finding; they never edit a value, a time or an id. A rule whose fields the architecture does not
// store is not evaluable and is listed as such. Detection never causes a re-draw or a re-measure (spec section 8, anti-gaming rule 4).
// Rules not here: VR-001, VR-005, VR-006, VR-007, VR-013, VR-016 to VR-018 (no matrix row of S2b reads them, or they need the raw layer, units or lineage).
// VR-012 (run QC failed) is here since the S2 review step. A held or quarantined row is resolved by the review step (record/review.ts), which runs after the rules.

export type { Rule, RuleConfig };

/** In the order of the catalogue (the ids sort as the catalogue does: VR-008b follows VR-004 and precedes VR-009). */
export const RULES: readonly Rule[] = [...TIME_RULES, ...KEY_RULES, ...QC_RULES].sort((a, b) => (a.id < b.id ? -1 : 1));
export const RULE_IDS: readonly string[] = RULES.map((r) => r.id);

export interface Validation {
  dataset: RecordedDataset;
  not_evaluable: { rule: string; reason: string }[];
}

/** The states a rule can set; `released` is set only by the review step (record/review.ts). */
type RuleState = Exclude<ResultState, "released">;
const RANK: Record<RuleState, number> = { held: 1, quarantined: 2, rejected: 3 };
const STATE_OF = { hold: "held", quarantine: "quarantined", reject: "rejected" } as const;

/** The analysis request a finding concerns: the sample of a `sample:` target, the request of a `result:` target, the request in a source event id. */
export const requestOfTarget = (ds: RecordedDataset, target: string): string | null => {
  const [kind, ...rest] = target.split(":");
  const id = rest.join(":");
  if (kind === "sample") return id;
  if (kind === "result") return ds.result.find((r) => r.result_id === id)?.request_id ?? null;
  if (kind === "source_event") return id.split("/")[1] ?? null; // analyzer/request/attempt/visit/analyte
  return null;
};

/** `log` (optional) collects the state transitions performed, for the data dictionary tests (S2d). */
export const validate = (ds: RecordedDataset, cfg: RuleConfig, log?: Transition[]): Validation => {
  const not_evaluable: Validation["not_evaluable"] = [];
  const found: ValidationFindingRow[] = [];
  // S2e1: VR-005, VR-006 and VR-013 read a typed entry, so they run only on the manual_transcription path of the raw layer (spec section 5, rule table)
  const rules = ds.capture?.path === "manual_transcription" ? [...RULES, ...ENTRY_RULES].sort((a, b) => (a.id < b.id ? -1 : 1)) : RULES;
  for (const rule of rules) {
    const reason = rule.unmet(ds, cfg);
    if (reason !== null) {
      not_evaluable.push({ rule: rule.id, reason });
      continue;
    }
    for (const target of rule.check(ds, cfg)) found.push({ rule: rule.id, target, severity: rule.severity, action: rule.action, status: "open" });
  }
  // the most severe action wins on a row; a source_event target changes no row (the original stays)
  const states = new Map<string, RuleState>();
  const raise = (key: string, state: RuleState): void => {
    const cur = states.get(key);
    if (!cur || RANK[state] > RANK[cur]) states.set(key, state);
  };
  for (const f of found) {
    if (f.action === "no-op") continue;
    const [kind, ...rest] = f.target.split(":");
    if (kind === "result" || kind === "sample") raise(`${kind}:${rest.join(":")}`, STATE_OF[f.action]);
  }
  const result: ResultRow[] = ds.result.map((r) => {
    if (r.state !== null) return r; // already put in a state by the ingest stage (S2e1): the finding of that stage stays, the state is not moved twice
    const own = states.get(`result:${r.result_id}`);
    const request = states.get(`sample:${r.request_id}`);
    const state = own && request ? (RANK[own] >= RANK[request] ? own : request) : (own ?? request ?? null);
    // a row with state null is in `measured` (data_model section 6); a rule moves it to held, quarantined or rejected, and only through the table
    return state === null ? r : { ...r, state: transit("result", "measured", state, "rule", log) as RuleState };
  });
  return { dataset: { ...ds, result, validation_finding: [...ds.validation_finding, ...found] }, not_evaluable };
};
