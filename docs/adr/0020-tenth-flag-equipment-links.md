# ADR-0020: Tenth flag: equipment links (amends ADR-0005)
- **Status:** Proposed
- **Date:** 2026-10-30
## Context

The author ruled on 2026-10-30 that the first break-out event of S3 includes equipment among its origins (spec section 11.8, decision D1). A contaminated piece of shared equipment touches every batch that used it, and the investigation walk-back reaches those batches in the same one-step backward hop as a shared lot (direction 3, data_model section 15.4; A149 and spec 11.4 already place equipment there). The record can follow that hop only if it stores which batch used which equipment item and when: data_model section 15 now has the entity `equipment`, the event kind `equipment_use` and the relation `used_in` (S3f part 2).

ADR-0017 added a ninth flag, `material_lot_links`, for the edges from material lots to the batches that consumed them. It does not cover equipment. ADR-0005 says that a further flag needs its own proposed ADR.

## Options

1. **Widen the ninth flag to lot and equipment links.**
   - Pro: the flag count stays at nine; lot consumption and equipment use often sit in the same batch record.
   - Con: one flag then carries two mechanisms, so the ablation cannot say which of them moved a metric; it changes the meaning of an accepted flag.
2. **A tenth flag, `equipment_links`.**
   - Pro: every difference still traces to one mechanism; C with this flag off joins the one-flag-off ablation, so the effect of equipment links on SC12 shows apart from that of lot links.
   - Con: one more flag in every architecture key, preset table, ablation list and UI control.

## Decision

Proposed: option 2 (the author's choice in chat).

| Flag | On | Off | C minus this flag (expected outcome of a forced-error fixture) |
|---|---|---|---|
| `equipment_links` | an `equipment_use` event stores the equipment id as a key, and the recorder writes the `used_in` edge from the item to the use | no edge; at most a free-text equipment name in the batch record, which a query cannot join | the sibling walk-back cannot reach the other batches that used the contaminated item: they are invisible to it |

- Presets: A off; B on (the author's choice: a LIMS-lite system logs which equipment item a batch used, while it keeps lot consumption unlinked, ADR-0017); C on, so C has all ten flags.
- The flag is read only where equipment items exist, that is with the break-out extension (SC12). With no extension nothing reads it, so no recorded value changes. Outputs that list the flags of an architecture gain one entry, as for ADR-0017; the trace fixture is regenerated under the same condition the author set for the ninth flag (the flag list and the checksum only).
- S3 adds a forced-error fixture typed by hand before any run: a contaminated equipment item used by two batches; with the flag on, direction 3 reaches the second batch; with it off, it does not (spec 11.8, fixture FX12e).
- The contamination share by origin and a list of which equipment is shared have no source; they are scenario inputs, not numbers of the engine (A177 as widened by the S3f ledger changes).

## Consequences

- Positive: SC12 results stay attributable to single mechanisms; the ablation separates lot links from equipment links.
- Negative: ten flags make one more ablation and one more control in the lab; every place that enumerates the flags must be kept in step (spec section 11.8.6 lists them).
- Open: none beyond those of ADR-0017.

## Evidence

- Decisions it builds on: ADR-0005 (flags and presets; a further flag needs its own ADR), ADR-0013 (break-out events), ADR-0017 (the ninth flag, the same shape).
- Design: `docs/design/simulation_spec.md` section 11.8 (scope, fixtures, the places that list flags); `docs/design/data_model.md` section 15 (`equipment`, `equipment_use`, `used_in`); A149, A177.
- No `S###` applies: the choice is a design decision about the record.

## Author statement (verbatim, if any)

> Chose "장비까지 포함" for the origins (chat, 2026-10-30, decision D1) and "10번째 플래그 추가" for the flag of equipment links (chat, 2026-10-30, decision D6)

> Chose "B도 켜고 수락" (chat, 2026-10-30, asked to decide ADR-0020 with the presets A off, B off, C on)

## Decider's note
_(author only — Claude never writes here)_
