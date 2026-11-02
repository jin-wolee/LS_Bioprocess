import type { LineageView } from "./lineage.ts";

// 2026-10-30 S3e, the shapes the challenge sends to the page (docs/design/lab_ui.md sections 4 and 9). Plain data only (structuredClone-safe). `RecordView` and `DecisionRecordView` are what the
// reader searches: recorded rows only, nothing of truth, nothing of the plant. `Reveal` exists only after the guess or the give-up.

export interface RecordView {
  architecture: string;
  flags_on: string[];
  samples: { sample_id: string; unit_id: string; batch_id: string | null; sampled_at: number | null; planned_at: number | null; state: string | null }[];
  results: { request_id: string; analyte: string; version: number; value: number; measured_at: number; available_at: number | null; state: string | null }[];
  findings: { rule: string; target: string; severity: string; status: string }[];
  /** Where `audit_trail` is on; empty otherwise (S3e clarification: section 9 names the audit events among the tables the reader can open, the interface listed none). */
  audit_events: { audit_id: string; request_id: string; analyte: string; at: number; old_value: number | null; new_value: number | null; old_version: number; new_version: number }[];
  /** The structural error types the record carries on every one of its samples, in the order of `ERROR_TYPES`: they do not tell one sample from another, so a guess is never `background` for them (section 9). */
  ubiquitous: string[];
}

export interface DecisionRecordView {
  architecture: string;
  flags_on: string[];
  /** The samples with a pH result; null where the record stores none. */
  samples: (RecordView["samples"][number] & { container: string | null; hold_s: number | null })[];
  decisions: {
    /** `<unit_id>@<t>` */
    decision_id: string;
    unit_id: string;
    /** The readjustment tick. */
    t: number;
    /** none: no new available pH row at the tick. */
    action: "readjust" | "skip" | "none";
    read: { filed_under: string; measured_at: number; value: number; container: string | null; hold_s: number | null; state: string | null } | null;
    /** readjust: the value the probe is set to read. */
    onto: number | null;
    /** skip: why. */
    reason: "known_bias" | null;
  }[];
  findings: RecordView["findings"];
}

/** `hit`: the guess is in the affected set. `background`: not planted, but the record carries a structural error (or, for a decision, a value SC8 biases by construction) there, named. `miss`: otherwise. */
export interface Score {
  result: "hit" | "background" | "miss";
  background_type?: string;
}

export interface Reveal {
  planted: { type: string; affected: string[]; detail: Record<string, string | number> };
  /** Null after a give-up: no score. */
  score: Score | null;
  per_architecture: {
    architecture: string;
    outcome: "prevented" | "invisible" | "detected";
    evidence: string[];
    /** A dictionary key (`flag.<name>.on` or `.off`): the reading of ADR-0005's flag table for the flag that decides this outcome, so the sentence is translated. */
    reading: string;
    /** Decision variant: whether the decision at the affected tick is the same as in the unplanted loop of this architecture. */
    decision_same?: boolean;
  }[];
  lineage: LineageView;
  /** Decision variant only. */
  decisions?: {
    affected: string[];
    rows: { decision_id: string; read_as: string; from_sample: string; value: number; record: { container: string | null; hold_s: number | null }; truth: { container: string; hold_s: number } }[];
  };
}
