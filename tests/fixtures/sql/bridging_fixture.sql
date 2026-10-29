-- Hand fixture of Card B3 (prompts/60_user_track.md): the inter-instrument offset per analyte from control material measured on both instruments after a lot change, and the
-- corrected values of the target instrument. Parameters of the test: $reference_instrument = 'REF', $target_instrument = 'TGT', $changeover_at = 2030-01-10 00:00:00.
-- Explicit column lists only; synthetic times. Expected answers are in expected_bridging.csv.
--
-- Glucose controls (analysis_request.control_id), measured on or after the changeover:
--   C1  reference REF [10.0, 10.2]  target TGT [10.6, 10.8]    per-control difference = mean(10.6, 10.8) - mean(10.0, 10.2) = 10.7 - 10.1 = 0.6
--   C2  reference REF [5.0]         target TGT [5.4]           per-control difference = 5.4 - 5.0 = 0.4
--   offset(glucose) = mean over controls of the differences = (0.6 + 0.4) / 2 = 0.5, n_controls = 2   (a pooled mean of all values would weight C1 twice: 0.5333...; the rule is a mean of means)
-- Ordinary target results on or after the changeover are corrected by minus the offset: 8.0 - 0.5 = 7.5 and 6.5 - 0.5 = 6.0.
-- Left as they are: a target result before the changeover (RQ-O3, 9.0) and a reference result (RQ-O4, 7.0).
-- A second analyte, lactate, has no control material: its target result after the changeover (RQ-O5, 3.0) gets NULL offset_applied and NULL value_corrected, never the raw value.
-- All requests share one sample and one aliquot (many requests may test one aliquot); control_id is NULL for the ordinary requests.
INSERT INTO unit (unit_id, unit_tag) VALUES ('U03', 'U03');
INSERT INTO operator (operator_id) VALUES ('OP-1');
INSERT INTO batch (batch_id, unit_id, inoculated_at, harvested_at) VALUES ('B-03-01', 'U03', TIMESTAMP '2030-01-07 00:00:00', NULL);
INSERT INTO method (method_id, version) VALUES ('M-1', 1);
INSERT INTO instrument (instrument_id) VALUES ('REF');
INSERT INTO instrument (instrument_id) VALUES ('TGT');
INSERT INTO sample (sample_id, unit_id, batch_id, sampled_at, operator_id, volume_ul, state) VALUES ('S-B', 'U03', 'B-03-01', TIMESTAMP '2030-01-09 08:00:00', 'OP-1', 5000, 'closed');
INSERT INTO aliquot (aliquot_id, sample_id, volume_ul, state) VALUES ('AL-B', 'S-B', 4000, 'created');
INSERT INTO run (run_id, instrument_id, instrument_state_id, method_id, started_at, ended_at, operator_id) VALUES ('RUN-REF', 'REF', NULL, 'M-1', TIMESTAMP '2030-01-10 09:00:00', TIMESTAMP '2030-01-10 09:10:00', 'OP-1');
INSERT INTO run (run_id, instrument_id, instrument_state_id, method_id, started_at, ended_at, operator_id) VALUES ('RUN-TGT-PRE', 'TGT', NULL, 'M-1', TIMESTAMP '2030-01-09 09:00:00', TIMESTAMP '2030-01-09 09:10:00', 'OP-1');
INSERT INTO run (run_id, instrument_id, instrument_state_id, method_id, started_at, ended_at, operator_id) VALUES ('RUN-TGT-POST', 'TGT', NULL, 'M-1', TIMESTAMP '2030-01-10 10:00:00', TIMESTAMP '2030-01-10 10:10:00', 'OP-1');
-- requests: control requests (control_id C1 or C2), then the ordinary ones
INSERT INTO analysis_request (request_id, aliquot_id, method_id, state, control_id) VALUES ('RQ-C1-R1', 'AL-B', 'M-1', 'released', 'C1');
INSERT INTO analysis_request (request_id, aliquot_id, method_id, state, control_id) VALUES ('RQ-C1-R2', 'AL-B', 'M-1', 'released', 'C1');
INSERT INTO analysis_request (request_id, aliquot_id, method_id, state, control_id) VALUES ('RQ-C1-T1', 'AL-B', 'M-1', 'released', 'C1');
INSERT INTO analysis_request (request_id, aliquot_id, method_id, state, control_id) VALUES ('RQ-C1-T2', 'AL-B', 'M-1', 'released', 'C1');
INSERT INTO analysis_request (request_id, aliquot_id, method_id, state, control_id) VALUES ('RQ-C2-R1', 'AL-B', 'M-1', 'released', 'C2');
INSERT INTO analysis_request (request_id, aliquot_id, method_id, state, control_id) VALUES ('RQ-C2-T1', 'AL-B', 'M-1', 'released', 'C2');
INSERT INTO analysis_request (request_id, aliquot_id, method_id, state, control_id) VALUES ('RQ-O1', 'AL-B', 'M-1', 'released', NULL);
INSERT INTO analysis_request (request_id, aliquot_id, method_id, state, control_id) VALUES ('RQ-O2', 'AL-B', 'M-1', 'released', NULL);
INSERT INTO analysis_request (request_id, aliquot_id, method_id, state, control_id) VALUES ('RQ-O3', 'AL-B', 'M-1', 'released', NULL);
INSERT INTO analysis_request (request_id, aliquot_id, method_id, state, control_id) VALUES ('RQ-O4', 'AL-B', 'M-1', 'released', NULL);
INSERT INTO analysis_request (request_id, aliquot_id, method_id, state, control_id) VALUES ('RQ-O5', 'AL-B', 'M-1', 'released', NULL);
-- results: one version each; measured_at on or after the changeover (2030-01-10 00:00:00) except RQ-O3
INSERT INTO result (result_id, request_id, analyte, version, run_id, value, unit_ucum, measured_at, ingested_at, reviewed_at, available_at, state) VALUES ('RES-C1-R1', 'RQ-C1-R1', 'glucose', 1, 'RUN-REF', 10.0, 'g/L', TIMESTAMP '2030-01-10 09:10:00', TIMESTAMP '2030-01-10 09:11:00', NULL, TIMESTAMP '2030-01-10 09:12:00', 'released');
INSERT INTO result (result_id, request_id, analyte, version, run_id, value, unit_ucum, measured_at, ingested_at, reviewed_at, available_at, state) VALUES ('RES-C1-R2', 'RQ-C1-R2', 'glucose', 1, 'RUN-REF', 10.2, 'g/L', TIMESTAMP '2030-01-10 09:10:00', TIMESTAMP '2030-01-10 09:11:00', NULL, TIMESTAMP '2030-01-10 09:12:00', 'released');
INSERT INTO result (result_id, request_id, analyte, version, run_id, value, unit_ucum, measured_at, ingested_at, reviewed_at, available_at, state) VALUES ('RES-C1-T1', 'RQ-C1-T1', 'glucose', 1, 'RUN-TGT-POST', 10.6, 'g/L', TIMESTAMP '2030-01-10 10:10:00', TIMESTAMP '2030-01-10 10:11:00', NULL, TIMESTAMP '2030-01-10 10:12:00', 'released');
INSERT INTO result (result_id, request_id, analyte, version, run_id, value, unit_ucum, measured_at, ingested_at, reviewed_at, available_at, state) VALUES ('RES-C1-T2', 'RQ-C1-T2', 'glucose', 1, 'RUN-TGT-POST', 10.8, 'g/L', TIMESTAMP '2030-01-10 10:10:00', TIMESTAMP '2030-01-10 10:11:00', NULL, TIMESTAMP '2030-01-10 10:12:00', 'released');
INSERT INTO result (result_id, request_id, analyte, version, run_id, value, unit_ucum, measured_at, ingested_at, reviewed_at, available_at, state) VALUES ('RES-C2-R1', 'RQ-C2-R1', 'glucose', 1, 'RUN-REF', 5.0, 'g/L', TIMESTAMP '2030-01-10 09:10:00', TIMESTAMP '2030-01-10 09:11:00', NULL, TIMESTAMP '2030-01-10 09:12:00', 'released');
INSERT INTO result (result_id, request_id, analyte, version, run_id, value, unit_ucum, measured_at, ingested_at, reviewed_at, available_at, state) VALUES ('RES-C2-T1', 'RQ-C2-T1', 'glucose', 1, 'RUN-TGT-POST', 5.4, 'g/L', TIMESTAMP '2030-01-10 10:10:00', TIMESTAMP '2030-01-10 10:11:00', NULL, TIMESTAMP '2030-01-10 10:12:00', 'released');
INSERT INTO result (result_id, request_id, analyte, version, run_id, value, unit_ucum, measured_at, ingested_at, reviewed_at, available_at, state) VALUES ('RES-O1', 'RQ-O1', 'glucose', 1, 'RUN-TGT-POST', 8.0, 'g/L', TIMESTAMP '2030-01-10 10:10:00', TIMESTAMP '2030-01-10 10:11:00', NULL, TIMESTAMP '2030-01-10 10:12:00', 'released');
INSERT INTO result (result_id, request_id, analyte, version, run_id, value, unit_ucum, measured_at, ingested_at, reviewed_at, available_at, state) VALUES ('RES-O2', 'RQ-O2', 'glucose', 1, 'RUN-TGT-POST', 6.5, 'g/L', TIMESTAMP '2030-01-10 10:10:00', TIMESTAMP '2030-01-10 10:11:00', NULL, TIMESTAMP '2030-01-10 10:12:00', 'released');
INSERT INTO result (result_id, request_id, analyte, version, run_id, value, unit_ucum, measured_at, ingested_at, reviewed_at, available_at, state) VALUES ('RES-O3', 'RQ-O3', 'glucose', 1, 'RUN-TGT-PRE', 9.0, 'g/L', TIMESTAMP '2030-01-09 09:10:00', TIMESTAMP '2030-01-09 09:11:00', NULL, TIMESTAMP '2030-01-09 09:12:00', 'released');
INSERT INTO result (result_id, request_id, analyte, version, run_id, value, unit_ucum, measured_at, ingested_at, reviewed_at, available_at, state) VALUES ('RES-O4', 'RQ-O4', 'glucose', 1, 'RUN-REF', 7.0, 'g/L', TIMESTAMP '2030-01-10 09:10:00', TIMESTAMP '2030-01-10 09:11:00', NULL, TIMESTAMP '2030-01-10 09:12:00', 'released');
INSERT INTO result (result_id, request_id, analyte, version, run_id, value, unit_ucum, measured_at, ingested_at, reviewed_at, available_at, state) VALUES ('RES-O5', 'RQ-O5', 'lactate', 1, 'RUN-TGT-POST', 3.0, 'g/L', TIMESTAMP '2030-01-10 10:10:00', TIMESTAMP '2030-01-10 10:11:00', NULL, TIMESTAMP '2030-01-10 10:12:00', 'released');
