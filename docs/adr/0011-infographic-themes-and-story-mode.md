# ADR-0011: Infographic themes and scroll story mode
- **Status:** Accepted
- **Date:** 2026-10-28

## Context

The infographic explains the problem and the mechanism to a reader who may spend a minute on it. Visual style affects trust: a technical-report look reads as evidence, while a neon dashboard or a long scroll story can read as decoration. Each extra theme or mode also multiplies the cases that must be tested (viewport, theme, language, motion preference).

## Options

1. **Technical-report style only, light and dark following the system setting.**
   - Pro: smallest test matrix; reads as evidence; accessible by default.
   - Con: less memorable; no visual variety for readers who like it.
2. **Technical report light/dark by default, neon dark dashboard as an opt-in theme, scroll story as an opt-in feature.**
   - Pro: the default is conservative; the extras serve readers who want them; theme switching is a token swap, not a second design.
   - Con: a larger QA matrix; risk of the extras becoming the first impression if they leak into defaults; more to maintain.
3. **Neon dashboard as the default.**
   - Pro: striking.
   - Con: contrast and legibility risks; looks generic; undermines the evidence tone.
4. **Scroll story as the main form.**
   - Pro: guided narrative.
   - Con: motion-heavy, harder to scan and print, accessibility burden on the main path.

## Decision

Proposed: option 2.

- Default: technical-report style, light and dark following the system preference.
- Neon dark dashboard: an opt-in theme.
- Scroll story: an opt-in feature, off by default and disabled when the reader prefers reduced motion.
- **Status colours keep one meaning across every theme** (the same state is never recoloured to fit a palette); themes change tokens only.
- No simulation result appears on the infographic before results exist; every number carries its ledger id and the grade badge.
- QA covers the matrix of viewport, theme and language, plus story mode, with contrast checked per theme.

**Recorded dissent.** An external review (a non-Claude model, read-only, raw text kept private) recommended removing both the neon theme and the story mode, on grounds of generic "AI-made" look, accessibility surface, a doubled test matrix and distraction from the data artefacts. The author considered it and kept both as options (see the statements below). The mitigations above are the response to that dissent: conservative defaults, token-only themes, reduced-motion disablement and per-theme contrast checks. If either option fails QA, it can be removed without touching the default.

## Consequences

- Positive: a credible default with room for taste; the dissent and its response are on record.
- Negative: more QA and more code paths than the default alone needs; the risk named by the dissent remains if the extras are ever promoted to defaults.
- Reversal path: dropping neon or story mode only removes an option.

## Evidence

- No domain number is involved. The external review is summarised here and kept in `docs/private/` as raw text.

## Author statement (verbatim, if any)

> "기술 리포트형, 라이트/다크 를 기본값으로 두고, 테마변경을 네온 다크 대시보드로 할 수 있게 허락하고, 스크롤 스토리텔링형은 옵션(기능)으로 하도록 진행하자." (chat, 2026-10-28)

> Later chose "둘 다 옵션으로 유지" (chat, 2026-10-28), after the external reviewer's recommendation to remove both was reported.

## Decider's note

Decided by the author in a guided review on 2026-10-29: chose "수락 (Recommended)".
