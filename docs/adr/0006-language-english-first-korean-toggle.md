# ADR-0006: Language: English first with a Korean toggle
- **Status:** Accepted
- **Date:** 2026-10-28

## Context

The project is public and its sources (vendor documents, papers, regulatory texts) are in English, while the author works in Korean. The site and the public documents need one default language, and the choice sets how much text has to be kept in step.

## Options

1. **English only.**
   - Pro: one text to maintain; matches the sources.
   - Con: excludes Korean readers the author may want to reach.
2. **Korean only.**
   - Pro: natural for the author.
   - Con: the sources and most technical readers are English-speaking; quotes and terms would need constant translation.
3. **English first, with a Korean toggle on the site.** Site text lives in a dictionary with English as the source and Korean as the second column; public documents stay in English.
   - Pro: one authoritative text, a second audience served, terms stay aligned with the sources.
   - Con: translation drift; every user-visible string needs a Korean entry; the page-QA matrix doubles for language.
4. **Fully parallel bilingual documents.**
   - Pro: complete for both audiences.
   - Con: highest maintenance; two texts diverge quickly.

## Decision

Proposed: option 3. The site and all public documents (README, design documents, ADRs) are English first. The site offers a Korean toggle. The Korean text must not introduce a number, claim or source that the English text lacks. The author's decider's note on any ADR may be written in any language, and verbatim author statements stay in their original language.

## Consequences

- Positive: terms match the cited sources; a Korean reading path exists without a second document set.
- Negative: translation parity has to be checked (the page-QA matrix includes both languages); the banned-term scan must cover Korean spellings as well as English ones.
- Documents other than the site are not translated unless a later decision says so.

## Evidence

- No domain number is involved; the decision rests on audience and maintenance cost. The sources the ledgers cite are in English (see `docs/research/sources.yaml`).

## Author statement (verbatim, if any)

> Chose "영문 우선 + 국문 토글" (chat, 2026-10-28)

## Decider's note

Decided by the author in a guided review on 2026-10-29: chose "수락 (Recommended)".
