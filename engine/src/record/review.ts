import { transit } from "./transitions.ts";
import type { Transition } from "./transitions.ts";
import type { RecordedDataset, ResultRow, ValidationFindingRow } from "./types.ts";

// The review step (data_model section 6, state diagram; section 7, "Review step and VR-012 decided in the S2 review step"). After the validation rules a row is
// `held` or `quarantined`; the review resolves it to `released` or `rejected`. Until S2c2 a hold never ended, so a long hold excluded a request for ever.
//
// The reviewer sees the record only (invariant 1): the outcome is a fixed policy of the rule id (A213, A214), never a judgement from the value or from truth. It never
// triggers a re-draw or a re-measure (spec section 8, anti-gaming rule 4), so recollection is not modelled. A rejected row keeps its value, is never available and is
// still in every denominator. Reviewer capacity is not modelled (a favourable assumption, A215). The review writes no finding and edits no value, no id and no
// measurement stamp; it sets `state`, `reviewed_at` and `available_at` of a held row and the `status` of the findings it resolves.

export type ReviewTiming = "next_shift_start" | "shift_end" | "next_day_start";

/** The roster of A201 as seconds from midnight, read by the assembly from the scenario. Day 0 is a Monday; days 5 and 6 of a week are the weekend. */
export interface Roster {
  /** The first shift starts (weekdays and weekends). */
  start_s: number;
  /** The second weekday shift starts, and the first one ends. */
  shift_change_s: number;
  end_weekday_s: number;
  end_weekend_s: number;
}

export interface ReviewConfig {
  roster: Roster;
  timing: ReviewTiming;
  /** Sensitivity variant (reported, never gated): rules rejected at review in addition to the policy, for example VR-015 and VR-020. */
  reject_also?: readonly string[];
}

export type Outcome = "released" | "rejected";

/**
 * The outcome per rule id: every rule that holds or quarantines a result row (VR-008b changes no row, VR-014 rejects at ingest and is final). Rejected, grade P
 * (A213): VR-010, VR-012, VR-009. Released with the finding kept and no timestamp corrected, grade A (A214): the others. A rule without an entry is an error.
 */
export const REVIEW_OUTCOME: Readonly<Record<string, Outcome>> = {
  "VR-002": "released", "VR-003": "released", "VR-004": "released", "VR-009": "rejected", "VR-010": "rejected",
  "VR-011": "released", "VR-012": "rejected", "VR-015": "released", "VR-019": "released", "VR-020": "released",
};

const DAY = 86400;
const isWeekend = (day: number): boolean => day % 7 >= 5;

/** The review points of a day, as seconds from midnight: the shift starts, or with the `shift_end` variant the shift ends. */
const pointsOf = (day: number, r: Roster, timing: ReviewTiming): number[] => {
  if (timing === "shift_end") return isWeekend(day) ? [r.end_weekend_s] : [r.shift_change_s, r.end_weekday_s];
  return isWeekend(day) ? [r.start_s] : [r.start_s, r.shift_change_s];
};

/**
 * The first staffed review point at or after `t` (A215): a shift start by default (weekdays 08:00 and 13:00, weekends 08:00 in the roster of A201), a shift end
 * with `shift_end`, and 08:00 of the day after the stamp's day with `next_day_start`. A stamp exactly on a point is reviewed at that point.
 */
export const reviewPoint = (t: number, roster: Roster, timing: ReviewTiming): number => {
  const day = Math.floor(t / DAY);
  if (timing === "next_day_start") return (day + 1) * DAY + roster.start_s;
  // the next day always has a point after t, so the search ends
  return [day, day + 1].flatMap((d) => pointsOf(d, roster, timing).map((p) => d * DAY + p)).find((c) => c >= t) as number;
};

const isOpen = (f: ValidationFindingRow): boolean => f.action === "hold" || f.action === "quarantine";
/** 2026-10-30 S2f F4: an open reject finding (VR-014: the row is not loaded, data_model section 8) is no hold to resolve, but it decides the outcome of a row that is in a state already. */
const isReject = (f: ValidationFindingRow): boolean => f.action === "reject" && f.status === "open";

/** `log` (optional) collects the state transitions performed, for the data dictionary tests (S2d). */
export const review = (ds: RecordedDataset, cfg: ReviewConfig, log?: Transition[]): RecordedDataset => {
  const rejecting = new Set(cfg.reject_also ?? []);
  const outcomeOf = (rule: string): Outcome => {
    if (rejecting.has(rule)) return "rejected";
    const outcome = REVIEW_OUTCOME[rule];
    if (outcome === undefined) throw new Error(`review: no outcome is defined for rule ${rule}; add it to REVIEW_OUTCOME (data_model section 7)`);
    return outcome;
  };
  // the rules that hold or quarantine, by the target they concern: `result:<id>` or `sample:<request>`
  const rulesAt = new Map<string, string[]>();
  for (const f of ds.validation_finding) if (isOpen(f)) rulesAt.set(f.target, [...(rulesAt.get(f.target) ?? []), f.rule]);
  const rejectedAt = new Set(ds.validation_finding.filter(isReject).map((f) => f.target));
  const strict = ds.architecture.flags.available_at;
  const reviewedResults = new Set<string>();
  const reviewedRequests = new Set<string>();

  const result = ds.result.map((r): ResultRow => {
    if (r.state !== "held" && r.state !== "quarantined") return r; // no hold: not reviewed (review by exception); an end state is final
    const rules = [...(rulesAt.get(`result:${r.result_id}`) ?? []), ...(rulesAt.get(`sample:${r.request_id}`) ?? [])];
    if (rules.length === 0) throw new Error(`review: result ${r.result_id} is ${r.state} but no finding concerns it`);
    // a row the ingest stage put in a state keeps it when a rule of the validation stage rejects it (validate.ts), so the reject is read here: it is never released
    const rejected = rejectedAt.has(`result:${r.result_id}`) || rejectedAt.has(`sample:${r.request_id}`);
    const at = reviewPoint(r.ingested_at ?? r.measured_at, cfg.roster, cfg.timing);
    reviewedResults.add(r.result_id);
    reviewedRequests.add(r.request_id);
    // the review performs both steps of the diagram at one instant (under_review has no duration): the row goes to under_review, then the reviewer rejects or the approver releases
    transit("result", r.state, "under_review", "reviewer", log);
    // any rejecting rule wins; a rejected row was never knowable downstream, so it has no available_at
    return rejected || rules.some((rule) => outcomeOf(rule) === "rejected")
      ? { ...r, state: transit("result", "under_review", "rejected", "reviewer", log) as "rejected", reviewed_at: at, available_at: null }
      : { ...r, state: transit("result", "under_review", "released", "approver", log) as "released", reviewed_at: at, available_at: strict ? at : r.available_at };
  });

  const validation_finding = ds.validation_finding.map((f): ValidationFindingRow => {
    const [kind, ...rest] = f.target.split(":");
    const id = rest.join(":");
    const concerned = kind === "result" ? reviewedResults.has(id) : kind === "sample" ? reviewedRequests.has(id) : false;
    return isOpen(f) && concerned ? { ...f, status: "resolved" } : f;
  });
  return { ...ds, result, validation_finding };
};
