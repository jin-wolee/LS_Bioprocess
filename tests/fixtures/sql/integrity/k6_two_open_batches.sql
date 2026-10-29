-- K6: a unit has at most one open batch at any time, so the intervals [inoculated_at, harvested_at) of two batches on one unit
-- must not overlap; an open batch (harvested_at NULL) runs to the end of time. Rows without inoculated_at cannot be compared.
SELECT b1.unit_id, b1.batch_id AS first_batch, b2.batch_id AS second_batch
FROM batch b1
JOIN batch b2 ON b1.unit_id = b2.unit_id AND b1.batch_id < b2.batch_id
WHERE b1.inoculated_at < COALESCE(b2.harvested_at, TIMESTAMP '9999-12-31 00:00:00')
  AND b2.inoculated_at < COALESCE(b1.harvested_at, TIMESTAMP '9999-12-31 00:00:00')
