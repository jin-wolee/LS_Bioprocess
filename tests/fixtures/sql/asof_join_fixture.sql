-- Hand fixture of Card B1 (docs/prompts/60_user_track.md): the as-of join of results to the historian value effective at sampled_at and known at the decision time.
-- Explicit column lists only; synthetic times (2030-01-07 is a Monday). Expected answers are in expected_asof_join.csv, computed by hand below.
--
-- Unit U03 (unit_tag U03) has one historian tag, U03.pH, with four rows (ts, value, ingested_at):
--   (08:30:00, 1.0, 08:30:10)  (08:39:00, 2.0, 08:39:10)  (08:39:00, 2.5, 10:30:00, a late correction of the 08:39 value)  (09:00:00, 5.0, 09:00:10)
-- RQ-1: sample S-1 drawn 08:40:00, measured 09:25:00. Version 1 (4.2) is available at 09:30:00; version 2 (4.3, a correction) at 10:30:00.
-- RQ-2: sample S-2 has no sampled_at (two_clocks off); its only version is available at 09:31:00. It must get a NULL context, never a measured_at match.
--
-- Arithmetic. The value effective at sampled_at 08:40:00 is the last row with ts <= 08:40:00, i.e. the 08:39:00 row. (A join on measured_at 09:25:00 would reach the 09:00:00 row,
-- 5.0, which is the wrong answer.) Which ingestion of the 08:39:00 row is known depends on the decision time D:
--   D <  10:30:00  the correction is not ingested: 2.0       D >= 10:30:00 (the boundary is <=)  the latest ingested row of (tag, ts) is the correction: 2.5
-- Which result version is known: the latest with available_at <= D.
--   D = 09:00:00  none (09:30:00 and 09:31:00 are later)               D = 10:00:00 and 10:29:59  RQ-1 version 1 (09:30:00 <= D < 10:30:00), RQ-2 version 1
--   D = 10:30:00 and 11:00:00  RQ-1 version 2 (10:30:00 <= D), RQ-2 version 1
-- The age of the match is sampled_at - ts = 08:40:00 - 08:39:00 = 60 s: max_age_s = 30 gives a NULL ctx_value, max_age_s = 60 keeps it (60 <= 60).
INSERT INTO unit (unit_id, unit_tag) VALUES ('U03', 'U03');
INSERT INTO operator (operator_id) VALUES ('OP-1');
INSERT INTO batch (batch_id, unit_id, inoculated_at, harvested_at) VALUES ('B-03-01', 'U03', TIMESTAMP '2030-01-07 00:00:00', NULL);
INSERT INTO method (method_id, version) VALUES ('M-GLU', 1);
INSERT INTO instrument (instrument_id) VALUES ('AN-1');
INSERT INTO instrument_state (instrument_state_id, instrument_id, valid_from, reagent_lot, calibration_ref) VALUES ('IS-1', 'AN-1', TIMESTAMP '2030-01-07 00:00:00', 'LOT-1', 'CAL-1');
INSERT INTO sample (sample_id, unit_id, batch_id, sampled_at, operator_id, volume_ul, state) VALUES ('S-1', 'U03', 'B-03-01', TIMESTAMP '2030-01-07 08:40:00', 'OP-1', 500, 'closed');
INSERT INTO sample (sample_id, unit_id, batch_id, sampled_at, operator_id, volume_ul, state) VALUES ('S-2', 'U03', 'B-03-01', NULL, 'OP-1', 500, 'closed');
INSERT INTO aliquot (aliquot_id, sample_id, volume_ul, state) VALUES ('AL-1', 'S-1', 300, 'created');
INSERT INTO aliquot (aliquot_id, sample_id, volume_ul, state) VALUES ('AL-2', 'S-2', 300, 'created');
INSERT INTO analysis_request (request_id, aliquot_id, method_id, state, control_id) VALUES ('RQ-1', 'AL-1', 'M-GLU', 'released', NULL);
INSERT INTO analysis_request (request_id, aliquot_id, method_id, state, control_id) VALUES ('RQ-2', 'AL-2', 'M-GLU', 'released', NULL);
INSERT INTO run (run_id, instrument_id, instrument_state_id, method_id, started_at, ended_at, operator_id) VALUES ('RUN-1', 'AN-1', 'IS-1', 'M-GLU', TIMESTAMP '2030-01-07 09:15:00', TIMESTAMP '2030-01-07 09:25:00', 'OP-1');
INSERT INTO run (run_id, instrument_id, instrument_state_id, method_id, started_at, ended_at, operator_id) VALUES ('RUN-2', 'AN-1', 'IS-1', 'M-GLU', TIMESTAMP '2030-01-07 09:16:00', TIMESTAMP '2030-01-07 09:26:00', 'OP-1');
INSERT INTO result (result_id, request_id, analyte, version, run_id, value, unit_ucum, measured_at, ingested_at, reviewed_at, available_at, state) VALUES ('RES-1', 'RQ-1', 'glucose', 1, 'RUN-1', 4.2, 'g/L', TIMESTAMP '2030-01-07 09:25:00', TIMESTAMP '2030-01-07 09:25:30', NULL, TIMESTAMP '2030-01-07 09:30:00', 'released');
INSERT INTO result (result_id, request_id, analyte, version, run_id, value, unit_ucum, measured_at, ingested_at, reviewed_at, available_at, state) VALUES ('RES-2', 'RQ-1', 'glucose', 2, 'RUN-1', 4.3, 'g/L', TIMESTAMP '2030-01-07 09:25:00', TIMESTAMP '2030-01-07 10:30:00', NULL, TIMESTAMP '2030-01-07 10:30:00', 'released');
INSERT INTO result (result_id, request_id, analyte, version, run_id, value, unit_ucum, measured_at, ingested_at, reviewed_at, available_at, state) VALUES ('RES-3', 'RQ-2', 'glucose', 1, 'RUN-2', 5.0, 'g/L', TIMESTAMP '2030-01-07 09:26:00', TIMESTAMP '2030-01-07 09:26:30', NULL, TIMESTAMP '2030-01-07 09:31:00', 'released');
INSERT INTO historian_value (tag, ts, value, ingested_at) VALUES ('U03.pH', TIMESTAMP '2030-01-07 08:30:00', 1.0, TIMESTAMP '2030-01-07 08:30:10');
INSERT INTO historian_value (tag, ts, value, ingested_at) VALUES ('U03.pH', TIMESTAMP '2030-01-07 08:39:00', 2.0, TIMESTAMP '2030-01-07 08:39:10');
INSERT INTO historian_value (tag, ts, value, ingested_at) VALUES ('U03.pH', TIMESTAMP '2030-01-07 08:39:00', 2.5, TIMESTAMP '2030-01-07 10:30:00');
INSERT INTO historian_value (tag, ts, value, ingested_at) VALUES ('U03.pH', TIMESTAMP '2030-01-07 09:00:00', 5.0, TIMESTAMP '2030-01-07 09:00:10');
