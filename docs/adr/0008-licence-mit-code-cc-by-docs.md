# ADR-0008: Licence: MIT for code, CC BY 4.0 for documents
- **Status:** Proposed
- **Date:** 2026-10-28

## Context

The repository is intended to become public, and it contains three kinds of material: code, documents (design, ADRs, ledgers, site text) and synthetic data exports. Without a licence, default copyright applies and nobody may legally reuse any of it. A licence is also a decision that belongs to the author, not to an AI drafter.

## Options

1. **MIT for code, CC BY 4.0 for documents and exported synthetic data.**
   - Pro: short, permissive and widely understood; attribution is required for documents and data; suits a portfolio that wants to be reused and credited.
   - Con: no explicit patent grant; permissive terms allow closed derivatives.
2. **Apache-2.0 for code, CC BY 4.0 for documents.**
   - Pro: explicit patent grant.
   - Con: longer text and notice requirements; little practical gain for a simulator with no patented method.
3. **All rights reserved (public but not reusable).**
   - Pro: keeps every option open.
   - Con: readers cannot run, adapt or cite it freely, which defeats the point of a public portfolio.
4. **Copyleft (AGPL for code, CC BY-SA for documents).**
   - Pro: improvements must be shared back.
   - Con: discourages reuse by exactly the audience that might use it; heavier for a small project.

## Decision

Proposed: option 1, as a proposal only. **No licence is displayed anywhere until this record is `Accepted`**: no `LICENSE` file, no badge, no site footer, no repository metadata, and the `licenses` field of exported data packages stays unset. The ledgers contain short factual phrases and URLs of sources, not copies of the sources, and that boundary is kept whichever licence is chosen.

## Consequences

- Positive: a clear, common licence pair once accepted.
- Negative: until acceptance the repository is not reusable by others, and exports have no licence field; the public flip (a separate author action) should wait for this decision.
- CC BY 4.0 on documents means quotations of third-party material must stay short and attributed by ledger id.

## Evidence

- A public dataset in the survey is released under CC BY 4.0 (S035, snippet), a precedent for data licensing in this field.
- No domain number is involved.

## Author statement (verbatim, if any)

_None recorded._

## Decider's note

_(author only — Claude never writes here)_
