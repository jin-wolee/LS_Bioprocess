# ADR-0017: Ninth flag: material lot links (amends ADR-0005)
- **Status:** Accepted
- **Date:** 2026-10-30
## Context

Session S3 builds the first break-out event, a contamination, and its scenario SC12 (ADR-0013; spec section 11.5). After one reactor shows a signal, the investigation walks back through the record (data_model section 15.4). Direction 3 of that walk-back goes one step back from the batch to its seed, medium and feed lots and then forward to every other batch that used them. It needs two kinds of edges in the record, `consumed_in` (a material lot to the `process_event` that used it) and `seeded_from` (data_model section 15.1), and those exist only if the recorder stores the lot id when a reactor is inoculated or a medium or feed is added.

None of the eight flags of ADR-0005 covers this. `instrument_state_snapshot` links an analyzer run to its calibration and reagent lot, not a reactor to the lots it consumed; `write_time_keys` fixes the sample, unit and batch keys. ADR-0013 left the question open ("either architectures A and B store lot links as free text, or a ninth flag is added") and asked for a decision when SC12 is built. ADR-0005 says that a ninth flag needs its own proposed ADR.

## Options

1. **A ninth flag, `material_lot_links`.**
   - Pro: every difference still traces to a flag; C with this flag off joins the one-flag-off ablation, so the effect of lot links on SC12 can be shown alone; B's limit is stated, not implied.
   - Con: one more flag in every architecture key, preset table and UI control; outputs that list the flags gain an entry.
2. **Widen `write_time_keys` to cover the lot id too.**
   - Pro: the flag count stays at eight.
   - Con: one flag then carries two mechanisms (re-keying and lot links), so its ablation cannot say which one moved a metric; the flag's meaning drifts from its table row.
3. **No flag: A and B keep lots as free text, C stores the edges.**
   - Pro: the least code.
   - Con: breaks "every difference traces to a flag" (ADR-0005); no ablation is possible; C finds the siblings by construction, which ADR-0005 lists as a non-goal.

## Decision

Proposed: option 1.

| Flag | On | Off | C minus this flag (expected outcome of a forced-error fixture) |
|---|---|---|---|
| `material_lot_links` | an inoculation or a medium or feed addition stores the lot id as a key, and the recorder writes the `consumed_in` and `seeded_from` edges | no edge; at most a free-text lot name in the batch record, which a query cannot join | the sibling walk-back (direction 3) cannot run from the record: the other batches that shared a lot are invisible to it |

- Presets: A off; B off (a lot used by a reactor is a batch-record fact, and B already keeps reagent lots unlinked; B's limits are the ones that remain after barcodes, automatic capture and an audit trail); C on, so C has all nine flags.
- The flag is read only where material lots exist, that is with the break-out extension (SC12). With no extension nothing reads it, so no recorded value changes: the S1 goldens, the S2 forced-error cells and the experiment results stand. Outputs that list the flags of an architecture gain one entry; S3 checks which ones and states it.
- S3 adds a forced-error fixture typed by hand before any run: a contaminated batch that shares a medium lot with a clean batch; with the flag on, direction 3 reaches the clean batch, with it off it does not.
- VR-021 (an inoculation or addition names a lot but no `consumed_in` edge exists, data_model section 15.5) runs only with the flag on.
- A wrong lot recorded (a typo in a lot id) is not an injector error type now; it is added only if SC12 shows a need (ADR-0013, YAGNI).

## Consequences

- Positive: SC12 results stay attributable to flags; the ablation shows what lot links alone buy; the preset story keeps B's limits explicit.
- Negative: nine flags make one more ablation and one more control in the UI; every place that enumerates the flags must be kept in step (schemas, presets, the data dictionary, the UI).
- Open: whether `available_at` must also be on for an as-of walk-back to be correct is a design hypothesis of data_model section 15.3, tested with SC12.

## Evidence

- Decisions it builds on: ADR-0005 (flags and presets; a ninth flag needs its own ADR), ADR-0013 (break-out events in S3; the open question), ADR-0014 (capture path as a setting, not a flag).
- Design: `docs/design/data_model.md` sections 15.1 (entities and the two edge relations), 15.4 (the walk-back), 15.5 (VR-021); `docs/design/simulation_spec.md` section 11.5 (SC12). The shared-lot topology is A177 (provisional), a scenario input without a default.
- No `S###` applies: the choice is a design decision about the record, not a domain number.

## Author statement (verbatim, if any)

> Chose "9번째 플래그 추가 (Recommended)" (chat, 2026-10-30, asked how the record keeps lot links for SC12)

## Decider's note
Decided by the author in chat on 2026-10-30: "수락 (Recommended)" (presets A off, B off, C on).
