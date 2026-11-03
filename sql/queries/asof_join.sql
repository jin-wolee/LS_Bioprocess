-- Card B1: for every result known at a decision time, the historian value that was effective at sampled_at and known at that time.
-- Written by AI under ADR-0022, clean-room from the specification (data_model section 5, "Bitemporal and as-of rule"); the author did not write it.
-- Acceptance: tests/user_track/test_queries.py. DuckDB: ASOF JOIN and named parameters.
--
-- Parameters:  $decision_time (timestamp), $max_age_s (integer; a match older than this many seconds gives NULL).
-- Output:      request_id, analyte, version, tag, ctx_ts, ctx_value; one row per (request_id, analyte) known at the decision time and per tag
--              of its unit (a tag belongs to a unit when it is unit_tag, a dot and a signal name).
--
-- Decisions that are not obvious, and what was rejected:
-- 1. The join time is sampled_at, reached through request, aliquot and sample. measured_at is never used: a result whose sample has no
--    sampled_at (two_clocks off) gets NULL context, because NULL >= ts matches nothing. Falling back to measured_at was rejected, it is
--    the leak this model exists to expose.
-- 2. Which result version: per (request_id, analyte) the highest version, then the greatest available_at, among the versions with
--    available_at <= $decision_time (the boundary is <=). A future version never shows before its available_at.
-- 3. State filter. Versions whose stored state is held, quarantined or rejected are not knowable and are left out BEFORE the latest is
--    taken, so a quarantined correction falls back to the version before it (section 5 says "not held, quarantined or rejected"). Every
--    other state is kept, including superseded: the state column holds the state now, and a version superseded later was still the
--    latest one known at an earlier decision time. A NULL state (a recorder that does not model it) is kept. The state is the stored
--    one, not a state as of the decision time, because the schema keeps no state history.
-- 4. A NULL available_at or ingested_at (an architecture that stores no such stamp) is not filtered out: the row is seen at every decision
--    time. That is the leak section 5 describes ("queries see everything as of now"), made visible instead of hidden; a strict reading, which
--    would return no row at all for such a store, was rejected. Flipping it is one line in each of the two filters.
-- 5. Historian: only rows with ingested_at <= $decision_time, and per (tag, ts) the latest ingested one, so a late correction replaces the
--    first value only from the instant it was ingested. The value at sampled_at is the last (tag, ts) at or before it (ASOF, inclusive).
-- 6. Tags come from the whole historian table, not from the rows known at the decision time: a tag that has no row yet gives a row with
--    NULL context, not a missing row.
-- 7. Age is sampled_at minus ts in seconds, taken with epoch() so that fractions of a second count; age <= $max_age_s keeps the match
--    (60 s old with $max_age_s = 60 is kept). A match that is too old gives NULL in both ctx_ts and ctx_value.
-- 8. Rejected: QUALIFY and DISTINCT ON (they work in DuckDB or Postgres, not in both); ROW_NUMBER() in a subquery works in both.

WITH known AS (
  SELECT request_id, analyte, version
  FROM (
    SELECT request_id, analyte, version,
           ROW_NUMBER() OVER (PARTITION BY request_id, analyte ORDER BY version DESC, available_at DESC) AS rn
    FROM result
    WHERE (available_at IS NULL OR available_at <= $decision_time)
      AND (state IS NULL OR state NOT IN ('held', 'quarantined', 'rejected'))
  ) latest
  WHERE rn = 1
),
subject AS (
  SELECT k.request_id, k.analyte, k.version, s.sampled_at, u.unit_tag
  FROM known k
  JOIN analysis_request q ON q.request_id = k.request_id
  JOIN aliquot a ON a.aliquot_id = q.aliquot_id
  JOIN sample s ON s.sample_id = a.sample_id
  JOIN unit u ON u.unit_id = s.unit_id
),
wanted AS (
  SELECT sb.request_id, sb.analyte, sb.version, sb.sampled_at, t.tag
  FROM subject sb
  JOIN (SELECT DISTINCT tag FROM historian_value) t
    ON LEFT(t.tag, LENGTH(sb.unit_tag) + 1) = sb.unit_tag || '.'
),
hist AS (
  SELECT tag, ts, value
  FROM (
    SELECT tag, ts, value,
           ROW_NUMBER() OVER (PARTITION BY tag, ts ORDER BY ingested_at DESC) AS rn
    FROM historian_value
    WHERE ingested_at IS NULL OR ingested_at <= $decision_time
  ) latest
  WHERE rn = 1
)
SELECT w.request_id, w.analyte, w.version, w.tag,
       CASE WHEN EPOCH(w.sampled_at) - EPOCH(h.ts) <= $max_age_s THEN h.ts END AS ctx_ts,
       CASE WHEN EPOCH(w.sampled_at) - EPOCH(h.ts) <= $max_age_s THEN h.value END AS ctx_value
FROM wanted w
ASOF LEFT JOIN hist h
  ON h.tag = w.tag AND w.sampled_at >= h.ts
ORDER BY w.request_id, w.analyte, w.tag
