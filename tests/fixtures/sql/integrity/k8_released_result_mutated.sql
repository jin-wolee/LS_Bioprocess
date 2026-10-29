-- K8: a released result is immutable; a change creates a new version that supersedes it.
-- Compares before_result with result. The state of a released row may move to superseded, so state is not protected;
-- the value, its unit, the instant of measurement and the run are. A released row that vanished is also a violation.
SELECT b.result_id
FROM before_result b
LEFT JOIN result a ON a.result_id = b.result_id
WHERE b.state = 'released'
  AND (a.result_id IS NULL
       OR a.value IS DISTINCT FROM b.value
       OR a.unit_ucum IS DISTINCT FROM b.unit_ucum
       OR a.measured_at IS DISTINCT FROM b.measured_at
       OR a.run_id IS DISTINCT FROM b.run_id)
