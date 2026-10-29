-- Good dataset for the integrity checks (data_model section 13, Card A acceptance 7): every check returns no row.
-- Explicit column lists only. Two units, a unit that re-uses itself after harvest (K6), back-to-back runs on one instrument (K7),
-- aliquots that sum exactly to the sample volume (K12), an acyclic diamond in the lineage (K10), a used method (K13)
-- and a released result (K8). Times are synthetic.
INSERT INTO unit (unit_id, unit_tag) VALUES ('U03', 'U03');
INSERT INTO unit (unit_id, unit_tag) VALUES ('U04', 'U04');
INSERT INTO operator (operator_id) VALUES ('OP-1');
INSERT INTO batch (batch_id, unit_id, inoculated_at, harvested_at) VALUES ('B-03-01', 'U03', TIMESTAMP '2030-01-07 00:00:00', TIMESTAMP '2030-01-21 00:00:00');
INSERT INTO batch (batch_id, unit_id, inoculated_at, harvested_at) VALUES ('B-03-02', 'U03', TIMESTAMP '2030-01-22 00:00:00', NULL);
INSERT INTO batch (batch_id, unit_id, inoculated_at, harvested_at) VALUES ('B-04-01', 'U04', TIMESTAMP '2030-01-08 00:00:00', NULL);
INSERT INTO method (method_id, version) VALUES ('M-GLU', 1);
INSERT INTO method (method_id, version) VALUES ('M-LAC', 1);
INSERT INTO instrument (instrument_id) VALUES ('AN-1');
INSERT INTO instrument (instrument_id) VALUES ('AN-2');
INSERT INTO instrument_state (instrument_state_id, instrument_id, valid_from, reagent_lot, calibration_ref) VALUES ('IS-1', 'AN-1', TIMESTAMP '2030-01-07 00:00:00', 'LOT-1', 'CAL-1');
INSERT INTO instrument_state (instrument_state_id, instrument_id, valid_from, reagent_lot, calibration_ref) VALUES ('IS-2', 'AN-2', TIMESTAMP '2030-01-07 00:00:00', 'LOT-1', 'CAL-2');
INSERT INTO sample (sample_id, unit_id, batch_id, sampled_at, operator_id, volume_ul, state) VALUES ('S-1', 'U03', 'B-03-01', TIMESTAMP '2030-01-07 08:40:00', 'OP-1', 500, 'closed');
INSERT INTO sample (sample_id, unit_id, batch_id, sampled_at, operator_id, volume_ul, state) VALUES ('S-2', 'U04', 'B-04-01', TIMESTAMP '2030-01-08 08:40:00', 'OP-1', 400, 'closed');
INSERT INTO aliquot (aliquot_id, sample_id, volume_ul, state) VALUES ('AL-1', 'S-1', 300, 'created');
INSERT INTO aliquot (aliquot_id, sample_id, volume_ul, state) VALUES ('AL-2', 'S-1', 200, 'created');
INSERT INTO aliquot (aliquot_id, sample_id, volume_ul, state) VALUES ('AL-3', 'S-2', 100, 'created');
INSERT INTO analysis_request (request_id, aliquot_id, method_id, state, control_id) VALUES ('RQ-1', 'AL-1', 'M-GLU', 'requested', NULL);
INSERT INTO analysis_request (request_id, aliquot_id, method_id, state, control_id) VALUES ('RQ-2', 'AL-3', 'M-GLU', 'requested', NULL);
INSERT INTO run (run_id, instrument_id, instrument_state_id, method_id, started_at, ended_at, operator_id) VALUES ('RUN-1', 'AN-1', 'IS-1', 'M-GLU', TIMESTAMP '2030-01-07 09:15:00', TIMESTAMP '2030-01-07 09:25:00', 'OP-1');
INSERT INTO run (run_id, instrument_id, instrument_state_id, method_id, started_at, ended_at, operator_id) VALUES ('RUN-2', 'AN-1', 'IS-1', 'M-GLU', TIMESTAMP '2030-01-07 09:25:00', TIMESTAMP '2030-01-07 09:35:00', 'OP-1');
INSERT INTO run (run_id, instrument_id, instrument_state_id, method_id, started_at, ended_at, operator_id) VALUES ('RUN-3', 'AN-2', 'IS-2', 'M-GLU', TIMESTAMP '2030-01-08 09:15:00', TIMESTAMP '2030-01-08 09:25:00', 'OP-1');
INSERT INTO result (result_id, request_id, analyte, version, run_id, value, unit_ucum, measured_at, ingested_at, reviewed_at, available_at, state) VALUES ('RES-1', 'RQ-1', 'glucose', 1, 'RUN-1', 4.2, 'g/L', TIMESTAMP '2030-01-07 09:25:00', TIMESTAMP '2030-01-07 09:25:30', TIMESTAMP '2030-01-07 09:29:00', TIMESTAMP '2030-01-07 09:30:00', 'released');
INSERT INTO result (result_id, request_id, analyte, version, run_id, value, unit_ucum, measured_at, ingested_at, reviewed_at, available_at, state) VALUES ('RES-2', 'RQ-2', 'glucose', 1, 'RUN-3', 3.9, 'g/L', TIMESTAMP '2030-01-08 09:25:00', TIMESTAMP '2030-01-08 09:25:30', TIMESTAMP '2030-01-08 09:29:00', TIMESTAMP '2030-01-08 09:30:00', 'released');
INSERT INTO lineage_edge (edge_id, from_item_id, to_item_id, relation, occurred_at, available_at) VALUES ('ED-1', 'S-1', 'AL-1', 'aliquot_of', TIMESTAMP '2030-01-07 08:45:00', TIMESTAMP '2030-01-07 08:45:00');
INSERT INTO lineage_edge (edge_id, from_item_id, to_item_id, relation, occurred_at, available_at) VALUES ('ED-2', 'AL-1', 'RES-1', 'measured_in', TIMESTAMP '2030-01-07 09:25:00', TIMESTAMP '2030-01-07 09:30:00');
INSERT INTO lineage_edge (edge_id, from_item_id, to_item_id, relation, occurred_at, available_at) VALUES ('ED-3', 'X1', 'X2', 'split_into', TIMESTAMP '2030-01-07 10:00:00', TIMESTAMP '2030-01-07 10:00:00');
INSERT INTO lineage_edge (edge_id, from_item_id, to_item_id, relation, occurred_at, available_at) VALUES ('ED-4', 'X1', 'X3', 'split_into', TIMESTAMP '2030-01-07 10:00:00', TIMESTAMP '2030-01-07 10:00:00');
INSERT INTO lineage_edge (edge_id, from_item_id, to_item_id, relation, occurred_at, available_at) VALUES ('ED-5', 'X2', 'X4', 'pooled_into', TIMESTAMP '2030-01-07 11:00:00', TIMESTAMP '2030-01-07 11:00:00');
INSERT INTO lineage_edge (edge_id, from_item_id, to_item_id, relation, occurred_at, available_at) VALUES ('ED-6', 'X3', 'X4', 'pooled_into', TIMESTAMP '2030-01-07 11:00:00', TIMESTAMP '2030-01-07 11:00:00');
