-- One sample end to end, explicit column lists only (prompts/60_user_track.md, Card A, acceptance 5).
-- Columns outside the required names of Card A must be nullable or have defaults, so this file never names them.
-- Times are synthetic. Day 0 of the scenario is a Monday.
INSERT INTO unit (unit_id, unit_tag) VALUES ('U03', 'U03');
INSERT INTO operator (operator_id) VALUES ('OP-1');
INSERT INTO batch (batch_id, unit_id, inoculated_at, harvested_at) VALUES ('B-03-01', 'U03', TIMESTAMP '2030-01-07 00:00:00', NULL);
INSERT INTO process_event (event_id, batch_id, unit_id, type, occurred_at) VALUES ('E-1', 'B-03-01', 'U03', 'feed', TIMESTAMP '2030-01-07 09:00:00');
INSERT INTO method (method_id, version) VALUES ('M-GLU', 1);
INSERT INTO instrument (instrument_id) VALUES ('AN-1');
INSERT INTO instrument_state (instrument_state_id, instrument_id, valid_from, reagent_lot, calibration_ref) VALUES ('IS-1', 'AN-1', TIMESTAMP '2030-01-07 00:00:00', 'LOT-1', 'CAL-1');
INSERT INTO sample (sample_id, unit_id, batch_id, sampled_at, operator_id, volume_ul, state) VALUES ('S-1', 'U03', 'B-03-01', TIMESTAMP '2030-01-07 08:40:00', 'OP-1', 500, 'closed');
INSERT INTO aliquot (aliquot_id, sample_id, volume_ul, state) VALUES ('AL-1', 'S-1', 300, 'created');
INSERT INTO analysis_request (request_id, aliquot_id, method_id, state, control_id) VALUES ('RQ-1', 'AL-1', 'M-GLU', 'requested', NULL);
INSERT INTO run (run_id, instrument_id, instrument_state_id, method_id, started_at, ended_at, operator_id) VALUES ('RUN-1', 'AN-1', 'IS-1', 'M-GLU', TIMESTAMP '2030-01-07 09:15:00', TIMESTAMP '2030-01-07 09:25:00', 'OP-1');
INSERT INTO result (result_id, request_id, analyte, version, run_id, value, unit_ucum, measured_at, ingested_at, reviewed_at, available_at, state) VALUES ('RES-1', 'RQ-1', 'glucose', 1, 'RUN-1', 4.2, 'g/L', TIMESTAMP '2030-01-07 09:25:00', TIMESTAMP '2030-01-07 09:25:30', TIMESTAMP '2030-01-07 09:29:00', TIMESTAMP '2030-01-07 09:30:00', 'released');
INSERT INTO historian_value (tag, ts, value, ingested_at) VALUES ('U03.pH', TIMESTAMP '2030-01-07 08:39:00', 7.0, TIMESTAMP '2030-01-07 08:39:10');
INSERT INTO historian_value (tag, ts, value, ingested_at) VALUES ('U03.pH', TIMESTAMP '2030-01-07 09:00:00', 7.1, TIMESTAMP '2030-01-07 09:00:10');
INSERT INTO lineage_edge (edge_id, from_item_id, to_item_id, relation, occurred_at, available_at) VALUES ('ED-1', 'S-1', 'AL-1', 'aliquot_of', TIMESTAMP '2030-01-07 08:45:00', TIMESTAMP '2030-01-07 08:45:00');
INSERT INTO lineage_edge (edge_id, from_item_id, to_item_id, relation, occurred_at, available_at) VALUES ('ED-2', 'AL-1', 'RES-1', 'measured_in', TIMESTAMP '2030-01-07 09:25:00', TIMESTAMP '2030-01-07 09:30:00');
