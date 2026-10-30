import type { FlagName } from "./architecture.ts";
import { transit } from "./transitions.ts";
import type { Transition } from "./transitions.ts";
import { hasValue } from "./types.ts";
import type { AuditEventRow, QualityHoldRow, RecordedDataset, ResultRow, ValidationFindingRow } from "./types.ts";

// VR-022 and the retro-flag (data_model 15.3 and 15.5; spec 11.8.2 rules S9 and S11; break-out batch 4). The rule reads a recorded dataset AS OF an instant t, because it fires late by design: the
// hold is placed after the release, and the finding is the retro-flag. "A result version in state released at time t is covered by a quality_hold placed at or before t and no later version
// exists." It is not one of the rules `validate` runs over a whole dataset (it needs t, and the holds exist only once the investigation has placed them), and unlike them it does not change the
// row it finds: version n is never modified (K8). It creates version n+1 with the same value and units (K16), the state quarantined, `supersedes` n and the `hold_id`.
//   "Released" is a result row whose state is null or released and whose `available_at` is known at t. "Covered" is a hold on the result itself: the walk-back names every result it returns, so a
//   hold on a batch, a lot or an equipment item does not reach the other results of its batch by itself. A hold that is ended before t covers nothing.

type Flags = Record<FlagName, boolean>;

/** The flags without which the flag of a released result cannot be kept as data_model 15.3 item 5 needs: the time it was written, the version beside the old one, the person and the reason. */
export const RETRO_FLAG_FLAGS = ["available_at", "append_only_versions", "audit_trail"] as const satisfies readonly FlagName[];

export const vr022Unmet = (ds: RecordedDataset): string | null => {
  const flags: Flags = ds.architecture.flags;
  const off = RETRO_FLAG_FLAGS.filter((f) => !flags[f]);
  return off.length === 0 ? null : `VR-022 needs ${RETRO_FLAG_FLAGS.join(", ")} (data_model 15.3 item 5); off: ${off.join(", ")}: a released result under a hold stays released`;
};

/**
 * The holds that exist at t, as the architecture can tell. With available_at on a hold is known from its `available_at` (a hold entered at 25 h about one placed at 18 h is not there at 20 h).
 * With it off nothing can cut by transaction time and only the valid time, `placed_at`, is left, so the late entry is there from the instant it took effect: it leaks backwards (section 5).
 */
export const holdsAsOf = (ds: RecordedDataset, t: number): QualityHoldRow[] => {
  const strict = ds.architecture.flags.available_at;
  return (ds.quality_hold ?? []).filter((h) => (strict ? h.available_at !== null && h.available_at <= t : h.placed_at <= t));
};

/** The first hold on each result that is in force at t (not ended before it), by result id. */
const coveringHolds = (ds: RecordedDataset, t: number): Map<string, QualityHoldRow> => {
  const out = new Map<string, QualityHoldRow>();
  for (const h of holdsAsOf(ds, t)) if (h.target_kind === "result" && (h.released_at === null || h.released_at > t) && !out.has(h.target_id)) out.set(h.target_id, h);
  return out;
};

/** The result ids VR-022 fires on at t, in table order: the released versions covered by a hold, with no later version. */
export const vr022Targets = (ds: RecordedDataset, t: number): string[] => {
  const covering = coveringHolds(ds, t);
  if (covering.size === 0) return [];
  const superseded = new Set(ds.result.flatMap((r) => (r.supersedes === null ? [] : [r.supersedes])));
  return ds.result
    .filter((r) => hasValue(r) && covering.has(r.result_id) && !superseded.has(r.result_id) && (r.state === null || r.state === "released") && r.available_at !== null && r.available_at <= t)
    .map((r) => r.result_id);
};

/**
 * The retro-flag at t: version n+1 for every result VR-022 fires on, the audit event with the person and the reason of the hold, and the finding on version n (open until the version is reviewed).
 * Returns the dataset with those rows added and the new versions. `log` (optional) collects the state transitions performed (S2d).
 */
export const retroFlag = (ds: RecordedDataset, t: number, log?: Transition[]): { dataset: RecordedDataset; flagged: ResultRow[] } => {
  const targets = vr022Targets(ds, t);
  if (targets.length === 0) return { dataset: ds, flagged: [] };
  const covering = coveringHolds(ds, t);
  const audit: AuditEventRow[] = [];
  const findings: ValidationFindingRow[] = [];
  let k = ds.result.filter((r) => r.hold_id != null).length;
  const flagged = ds.result.filter((n) => targets.includes(n.result_id)).map((n): ResultRow => {
    const hold = covering.get(n.result_id) as QualityHoldRow;
    // the new version is a new row that starts as measured and is quarantined by the rule, as a row that a rule holds is
    const state = transit("result", "measured", "quarantined", "rule", log) as "quarantined";
    const v: ResultRow = { ...n, result_id: `RF${++k}`, version: n.version + 1, supersedes: n.result_id, state, hold_id: hold.hold_id, available_at: t, ingested_at: t, reviewed_at: null };
    audit.push({
      audit_id: `A${ds.audit_event.length + audit.length + 1}`, request_id: n.request_id, analyte: n.analyte, at: t, old_value: n.value as number, new_value: n.value as number,
      old_version: n.version, new_version: v.version, hold_id: hold.hold_id, placed_by: hold.placed_by, reason: hold.reason,
    });
    findings.push({ rule: "VR-022", target: `result:${n.result_id}`, severity: "error", action: "quarantine", status: "open" });
    return v;
  });
  return { dataset: { ...ds, result: [...ds.result, ...flagged], audit_event: [...ds.audit_event, ...audit], validation_finding: [...ds.validation_finding, ...findings] }, flagged };
};
