-- Applied after good.sql: the draw time of a sample is overwritten (K5).
UPDATE sample SET sampled_at = TIMESTAMP '2030-01-07 09:00:00' WHERE sample_id = 'S-1';
