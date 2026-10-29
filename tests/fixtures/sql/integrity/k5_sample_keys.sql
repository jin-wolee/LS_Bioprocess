-- K5: sample_id, unit_id, batch_id and sampled_at are never re-keyed or overwritten (flag write_time_keys).
-- Compares two snapshots: before_sample (taken after the good dataset loaded) and sample (now).
-- A row present in both with a different protected column, or a row that vanished, is a violation. Returns the violating sample_id.
SELECT b.sample_id
FROM before_sample b
LEFT JOIN sample a ON a.sample_id = b.sample_id
WHERE a.sample_id IS NULL
   OR a.unit_id IS DISTINCT FROM b.unit_id
   OR a.batch_id IS DISTINCT FROM b.batch_id
   OR a.sampled_at IS DISTINCT FROM b.sampled_at
