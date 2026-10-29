# ADR-0012: Profiles over combinatorial parameters
- **Status:** Accepted
- **Date:** 2026-10-28

## Context

Bioreactor type and size change how a sample is taken and how much culture it costs. The kind of analyzer changes service time, how many instruments a sample visits and how results leave the instrument. The skill of the people who draw, label and analyse samples changes handling delays and error rates. Each of these changes the process of recording, not just a number.

## Options

1. **Combinatorial scalar parameters on every scenario** (volume, vessel count, service time, error rates and so on as independent knobs).
   - Pro: maximal flexibility.
   - Con: dozens of knobs; nonsensical combinations; sources scattered across many fields; hard to read what a scenario means.
2. **Profiles: named data bundles for bioreactor, analyzer and staff, chosen by scenarios; the engine stays generic.** Profiles live as JSON under `scenarios/profiles/{bioreactor,analyzer,staff}/`, validated by a schema in which every numeric parameter is `{value, unit, ref}` and `ref` must resolve to a ledger id.
   - Pro: a scenario reads as "this bay, this analyzer, this crew"; each bundle carries its sources and its honest grade; adding a profile adds data, not code.
   - Con: bundles mix sourced and assumed parts; many small files; profile boundaries (for example the pilot size class) are partly the author's choice.
3. **Engine subclasses per profile.**
   - Pro: expressive.
   - Con: violates the rule that the engine has no branch on a profile, scenario or architecture id; code grows with every profile.

## Decision

Proposed: option 2. The engine implements only generic mechanisms: multi-visit routing, sequence-dependent setup, a sample-volume budget, rate multipliers and delivery order. Profiles supply the values.

| Profile | Options (default first) | Ledger ids | Grade, honestly |
|---|---|---|---|
| Bioreactor | bench manual (A067); micro-scale parallel (A065) and mini-scale parallel (A066) as the `micro_mini_parallel` family; pilot single-use (A068) | A065, A066, A067, A068; volume share A057 | A065, A066 and A067 are graded D (the sample share of the culture, A057, is derived; A067 also has a proxy part, A037); A068 is graded A (class boundary and purge volumes unsourced) |
| Analyzer | all-in-one (A069); split cell counter plus metabolite analyzer (A070); HPLC titer (A071) | A069, A070, A071; interface A036 | A069 is graded D (the capacity ceiling, A075, is derived); A070 is A (hand-off between instruments unsourced); A071 is A (column switching and system-suitability time unsourced, A030) |
| Staff | experienced (A072); trainee (A073) | A072, A073; A047, A058, A059, A060, A062, A063, A064, A076 | both graded A: label error rate is a clinical proxy (A047), the count-variability figures come from a bead study (A058, A059), and every trainee multiplier and delay or technique spread is an assumption (A062, A063, A064, A076) |

A bundle takes the grade of its weakest component, in the order S, P, D, A: a bundle with a derived part is D, not S, and one with an unsourced part is A (the ledger check enforces this). The UI shows the bundle grade and lists the unsourced parts; a trainee effect is never presented as measured, because the clinical review found the evidence on staff training insufficient (A062). Operator id and qualification reference ride on the existing `audit_trail` flag (ADR-0005).

## Consequences

- Positive: a generic engine; profiles that can be compared, extended and audited; honest grading per bundle.
- Negative: the staff and split-analyzer profiles are mostly assumptions, so results that depend on them need sensitivity analysis and clear labelling; profile schemas and files add upkeep.
- Sample-volume effects matter only where the budget bites: a micro-scale system loses a large share of its culture per sample, a bench or pilot system a negligible share (A057, derived).

## Evidence

- A065 to A073 (profile bundles and their component grades), A057 (volume budget), A036 (interface), A047, A058, A059, A060, A061, A062, A063, A064, A076 (staff-related parameters), S024 (clinical review on labelling protocols and training).
- Design source: `docs/design/simulation_spec.md`, profiles section.

## Author statement (verbatim, if any)

> "bioreactor의 종류나 크기도 다를 것이거니와 분석기는 어떤 분석기에 따라서 달라질 것이며, QC/QA사람의 숙련도 까지 과정도 다를 것이며." (chat, 2026-10-28)

## Decider's note

Decided by the author in a guided review on 2026-10-29: chose "수락 (Recommended)".
