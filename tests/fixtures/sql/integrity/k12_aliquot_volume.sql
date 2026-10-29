-- K12: the non-null aliquot volumes of a sample sum to at most the sample volume (volume budget, A057 and A207).
-- A null volume means not known and is left out of the sum. Returns the sample_id, its volume and the sum.
SELECT s.sample_id, s.volume_ul AS sample_volume_ul, a.total_ul AS aliquot_total_ul
FROM sample s
JOIN (SELECT sample_id, SUM(volume_ul) AS total_ul FROM aliquot WHERE volume_ul IS NOT NULL GROUP BY sample_id) a ON a.sample_id = s.sample_id
WHERE s.volume_ul IS NOT NULL
  AND a.total_ul > s.volume_ul
