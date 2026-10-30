import type { Cell } from "./cells.ts";

// The expected cells, typed by hand BEFORE any run, from the hypothesis matrix of spec section 5 (columns "Prevented by", "Detected by", "Invisible when"),
// the flag table and the rule table under it, the One-flag-off column of ADR-0005, the S2a and S2b rulings (data_model section 7; spec "Notes from S2b"),
// and the author decisions of 2026-10-29 on the clock row and the instrument row (spec "Notes from S2c1").
// Columns, in order: A, B, C, then C minus system_issued_id, two_clocks, available_at, instrument_state_snapshot, append_only_versions, write_time_keys,
// ingest_idempotency, audit_trail, material_lot_links, equipment_links. B is system_issued_id + ingest_idempotency + audit_trail + equipment_links; C has all ten.

const P: Cell = "prevented";
const I: Cell = "invisible";

type Row = readonly Cell[];

/**
 * The ninth and tenth flags (ADR-0017, ADR-0020) are read only with a break-out event. These rows have none, so C minus either flag equals C in every cell: each table below types the
 * eleven cells of A, B, C and the eight ablations by hand and gains two cells that repeat C's (the third). The columns are then A, B, C, the eight ablations, C minus material_lot_links
 * and C minus equipment_links.
 */
export const plusLinks = <T>(row: readonly T[]): T[] => [...row, row[2] as T, row[2] as T];

/**
 * label or transcription error. system_issued_id prevents it. Without it nothing sees it: VR-014 needs the registry that system_issued_id gives, and
 * VR-009 needs two samples with one draw instant, which a mislabelled result never makes (S2b note under the matrix). So C minus system_issued_id,
 * which has two_clocks, is invisible too.
 */
export const LABEL_CELLS: Row = plusLinks([I, P, P, I, P, P, P, P, P, P, P]);

/**
 * feed in the gap. two_clocks prevents it (the join uses sampled_at). Without it VR-010 cannot run (it needs both clocks), so the error is invisible in
 * A, B and C minus two_clocks. No cell is "detected": the only rule that sees it needs the flag that prevents it.
 */
export const FEED_CELLS: Row = plusLinks([I, I, P, P, I, P, P, P, P, P, P]);

/**
 * unit or batch re-keyed after write. write_time_keys prevents it. Without it only a gross case is seen, and only where sampled_at is stored: VR-020 needs
 * two_clocks. The fixture is gross (the unit has no open batch at the draw), so C minus write_time_keys, which has two_clocks, is detected by VR-020;
 * A and B store one time and are invisible.
 */
export const REKEY_CELLS: Row = plusLinks([I, I, P, P, P, P, P, P, "detected:VR-020", P, P]);

/** The same errors when the re-key names a unit that has an open batch: "a mis-key onto another unit that has an open batch passes" (rule table). */
export const REKEY_OPEN_CELLS: Row = plusLinks([I, I, P, P, P, P, P, P, I, P, P]);

/**
 * clock or time-zone error. No flag prevents it. A (every flag off) stores no ingested_at, so there is no host stamp to compare the instrument stamp
 * with: invisible. Everywhere a system writes the rows (any flag on) VR-004 compares the instrument clock with the host clock through the stored
 * ingestion stamp, so the offset is detected, in B and in C minus two_clocks too (author decision of 2026-10-29: ADR-0005's "invisible" for C minus
 * two_clocks is a hypothesis the forced fixture refutes). Only the VR-004 tolerance is set in the fixture, so VR-004 is the one rule that fires.
 */
export const CLOCK_CELLS: Row = plusLinks([I, "detected:VR-004", "detected:VR-004", "detected:VR-004", "detected:VR-004", "detected:VR-004", "detected:VR-004", "detected:VR-004", "detected:VR-004", "detected:VR-004", "detected:VR-004"]);

/**
 * duplicate or replayed file. ingest_idempotency prevents it: the replay is a no-op logged as VR-008 information (S2b ruling). Without it the rows double
 * count and nothing shows it ("no keys").
 */
export const REPLAY_CELLS: Row = plusLinks([I, P, P, P, P, P, P, P, P, I, P]);

/**
 * lost rerun or silent overwrite. append_only_versions prevents it. Without it the earlier value is gone, and audit_trail alone detects the change, with an
 * audit event holding the old and the new value: B and C minus append_only_versions are detected, A (no history) is invisible.
 */
export const RERUN_CELLS: Row = plusLinks([I, "detected:audit_event", P, P, P, P, P, "detected:audit_event", P, P, P]);

/**
 * instrument effect between analyzers. Nothing prevents it. A bridging study detects it when the record holds a control_id pair measured on both analyzers
 * and the analyzer identity (author decision of 2026-10-29: ADR-0005 read literally, free text suffices). The ten flags are the only differences between
 * architectures and none owns the control_id of the plan or the analyzer name, so every architecture holds both: detected everywhere.
 */
export const INSTRUMENT_CELLS: Row = Array<Cell>(13).fill("detected:bridging_study");

/**
 * instrument effect within an analyzer: a reagent lot step. Nothing prevents it. The effect is attributable only where the runs link to the instrument state
 * (they name the reagent lot): detected wherever instrument_state_snapshot is on, invisible in A, B and C minus instrument_state_snapshot.
 */
export const LOT_CELLS: Row = plusLinks([I, I, "detected:lot_link", "detected:lot_link", "detected:lot_link", "detected:lot_link", I, "detected:lot_link", "detected:lot_link", "detected:lot_link", "detected:lot_link"]);

/**
 * late correction leaking into an earlier decision. available_at prevents it (the as-of read honours it). Without it queries see rows as of now: the
 * corrected value reaches the earlier decision and no as-of query can show it (A, B, C minus available_at: invisible). With available_at on but versions
 * off (C minus append_only_versions) the overwritten row carries the later available_at, so the earlier decision reads nothing and the correction does not
 * leak: prevented (the earlier version is lost, which is the lost-rerun row).
 */
export const LATE_CELLS: Row = plusLinks([I, I, P, P, P, I, P, P, P, P, P]);

/**
 * unattributable record. audit_trail prevents it (operator and qualification stored). Without it the operator is absent and VR-015 cannot run: invisible in
 * A and C minus audit_trail.
 */
export const ATTRIB_CELLS: Row = plusLinks([I, P, P, P, P, P, P, P, P, P, I]);

/**
 * sampling technique error (A064). Nothing prevents it. Detected by the recorded container and hold context. The container is recorded by every architecture
 * that records the sample (an L2 setting, no flag owns it); the hold time needs both clocks (two_clocks). So A, B and C minus two_clocks are invisible, and
 * every configuration with two_clocks is detected.
 */
export const TECHNIQUE_CELLS: Row = plusLinks([I, I, "detected:container_hold", "detected:container_hold", I, "detected:container_hold", "detected:container_hold", "detected:container_hold", "detected:container_hold", "detected:container_hold", "detected:container_hold"]);

/** The row that shows that removing a flag from C changes a cell (hand-typed from the tables above). */
export const FLAG_SHOWN_BY = {
  system_issued_id: "label_error",
  two_clocks: "feed_in_gap",
  available_at: "late_correction",
  instrument_state_snapshot: "lot_effect",
  append_only_versions: "lost_rerun",
  write_time_keys: "unit_rekey",
  ingest_idempotency: "duplicate_replay",
  audit_trail: "unattributable_record",
} as const;
