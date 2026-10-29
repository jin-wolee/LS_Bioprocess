# ADR-0002: Decision records mark the author's contribution boundary
- **Status:** Accepted
- **Date:** 2026-10-28

## Context

Much of this repository is drafted with AI assistance. A reader, and the author later on, should be able to tell which decisions are the author's own and which text an AI drafted. A format check cannot establish that; the record of who did what has to live somewhere that is hard to fake after the fact.

## Options

1. **AI drafts decision records as `Proposed`; the author writes the decider's note, flips the status and commits that change personally, without a co-author trailer.** Git history separates the two roles. Verbatim statements of the author are quoted, with channel and date, in a dedicated section.
   - Pro: the boundary is visible in `git log` (author-only commits versus AI-trailer commits); the AI never writes a decision, only a proposal; the session-start hook lists every `Proposed` record so none is forgotten.
   - Con: each acceptance is a manual commit; the boundary rests on git history and on the author's honesty, since nothing mechanical can prove who typed a note.
2. **No decision records; design documents only.**
   - Pro: least overhead.
   - Con: the reasoning, the rejected alternatives and the author's choices disappear into prose; no place to record dissent.
3. **The author writes every record; AI only reviews.**
   - Pro: unambiguous authorship.
   - Con: slow, and it throws away the main use of an AI drafter, which is to enumerate options and trade-offs quickly for a human to judge.
4. **AI drafts and also commits "accepted" records with an approval line.**
   - Pro: fast.
   - Con: erases the boundary this ADR exists to keep.

## Decision

Proposed: option 1. Claude writes status `Proposed` only and leaves the decider's note as the placeholder. The author edits the note, sets the status, and commits personally. `scripts/check_docs.py` checks structure (sections, status vocabulary, date) and warns when a record is `Accepted` with an empty note; with `--ci` that warning becomes a failure. It does not, and is not claimed to, prove authorship.

## Consequences

- Positive: human decisions and AI drafts are separable after the fact; the same rule covers every later ADR.
- Negative: slower acceptance; a determined person could still commit AI text under the author's name, so the process depends on good faith.
- The author's implementation track (ADR-0010) uses the same logic for code: the files the author writes are protected from AI edits.

## Evidence

- Repository invariants in `CLAUDE.md` (invariant 4) and `prompts/00_master_build.md` (invariant 4).
- Format check: `scripts/check_docs.py` (ADR sections, statuses, empty-note warning).

## Author statement (verbatim, if any)

> "ADR진행시키도록 해" (chat, 2026-10-28)

## Decider's note

Decided by the author in a guided review on 2026-10-29: chose "수락 — 반영은 내가 직접 커밋 (Recommended)".
