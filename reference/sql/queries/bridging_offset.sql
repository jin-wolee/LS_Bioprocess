-- Card B3: the inter-instrument offset per analyte from control material measured on both instruments after a lot change, and the corrected
-- values of the target instrument. No evidence means no correction.
-- Written by AI under ADR-0022, clean-room from the specification (docs/prompts/60_user_track.md Card B3, data_model section 2 `control_id`); the author did not write it.
-- Acceptance: tests/user_track/test_queries.py. Standard SQL with named parameters.
--
-- Parameters:  $reference_instrument, $target_instrument, $changeover_at (timestamp).
-- Output:      request_id, analyte, version, instrument_id, value_raw, offset_applied, value_corrected, n_controls;
--              one row per result of the target instrument measured at or after $changeover_at.
--
-- Rule: offset(analyte) = mean over control ids of [mean(target values) - mean(reference values)], from results with measured_at >= $changeover_at,
-- the instrument reached through run.instrument_id, the control through analysis_request.control_id. value_corrected = value_raw - offset.
--
-- Decisions that are not obvious, and what was rejected:
-- 1. A mean of means: each control counts once, however many measurements it has (a pooled mean would weight a control by its replicates).
-- 2. A control counts only if it has at least one value on BOTH instruments after the changeover; a control seen on one side has no difference and
--    is left out. n_controls is the number of controls that did count, 0 where none did.
-- 3. No evidence, no correction: where an analyte has no counting control, offset_applied and value_corrected are NULL, never the raw value.
--    A NULL raw value (a run that ended over_range_unresolved has no number) stays NULL after the correction.
-- 4. Superseded versions. The latest version of each (request_id, analyte) is the one used, for the controls and for the output, so a
--    correction replaces the value it corrects instead of counting twice. Versions whose stored state is held, quarantined or rejected are
--    left out before the latest is taken (their value is not usable); a NULL state is kept. The output carries the version it used.
-- 5. Only the target instrument's results from the changeover on are returned, and only they are corrected; reference results and earlier
--    target results are not rows of the output at all (so they cannot be taken for corrected ones). Control requests measured on the target
--    are rows like any other result of it.
-- 6. The offset is applied as a subtraction: it is target minus reference, so the target reads high by that much.

WITH latest AS (
  SELECT request_id, analyte, version, run_id, value, measured_at
  FROM (
    SELECT request_id, analyte, version, run_id, value, measured_at,
           ROW_NUMBER() OVER (PARTITION BY request_id, analyte ORDER BY version DESC, available_at DESC) AS rn
    FROM result
    WHERE state IS NULL OR state NOT IN ('held', 'quarantined', 'rejected')
  ) ranked
  WHERE rn = 1
),
measured AS (
  SELECT l.request_id, l.analyte, l.version, ru.instrument_id, l.value, q.control_id
  FROM latest l
  JOIN run ru ON ru.run_id = l.run_id
  JOIN analysis_request q ON q.request_id = l.request_id
  WHERE l.measured_at >= $changeover_at
),
per_control AS (
  SELECT analyte, control_id,
         AVG(CASE WHEN instrument_id = $reference_instrument THEN value END) AS reference_mean,
         AVG(CASE WHEN instrument_id = $target_instrument THEN value END) AS target_mean
  FROM measured
  WHERE control_id IS NOT NULL
  GROUP BY analyte, control_id
),
offsets AS (
  SELECT analyte, AVG(target_mean - reference_mean) AS offset_value, COUNT(*) AS n_controls
  FROM per_control
  WHERE reference_mean IS NOT NULL AND target_mean IS NOT NULL
  GROUP BY analyte
)
SELECT m.request_id, m.analyte, m.version, m.instrument_id,
       m.value AS value_raw,
       o.offset_value AS offset_applied,
       m.value - o.offset_value AS value_corrected,
       COALESCE(o.n_controls, 0) AS n_controls
FROM measured m
LEFT JOIN offsets o ON o.analyte = m.analyte
WHERE m.instrument_id = $target_instrument
ORDER BY m.analyte, m.request_id
