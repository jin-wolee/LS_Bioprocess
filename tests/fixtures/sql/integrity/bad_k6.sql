-- Applied after good.sql: a second batch opens on U03 while B-03-01 is still open (K6).
INSERT INTO batch (batch_id, unit_id, inoculated_at, harvested_at) VALUES ('B-03-X', 'U03', TIMESTAMP '2030-01-10 00:00:00', NULL);
