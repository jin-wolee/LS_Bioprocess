-- Applied after good.sql: a run overlaps RUN-1 on the same instrument (K7).
INSERT INTO run (run_id, instrument_id, instrument_state_id, method_id, started_at, ended_at, operator_id) VALUES ('RUN-X', 'AN-1', 'IS-1', 'M-GLU', TIMESTAMP '2030-01-07 09:20:00', TIMESTAMP '2030-01-07 09:30:00', 'OP-1');
