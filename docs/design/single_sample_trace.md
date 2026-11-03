# Single-sample failure trace

Status: S2d deliverable (docs/prompts/20 Step 10). One sample of scenario SC3, followed through architectures A, B and C, with each architecture's answer to three questions an analyst would ask afterwards. Synthetic data only; nothing here describes a real system. The table is the output of the recorders, not typed prose.

## The question

SC3 scripts a bolus feed between a draw and its measurement (`docs/design/simulation_spec.md` section 7, A102); the routine decision of the day is a feed as well (A050, A194). A sample drawn just before a feed and measured after it is the case the flag `two_clocks` exists for (spec section 5, "feed in the gap"). The page shows that case row by row.

The three questions, asked after the end of the run, as the evaluator's analyst query asks them (`engine/src/evaluate/query.ts`):

1. Which unit was the sample drawn from? (`sample.unit_id`)
2. At which instant was it drawn? (`sample.sampled_at`; stored only when `two_clocks` is on, data_model K3)
3. Which process context applied at the draw: the feed epoch and the batch phase (data_model section 7, "Process context")?

Verdicts: `correct` (equal to the truth world), `wrong` (answered, different) and `unanswerable` (the record stores nothing to answer with). Nothing is guessed: an unanswerable cell is a field the architecture does not store.

## How the sample was picked

The rule was fixed before any recorded output was read and uses the truth log only: in SC3, the lowest `sample_id` (plain string order, the ids are zero-padded) whose interval `[sampled_at, run.started_at]` contains a feed of its own unit and batch; both ends count; `run.started_at` is the start of the first run of the request, the instant `hold_time` is measured to (data_model section 5). The rule is also stored in the fixture and tested on a hand-built log (`engine/tests/trace/single_sample_trace.test.ts`). The scenario is `sc03_feed_in_gap`, seed 1, 21 days of horizon, the same run as the SC3 tests.

## The trace

Rows are the real rows of the recorders for the sample (tables and columns of data_model section 2) after the validation rules and the review step; the truth column is the truth world. Stamps are seconds of the scenario, with the day (day 0 is a Monday) and the clock beside them. "Realised errors" are the errors the injector materialised on this sample in the architecture, at the production rates (spec section 6.1); the table lists them so a verdict is never blamed on the wrong cause.

<!-- trace-table:begin -->
| | truth | a_manual | b_lims_lite | c_context |
|---|---|---|---|---|
| flags on | - | none | `audit_trail`, `equipment_links`, `ingest_idempotency`, `system_issued_id` | `append_only_versions`, `audit_trail`, `available_at`, `equipment_links`, `ingest_idempotency`, `instrument_state_snapshot`, `material_lot_links`, `system_issued_id`, `two_clocks`, `write_time_keys` |
| labelling | - | handwritten | preprinted_barcode | issued_at_draw |
| **Q1 which unit?** (`sample.unit_id`) | U03 | U03: **correct** | U03: **correct** | U03: **correct** |
| **Q2 which `sampled_at`?** (`sample.sampled_at`) | 899841 (day 10 09:57:21) | null: **unanswerable** | null: **unanswerable** | 899841: **correct** |
| **Q3 which process context?** (feed epoch, batch phase) | {"batch_phase":"after_shift","feed_epoch":3} | {"batch_phase":"after_shift","feed_epoch":4}: **wrong** | {"batch_phase":"after_shift","feed_epoch":4}: **wrong** | {"batch_phase":"after_shift","feed_epoch":3}: **correct** |
| `sample.batch_id` | B-U03 | null | null | B-U03 |
| `sample.keys_fixed_at_write` | - | false | false | true |
| `sample.planned_at` | - | null | 899616 (day 10 09:53:36) | 899616 (day 10 09:53:36) |
| `run.started_at` | 900887 (day 10 10:14:47) | 900887 (day 10 10:14:47) | 900887 (day 10 10:14:47) | 900887 (day 10 10:14:47) |
| `result.measured_at` | 901157 (day 10 10:19:17) | 901157 (day 10 10:19:17) | 901157 (day 10 10:19:17) | 901157 (day 10 10:19:17) |
| `result.ingested_at` | - | null | 901157 (day 10 10:19:17) | 901157 (day 10 10:19:17) |
| `result.available_at` | - | null | null | 901157 (day 10 10:19:17) |
| `result.state` | - | null | null | null |
| process context: join basis | `sampled_at` | measured_at | measured_at | sampled_at |
| process context: join time | 899841 (day 10 09:57:21) | 901157 (day 10 10:19:17) | 901157 (day 10 10:19:17) | 899841 (day 10 09:57:21) |
| process context: `feed_epoch` | 3 | 4 | 4 | 3 |
| process context: `batch_phase` | after_shift | after_shift | after_shift | after_shift |
| realised errors on this sample | - | [{"detail":{"feed_at":900000},"sample_id":"U03-D10-2","type":"feed_in_gap"},{"detail":{},"sample_id":"U03-D10-2","type":"unattributable_record"}] | [{"detail":{"feed_at":900000},"sample_id":"U03-D10-2","type":"feed_in_gap"},{"detail":{"planned_at":899616,"sampled_at":899841},"sample_id":"U03-D10-2","type":"planned_vs_actual"}] | none |
<!-- trace-table:end -->

## Reading the table

- A and B store no `sampled_at` (spec section 5: with `two_clocks` off the one stored time is the measured time), so question 2 has no answer, and both join the process context by `measured_at`: the feed that fell into the gap is attached to the sample, and question 3 is answered with the wrong epoch. B keeps the planned time of the plan that issues its label (`planned_at`); that is the time of the plan, not of the draw, and the verdict does not count it as an answer (spec section 5, "Planned time").
- C stores `sampled_at`, joins by it with keys fixed at write, and answers all three correctly. This is a design hypothesis confirmed on one sample, not a rate: the share of requests affected is a stochastic result of experiment 1, reported and never gated.
- The page makes no claim about how often this happens or about an ordering of architectures.

## Regenerating and drift

- The fixture `tests/fixtures/trace/single_sample_trace.json` was created once by `node --no-maglev-escape-analysis engine/tests/support/trace_cli.ts`, which refuses to overwrite it. Its checksum is in `tests/fixtures/trace/CHECKSUMS.txt` (not in `tests/golden/CHECKSUMS.txt`, which belongs to the S1b goldens). A test compares the fixture with a fresh run of the recorders; a recorder change that moves these rows fails there and needs the author's approval, recorded in `docs/progress.md`.
- The block between the markers is written by `node --no-maglev-escape-analysis engine/tests/support/trace_table_cli.ts --write` from the fixture. A test regenerates it and fails when the page differs.

Links: [data_model](data_model.md), [simulation_spec](simulation_spec.md), [data_dictionary](data_dictionary.yaml).
