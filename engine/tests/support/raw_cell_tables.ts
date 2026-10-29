import type { RawCell } from "./raw_cells.ts";

// The expected cells of the (raw) and (manual) rows, typed by hand from the hypothesis matrix (spec section 5), the rule table ("Detection rules and the flags they need") and the
// evaluability of each rule (data_model section 8, S2b): VR-002 needs `two_clocks` (sampled_at); VR-003 needs a row-creation stamp, which any flag gives and A lacks, and a tolerance
// (600 s, test-only); VR-004 has no tolerance in these fixtures, so it is not evaluable; VR-024, VR-005 and VR-006 are ingest-stage or entry-stage rules that every architecture on
// the path runs; VR-013 reads the typed dilution against the method's ladder (1, 2, 4; A090). No expected value is read from the engine.
// Column order, as in cell_tables.ts: A, B, C, then C minus system_issued_id, two_clocks, available_at, instrument_state_snapshot, append_only_versions, write_time_keys,
// ingest_idempotency, audit_trail.

const ALL = (cell: RawCell): RawCell[] => Array<RawCell>(11).fill(cell);
const D = (rule: string): RawCell => `detected:${rule}`;
const NA = ALL("not_applicable");

export interface RawExpected {
  adapter_ingest: RawCell[];
  manual_transcription: RawCell[];
}

/** By row name (see RAW_ROWS). */
export const RAW_EXPECTED: Record<string, RawExpected> = {
  // detected by VR-003 wherever a row-creation stamp is stored (B, C and the ablations), invisible in A (no stamp, so the rule is not evaluable)
  "timestamp misread: the misread instant lies later than receipt": { adapter_ingest: ["invisible", ...Array<RawCell>(10).fill(D("VR-003"))], manual_transcription: NA },
  // detected by VR-002 wherever sampled_at is stored (two_clocks: C and every ablation but C minus two_clocks), invisible in A, B and C minus two_clocks
  "timestamp misread: the misread instant lies before the draw": {
    adapter_ingest: ["invisible", "invisible", D("VR-002"), D("VR-002"), "invisible", D("VR-002"), D("VR-002"), D("VR-002"), D("VR-002"), D("VR-002"), D("VR-002")], manual_transcription: NA,
  },
  // the misread instant still lies between the draw and receipt: nothing shows it
  "timestamp misread: a minute-truncated stamp still between the draw and receipt": { adapter_ingest: ALL("invisible"), manual_transcription: NA },
  // the order cannot be pinned: the adapter quarantines the row in every architecture on the path (VR-024)
  "timestamp misread: the order cannot be pinned": { adapter_ingest: ALL(D("VR-024")), manual_transcription: NA },
  "unit changed: a units row shows another dimension": { adapter_ingest: ALL(D("VR-005")), manual_transcription: NA },
  "unit changed: no units row, same dimension, plausible value": { adapter_ingest: ALL("invisible"), manual_transcription: NA },
  "unit changed: no units row, an impossible value": { adapter_ingest: ALL(D("VR-006")), manual_transcription: NA },
  "transcription: a wrong digit, a plausible value": { adapter_ingest: NA, manual_transcription: ALL("invisible") },
  "transcription: a wrong digit, an impossible value": { adapter_ingest: NA, manual_transcription: ALL(D("VR-006")) },
  "transcription: a unit slip to another dimension": { adapter_ingest: NA, manual_transcription: ALL(D("VR-005")) },
  "transcription: a dilution factor of 3, which the method does not offer": { adapter_ingest: NA, manual_transcription: ALL(D("VR-013")) },
  "transcription: the dilution factor left out": { adapter_ingest: NA, manual_transcription: ALL(D("VR-013")) },
};
