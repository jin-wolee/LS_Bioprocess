# ADR-0005: Data architecture as feature flags; presets A, B and C
- **Status:** Proposed
- **Date:** 2026-10-28

## Context

The comparison needs "data architectures" that a reader recognises, but a comparison of three monolithic architectures cannot say which mechanism made the difference. It also invites a straw man: a weak baseline and a strong favourite.

## Options

1. **Three hard-coded architectures.**
   - Pro: easy to explain.
   - Con: differences cannot be attributed to a mechanism; the weak option tends to be a caricature.
2. **Eight independent feature flags, with A, B and C as named presets, plus a one-flag-off ablation of C.**
   - Pro: every difference traces to a flag; presets stay readable; a scenario can cross flags and labelling methods.
   - Con: flags interact, and a one-at-a-time ablation does not reveal pair interactions.
3. **Full factorial sweep of all flag combinations as the default view.**
   - Pro: complete.
   - Con: 256 combinations are unreadable, and several are nonsensical because flags depend on each other.

## Decision

Proposed: option 2.

| Flag | On | Off | C minus this flag (expected outcome of a forced-error fixture) |
|---|---|---|---|
| `system_issued_id` | keys issued by the system at label creation | key typed or handwritten; transcription errors possible | label errors are no longer prevented; the duplicate and plausibility rules detect some, the rest are invisible |
| `two_clocks` | `sampled_at` and `measured_at` stored separately | one time stored, the measured time; `sampled_at` is not stored | a feed in the gap is no longer prevented (the join uses the measured time) and no hold-time or time-order rule can run; a clock offset is invisible |
| `available_at` | each row carries when it became knowable; as-of queries honour it | queries see rows as of now (time travel leaks) | a late correction leaks into an earlier decision and no as-of query can show it: invisible |
| `instrument_state_snapshot` | run links instrument, calibration and reagent lot | no link; at most a free-text analyzer name | an instrument or lot effect cannot be told from a process effect in the record; only a bridging study (`control_id`) detects it |
| `append_only_versions` | corrections, reruns and reprocessing create new versions | overwrite in place | reruns and edits overwrite and the earlier value is lost; `audit_trail` still detects that a change happened |
| `write_time_keys` | `sample_id`, `unit_id` and `batch_id` fixed at write time and never re-keyed; it does not own `sampled_at` | unit and batch attached later by a time join against the historian and batch record, using the stored time | re-keying and mis-joins become possible; only gross cases (no open batch at `sampled_at`) are detected |
| `ingest_idempotency` | source event id and idempotency key; duplicates and replays are no-ops | duplicates double count | duplicates and replays double count and are invisible in the data |
| `audit_trail` | who, when, what changed; operator id and qualification reference | no history; operator is free text or absent | a record cannot be attributed and no change history exists: invisible |

| Preset | Flags on | Labelling default | Limits deliberately kept |
|---|---|---|---|
| A manual/Excel | none | handwritten | transcription errors, one stored time (the measured time), overwrite, no instrument id |
| B LIMS-lite | `system_issued_id`, `ingest_idempotency`, `audit_trail` | pre-printed barcode | records the planned time (from the sampling plan that issues the label), not the actual draw time, which is an L2 labelling and L4 setting and not part of the `two_clocks` definition; reagent lot and calibration not linked; dilution factor typed by hand; joined to the historian by the one stored time, the measured time |
| C context-preserving | all eight | issued at draw | keys fixed at write time; process context as a versioned as-of projection; residual error remains (a correct barcode stuck on the wrong tube) |

- **B is not a straw man.** Barcodes, automatic capture and an audit trail are real features of simple laboratory systems; B's limits are the ones that remain after those exist.
- **Labelling method is an L2 setting** (handwritten, pre-printed barcode, issued at draw), independent of the L4 flags; scenarios may cross them.
- **Ablation:** C with exactly one flag off, for each flag. The last column of the flag table is the expectation for each ablation: prevented, detected or invisible.
- **Evaluation:** the gate is structural. In session S2 each flag has a forced-error fixture whose expected outcome is typed by hand before any run. Stochastic comparisons across at least 20 seeds (A103) are reported with intervals, never gated, and no test requires that C win.
- Operator id and qualification reference ride on `audit_trail`; a ninth flag would need its own proposed ADR.
- Orderings between presets must emerge from mechanisms. Making C win by construction is a non-goal, and C's residual errors are reported.

## Consequences

- Positive: attributable differences; a readable preset story; an ablation that shows which flags carry the effect.
- Negative: non-additive interactions can hide in a one-at-a-time ablation; the preset definitions are judgement calls, so the detection matrix (which flag prevents, detects or leaves invisible each error type) is labelled a design hypothesis until the experiments have run; more engine configuration to test.
- The "system of record" for routine in-process results is a site-dependent setting, not a flag (A056).

## Evidence

- A047 (label error rate, clinical proxy), A061 (standardised labelling protocols reduce errors, proxy; supports a system-issued-id lever, not a training lever).
- A036 (instrument results arrive as a file drop in practice), A032 and A033 (instrument bias and drift are unsourced assumptions), A049, S029, S030 (clock control and time zones), A056 (site-dependent system of record).
- A103 (minimum seeds for reported comparisons).
- Design source: `docs/design/simulation_spec.md`, data-architecture and experiments sections; time fields in `docs/design/data_model.md`, section 5.

## Author statement (verbatim, if any)

_None recorded._

## Decider's note

_(author only — Claude never writes here)_
