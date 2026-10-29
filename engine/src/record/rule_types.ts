import type { Physical } from "./entry_checks.ts";
import type { RecordedDataset, ValidationFindingRow } from "./types.ts";

// The shape of a validation rule (data_model section 8). A rule reads a recorded dataset and names the targets it fires on; it can only
// change the state of a row (hold, quarantine, reject), never a value. A rule that needs a field the architecture does not store is
// "not evaluable" (`unmet` gives the reason); it is never reported as passed.

/** Tolerances and limits are scenario settings (data_model section 8: "this document fixes no value"); a missing one makes its rule not evaluable. */
export interface RuleConfig {
  /** VR-010: hold_time above this many seconds is flagged (A046). */
  hold_limit_s?: number;
  /** VR-003: measured_at later than ingested_at by more than this many seconds. */
  late_tolerance_s?: number;
  /** VR-004: measured_at and ingested_at apart by more than this many seconds, either way. */
  clock_tolerance_s?: number;
  /** VR-005, VR-006 and VR-013 on a typed entry (manual_transcription): what the method expects. Absent: those rules are not evaluable. */
  entry?: EntryConfig;
}

/** The method's expectations for a typed result (data_model section 8; spec section 5, rule table): units and bounds from the analyte master data, the dilution rule from the analyzer profile (A090). */
export interface EntryConfig {
  analytes: Readonly<Record<string, { dimension: string; physical: Physical }>>;
  /** UCUM code to dimension, for every unit text the entry form may carry. */
  dimension_of: Readonly<Record<string, string>>;
  /** VR-013: the analytes that need a dilution factor, and the factors the method allows. */
  dilution: { analytes: readonly string[]; factors: readonly number[] };
}

export interface Rule {
  id: string;
  severity: Exclude<ValidationFindingRow["severity"], "info">;
  action: Exclude<ValidationFindingRow["action"], "no-op">;
  /** Why the rule cannot run on this dataset (a flag that is off, a limit that is not configured), or null when it can. */
  unmet: (ds: RecordedDataset, cfg: RuleConfig) => string | null;
  /** The targets it fires on: `result:<id>`, `sample:<id>` or `source_event:<id>`. */
  check: (ds: RecordedDataset, cfg: RuleConfig) => string[];
}

export const TWO_CLOCKS = (ds: RecordedDataset): string | null => (ds.architecture.flags.two_clocks ? null : "sampled_at is not stored (two_clocks off)");
export const bySampleId = (ds: RecordedDataset) => new Map(ds.sample.map((s) => [s.sample_id, s]));
