-- K7: an instrument does not process two runs at once. Half-open [started_at, ended_at): back-to-back runs are fine.
SELECT r1.instrument_id, r1.run_id AS first_run, r2.run_id AS second_run
FROM run r1
JOIN run r2 ON r1.instrument_id = r2.instrument_id AND r1.run_id < r2.run_id
WHERE r1.started_at < r2.ended_at
  AND r2.started_at < r1.ended_at
