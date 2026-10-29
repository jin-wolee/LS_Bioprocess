import type { Rule, RuleConfig } from "./rule_types.ts";
import { KEY_RULES } from "./rules_keys.ts";
import { TIME_RULES } from "./rules_time.ts";
import type { RecordedDataset, ResultRow, ResultState, ValidationFindingRow } from "./types.ts";

// Detection = the validation rule catalogue of data_model section 8 applied to a recorded dataset (S2b). Rules change the state of a row
// (hold, quarantine, reject) and write a finding; they never edit a value, a time or an id. A rule whose fields the architecture does not
// store is not evaluable and is listed as such. Detection never causes a re-draw or a re-measure (spec section 8, anti-gaming rule 4).
// Rules not here: VR-001, VR-005, VR-006, VR-007, VR-012, VR-013, VR-016 to VR-018 (no matrix row of S2b reads them, or they need the raw layer, units or lineage).

export type { Rule, RuleConfig };

/** In the order of the catalogue. */
export const RULES: readonly Rule[] = [...TIME_RULES.slice(0, 3), ...KEY_RULES.slice(0, 1), ...KEY_RULES.slice(1, 2), ...TIME_RULES.slice(3), ...KEY_RULES.slice(2)];
export const RULE_IDS: readonly string[] = RULES.map((r) => r.id);

export interface Validation {
  dataset: RecordedDataset;
  not_evaluable: { rule: string; reason: string }[];
}

const RANK: Record<ResultState, number> = { held: 1, quarantined: 2, rejected: 3 };
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

export const validate = (ds: RecordedDataset, cfg: RuleConfig): Validation => {
  const not_evaluable: Validation["not_evaluable"] = [];
  const found: ValidationFindingRow[] = [];
  for (const rule of RULES) {
    const reason = rule.unmet(ds, cfg);
    if (reason !== null) {
      not_evaluable.push({ rule: rule.id, reason });
      continue;
    }
    for (const target of rule.check(ds, cfg)) found.push({ rule: rule.id, target, severity: rule.severity, action: rule.action, status: "open" });
  }
  // the most severe action wins on a row; a source_event target changes no row (the original stays)
  const states = new Map<string, ResultState>();
  const raise = (key: string, state: ResultState): void => {
    const cur = states.get(key);
    if (!cur || RANK[state] > RANK[cur]) states.set(key, state);
  };
  for (const f of found) {
    if (f.action === "no-op") continue;
    const [kind, ...rest] = f.target.split(":");
    if (kind === "result" || kind === "sample") raise(`${kind}:${rest.join(":")}`, STATE_OF[f.action]);
  }
  const result: ResultRow[] = ds.result.map((r) => {
    const own = states.get(`result:${r.result_id}`);
    const request = states.get(`sample:${r.request_id}`);
    const state = own && request ? (RANK[own] >= RANK[request] ? own : request) : (own ?? request ?? null);
    return state === null ? r : { ...r, state };
  });
  return { dataset: { ...ds, result, validation_finding: [...ds.validation_finding, ...found] }, not_evaluable };
};
