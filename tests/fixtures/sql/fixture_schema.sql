-- A minimal schema for the acceptance tests of the author's three queries (tests/user_track/test_queries.py), used ONLY when reference/sql/schema.sql (the author's Card A) is absent.
-- It is not the canonical DDL: it holds the tables and columns that the fixtures of tests/fixtures/sql/ insert (the required names of Card A, data_model sections 2, 3 and 5)
-- and nothing else, so a query is tested against the same names whichever schema is loaded. Standard SQL, no constraint beyond keys and not-null on the keys.
CREATE TABLE unit (unit_id VARCHAR PRIMARY KEY, unit_tag VARCHAR);
CREATE TABLE operator (operator_id VARCHAR PRIMARY KEY);
CREATE TABLE batch (batch_id VARCHAR PRIMARY KEY, unit_id VARCHAR, inoculated_at TIMESTAMP, harvested_at TIMESTAMP);
CREATE TABLE method (method_id VARCHAR, version INTEGER, PRIMARY KEY (method_id, version));
CREATE TABLE instrument (instrument_id VARCHAR PRIMARY KEY);
CREATE TABLE instrument_state (instrument_state_id VARCHAR PRIMARY KEY, instrument_id VARCHAR, valid_from TIMESTAMP, reagent_lot VARCHAR, calibration_ref VARCHAR);
CREATE TABLE sample (sample_id VARCHAR PRIMARY KEY, unit_id VARCHAR, batch_id VARCHAR, sampled_at TIMESTAMP, operator_id VARCHAR, volume_ul DOUBLE, state VARCHAR);
CREATE TABLE aliquot (aliquot_id VARCHAR PRIMARY KEY, sample_id VARCHAR, volume_ul DOUBLE, state VARCHAR);
CREATE TABLE analysis_request (request_id VARCHAR PRIMARY KEY, aliquot_id VARCHAR, method_id VARCHAR, state VARCHAR, control_id VARCHAR);
CREATE TABLE run (run_id VARCHAR PRIMARY KEY, instrument_id VARCHAR, instrument_state_id VARCHAR, method_id VARCHAR, started_at TIMESTAMP, ended_at TIMESTAMP, operator_id VARCHAR);
CREATE TABLE result (
  result_id VARCHAR PRIMARY KEY, request_id VARCHAR NOT NULL, analyte VARCHAR NOT NULL, version INTEGER NOT NULL, run_id VARCHAR NOT NULL, value DOUBLE, unit_ucum VARCHAR,
  measured_at TIMESTAMP NOT NULL, ingested_at TIMESTAMP, reviewed_at TIMESTAMP, available_at TIMESTAMP, state VARCHAR, UNIQUE (request_id, analyte, version)
);
CREATE TABLE lineage_edge (edge_id VARCHAR PRIMARY KEY, from_item_id VARCHAR, to_item_id VARCHAR, relation VARCHAR, occurred_at TIMESTAMP, available_at TIMESTAMP);
CREATE TABLE historian_value (tag VARCHAR, ts TIMESTAMP, value DOUBLE, ingested_at TIMESTAMP);
