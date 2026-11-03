-- Canonical DDL of the recorded world (docs/prompts/60_user_track.md, Card A; docs/design/data_model.md sections 2, 4, 5, 6, 12 and 13).
-- Written by AI under ADR-0022, clean-room from the specification; the author did not write it, and no engine source was read.
-- Acceptance: tests/user_track/test_schema_sql.py, which measures the DDL against the card and the fixtures, nothing more.
-- DuckDB dialect in standard SQL: TEXT, INTEGER, DOUBLE PRECISION, TIMESTAMP, PRIMARY KEY, UNIQUE, NOT NULL, CHECK, REFERENCES.
--
-- Decisions that are not obvious, and what was rejected:
--
-- 1. The recorded world must be able to hold wrong data, so that the wrongness can be found. A constraint is therefore declared only where
--    a violation means the writer is broken, not that the data is odd:
--      declared:  K1 (unique request, analyte, version), K2 (measured_at and run_id not null), K9 (unique source event and idempotency key),
--                 primary keys, the closed lists of section 6 and 12, the foreign keys along the spine (below), version >= 1.
--      queries:   K5, K6, K7, K8, K10, K12, K13 (tests/fixtures/sql/integrity/): they compare rows with rows, or with an earlier snapshot,
--                 which a CHECK cannot do, and DuckDB has no triggers. K3 is structural: sampled_at is a column of sample and of nothing else.
--      rejected:  a CHECK on any value or any physical limit (negative volume, pH range): VR-006 quarantines such a row, so the row must be stored.
--
-- 2. No time-order rule is a CHECK, not even the ones inside a single row. Section 5 says "violations are findings, not exceptions", and
--    VR-002 (sampled_at <= measured_at) quarantines, VR-003 (measured_at not later than ingested_at) holds: both need the row stored. The chain
--    sampled_at <= arrived_at <= run started_at <= measured_at <= ingested_at <= reviewed_at <= available_at crosses sample, run and result
--    (K4), so it is a validation query in any case. A skewed instrument clock (A049) also breaks run.started_at <= run.ended_at inside one row.
--
-- 3. Keys are natural: TEXT ids that the source writes at write time and never changes (principle 2, K5). Surrogate integers were rejected: the
--    id of a sample is the label on the tube, and a second key would hide re-keying (VR-018). Composite natural keys: method (method_id,
--    version), source_event (source_system, source_event_id). historian_value has no key at all: a late or corrected value is a new row with the
--    same (tag, ts) and a later ingested_at, rows are not versioned, and an index on about a million rows only slows the load.
--
-- 4. Foreign keys follow the spine unit > batch > sample > aliquot > analysis_request > result, and instrument > run > result. Every one is
--    nullable except where the child cannot exist without its parent (K2 for result.run_id and result.request_id), so an architecture that
--    cannot know a link stores NULL (principle 7) and a link that is stored must point at a row. None for: lineage_edge items (they point at
--    samples, aliquots, results and material that live in different tables; from_kind and to_kind name the kind where it matters, section 14
--    question 6), historian_value.tag (a tag is unit_tag, a dot and a signal name, so it is not a key of unit), and run.method_id and
--    analysis_request.method_id (a method is keyed by id and version, and the fixtures name the id alone).
--
-- 5. Types. Every instant is a TIMESTAMP in UTC (K14); TIMESTAMPTZ was rejected because it prints in the session's zone and the instants are
--    compared as written. The source's own zone is instrument.time_zone. Numbers are DOUBLE PRECISION: NUMERIC is DECIMAL(18,3) in DuckDB
--    and would round a measured value. hold_time and turnaround are never stored (section 5): they are the difference of two stored instants.
--
-- 6. State columns and closed lists are TEXT with CHECK (... IN (...)), never ENUM (section 13). A NULL state passes a CHECK, which is wanted:
--    a recorder that does not model a state stores NULL. Values with two words use an underscore (in_run, under_review).
--
-- 7. Columns beyond the card's required names are all nullable or have a default, because the fixtures insert with explicit column lists.
--
-- 8. Not in this file: the tables of the break-out extension (section 15: material_lot, equipment, deviation, quality_hold) and of the raw
--    device layer (section 16), which add tables and columns later without touching these; the view process_context (the as-of join is the
--    query reference/sql/queries/asof_join.sql); an index (none is needed at the fixture sizes, and ASOF and recursive queries do not use one).

CREATE TABLE unit (
  unit_id TEXT PRIMARY KEY,
  unit_tag TEXT UNIQUE,                       -- historian tag prefix: the tag U03.pH belongs to the unit whose unit_tag is U03
  area TEXT,
  bay TEXT,
  profile_id TEXT,                            -- bioreactor profile of the unit's bay (A065 to A068)
  working_volume DOUBLE PRECISION,
  working_volume_unit_ucum TEXT
);

CREATE TABLE operator (
  operator_id TEXT PRIMARY KEY,               -- pseudonymous
  role TEXT,
  shift TEXT,
  qualified BOOLEAN
);

CREATE TABLE qualification (
  qualification_id TEXT PRIMARY KEY,
  operator_id TEXT NOT NULL REFERENCES operator (operator_id),
  scope TEXT,
  level TEXT,                                 -- experienced or trainee (A072, A073)
  valid_from TIMESTAMP,
  valid_to TIMESTAMP
);

CREATE TABLE batch (
  batch_id TEXT PRIMARY KEY,
  unit_id TEXT NOT NULL REFERENCES unit (unit_id),
  process_mode TEXT,
  inoculated_at TIMESTAMP,
  harvested_at TIMESTAMP                      -- NULL while the batch is open (K6 reads it)
);

CREATE TABLE process_event (
  event_id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES batch (batch_id),
  unit_id TEXT NOT NULL REFERENCES unit (unit_id),
  type TEXT NOT NULL CHECK (type IN ('feed', 'temperature_shift', 'alarm', 'harvest', 'inoculation', 'medium_addition', 'equipment_use', 'unit_stopped', 'port_change')),
  occurred_at TIMESTAMP,                      -- valid time
  ingested_at TIMESTAMP,                      -- transaction time
  amount DOUBLE PRECISION,
  amount_unit_ucum TEXT,
  source TEXT CHECK (source IN ('rule', 'scheduled', 'scripted'))
);

CREATE TABLE method (
  method_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  kind TEXT,
  dilution_rule TEXT,
  effective_from TIMESTAMP,
  effective_to TIMESTAMP,
  PRIMARY KEY (method_id, version)            -- immutable once a run has used it (K13, a query)
);

CREATE TABLE sample (
  sample_id TEXT PRIMARY KEY,
  unit_id TEXT NOT NULL REFERENCES unit (unit_id),
  batch_id TEXT REFERENCES batch (batch_id),  -- NULL for a draw on a unit with no open batch (VR-020 holds it, so it must be storable)
  sampled_at TIMESTAMP,                       -- K3: here and nowhere else, NULL when two_clocks is off
  arrived_at TIMESTAMP,
  planned_at TIMESTAMP,
  operator_id TEXT REFERENCES operator (operator_id),
  volume_ul DOUBLE PRECISION,
  container TEXT CHECK (container IN ('open', 'closed')),
  label_method TEXT CHECK (label_method IN ('handwritten', 'preprinted_barcode', 'issued_at_draw')),
  state TEXT CHECK (state IN ('planned', 'drawn', 'in_transit', 'received', 'aliquoted', 'closed', 'quarantined', 'discarded', 'skipped'))
);

CREATE TABLE aliquot (
  aliquot_id TEXT PRIMARY KEY,
  sample_id TEXT NOT NULL REFERENCES sample (sample_id),
  storage_condition TEXT,
  volume_ul DOUBLE PRECISION,                 -- NULL where the volume is not known; the non-null ones sum to at most the sample's (K12, a query)
  state TEXT CHECK (state IN ('created', 'stored', 'in_use', 'consumed', 'discarded'))
);

CREATE TABLE analysis_request (
  request_id TEXT PRIMARY KEY,
  aliquot_id TEXT REFERENCES aliquot (aliquot_id),
  method_id TEXT,
  control_id TEXT,                            -- requests that share it measure the same control material; NULL for ordinary requests
  requested_at TIMESTAMP,
  deadline_at TIMESTAMP,
  state TEXT CHECK (state IN ('requested', 'accepted', 'queued', 'in_run', 'measured', 'under_review', 'released', 'rerun_pending', 'rejected', 'cancelled'))
);

CREATE TABLE instrument (
  instrument_id TEXT PRIMARY KEY,
  instrument_class TEXT,
  serial TEXT,
  interface TEXT,
  time_zone TEXT                              -- the zone the instrument's own clock is set to (K14: instants are UTC, the zone sits beside them)
);

CREATE TABLE instrument_state (
  instrument_state_id TEXT PRIMARY KEY,
  instrument_id TEXT NOT NULL REFERENCES instrument (instrument_id),
  calibration_ref TEXT,
  reagent_lot TEXT,
  qc_lot TEXT,
  software_version TEXT,
  valid_from TIMESTAMP,                       -- append-only snapshots with a validity interval; a new state is a new row
  valid_to TIMESTAMP
);

CREATE TABLE run (
  run_id TEXT PRIMARY KEY,
  instrument_id TEXT NOT NULL REFERENCES instrument (instrument_id),
  instrument_state_id TEXT REFERENCES instrument_state (instrument_state_id),  -- NULL unless instrument_state_snapshot is on
  method_id TEXT,
  method_version INTEGER,                     -- which version of the method this run used (K13 reads method_id alone, as the card does)
  started_at TIMESTAMP,                       -- run_started_at: after any setup (K7 reads it)
  ended_at TIMESTAMP,                         -- NULL while the run is going
  operator_id TEXT REFERENCES operator (operator_id),
  run_position TEXT,
  qc_outcome TEXT CHECK (qc_outcome IN ('qc_passed', 'qc_failed', 'over_range', 'over_range_unresolved'))
);

CREATE TABLE source_event (
  source_system TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,       -- K9
  received_at TIMESTAMP,
  PRIMARY KEY (source_system, source_event_id)  -- K9
);

CREATE TABLE result (
  result_id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES analysis_request (request_id),
  analyte TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  run_id TEXT NOT NULL REFERENCES run (run_id),   -- K2: a result cannot exist without a run
  value DOUBLE PRECISION,                     -- NULL for a run that ended over_range_unresolved; in unit_ucum
  unit_ucum TEXT,
  value_original DOUBLE PRECISION,            -- K11: the value and unit as received, beside the canonical pair above
  unit_original TEXT,
  dilution_factor DOUBLE PRECISION,
  measured_at TIMESTAMP NOT NULL,             -- K2: the end of the run, the one time that is always stored
  ingested_at TIMESTAMP,
  reviewed_at TIMESTAMP,
  available_at TIMESTAMP,                     -- transaction time: when this version became knowable
  state TEXT CHECK (state IN ('measured', 'held', 'quarantined', 'under_review', 'released', 'rejected', 'superseded')),
  supersedes_result_id TEXT,                  -- no foreign key: the edge superseded_by in lineage_edge is the checked record of a supersession
  source_system TEXT,
  source_event_id TEXT,
  FOREIGN KEY (source_system, source_event_id) REFERENCES source_event (source_system, source_event_id),
  UNIQUE (request_id, analyte, version)       -- K1
);

CREATE TABLE lineage_edge (
  edge_id TEXT PRIMARY KEY,
  from_item_id TEXT NOT NULL,                 -- edges point in the direction of derivation
  to_item_id TEXT NOT NULL,
  from_kind TEXT,                             -- the kind of item (sample, aliquot, result, batch, material_lot, equipment ...), where the id alone does not say
  to_kind TEXT,
  relation TEXT NOT NULL CHECK (relation IN ('harvested_from', 'split_into', 'pooled_into', 'drawn_as', 'aliquot_of', 'measured_in', 'superseded_by', 'rerun_of', 'consumed_in', 'seeded_from', 'used_in')),
  activity TEXT,
  occurred_at TIMESTAMP,
  available_at TIMESTAMP                      -- acyclicity is K10, a query
);

CREATE TABLE historian_value (
  tag TEXT NOT NULL,                          -- unit_tag, a dot and a signal name, for example U03.pH
  ts TIMESTAMP NOT NULL,                      -- valid time
  value DOUBLE PRECISION,
  quality TEXT,
  ingested_at TIMESTAMP                       -- transaction time: a late correction is a new row with a later ingested_at
);

CREATE TABLE audit_event (
  audit_id TEXT PRIMARY KEY,
  request_id TEXT,
  analyte TEXT,
  occurred_at TIMESTAMP,
  old_value DOUBLE PRECISION,
  new_value DOUBLE PRECISION,
  old_version INTEGER,
  new_version INTEGER,
  placed_by TEXT,
  reason TEXT
);

CREATE TABLE validation_finding (
  finding_id TEXT PRIMARY KEY,
  rule TEXT NOT NULL,                         -- VR-001 and so on
  target TEXT NOT NULL,                       -- the row it is about, written as table:key
  severity TEXT CHECK (severity IN ('info', 'warning', 'error')),
  action TEXT CHECK (action IN ('no-op', 'hold', 'quarantine', 'reject')),
  status TEXT CHECK (status IN ('open', 'resolved')),
  raised_at TIMESTAMP
);
