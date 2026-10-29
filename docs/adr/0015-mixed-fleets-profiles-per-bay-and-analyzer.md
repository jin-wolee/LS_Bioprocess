# ADR-0015: Mixed fleets: profiles per bay and per analyzer
- **Status:** Accepted
- **Date:** 2026-10-29
## Context

ADR-0009 makes the counts adjustable: reactors within the range of A001, analyzers within the range of A022. ADR-0012 makes type and size a matter of profiles. A scenario picks one profile per category, though (`schemas/scenario.schema.json`, `profiles.bioreactor`, `profiles.analyzer`, `profiles.staff`, one string each), so every reactor of a scenario shares one bioreactor profile and every analyzer shares one analyzer profile. A lab with bench vessels in one bay and a mini-scale parallel system in the other, or an all-in-one analyzer beside an HPLC, cannot be written as one scenario.

The engine is not the obstacle. The L3 core already routes visits by analyzer group, with a service time per visit and setup per method (S1a), and the volume budget is kept per reactor (A207). Two later pieces need mixed fleets anyway: operating modes are per reactor in S4 (spec section 11.3), and HPLC contention in S4 puts analyzers of different kinds side by side.

## Options

1. **Keep one profile per category per scenario.**
   - Pro: simplest schema; nothing to build.
   - Con: a mixed lab cannot be expressed; S4 HPLC contention would force the change later under time pressure.
2. **Additive assignment fields, per bay and per analyzer.** `profiles.bioreactor` and `profiles.analyzer` stay the defaults. An optional per-bay list overrides the bioreactor profile of a bay, and an optional per-analyzer list gives each analyzer its own profile. Staff stays per scenario, because the roster is per scenario (A201). When the new fields are absent, a scenario behaves exactly as today.
   - Pro: backward compatible; data only; the bay is already a unit of the design (bays of A001, one sampling window per bay in A203).
   - Con: more load-time validation (bay sizes against the reactor count, every analyte a request needs measured by some analyzer); metrics must be broken down per profile.
3. **A profile for every reactor and every analyzer, listed one by one.**
   - Pro: maximal freedom.
   - Con: long scenario files and the combinatorial sprawl that ADR-0012 rejected.

## Decision

Proposed: option 2, with the bay as the grain for bioreactor profiles and the single analyzer as the grain for analyzer profiles.

- Built when the first session needs it: S3 (the N x M controls of the lab UI) or S4 (HPLC contention), whichever comes first. Not in S1 or S2 (YAGNI).
- The engine stays generic: no branch on a profile id; a request is routed to the analyzers whose profile measures its analytes, and a scenario in which some requested analyte has no analyzer is rejected at load.
- Regression: with the new fields absent, the default scenario's event log stays byte-identical to the golden event logs (the same rule as spec section 11.1, rule 1).
- Reporting: utilisation is stated per window (ADR-0009) and per analyzer profile; each profile's bundle grade is shown (ADR-0012).

## Consequences

- Positive: a mixed lab is one scenario; the S4 HPLC work starts from a schema that already allows it; existing scenarios and goldens are untouched.
- Negative: load-time validation grows; metric tables gain a profile dimension; a mixed fleet makes per-profile comparisons depend on routing, which must be stated with every result.
- Open: whether a request that two analyzer profiles can both measure goes to one of them by a rule (for example the lowest-index idle analyzer, as in the S1a dispatch contract) or is split by analyte.

## Evidence

- A001 (reactor count and bays), A022 (analyzer count), A203 (one sampling window per bay), A201 (roster per scenario), A207 (volume budget per reactor), A065 to A071 (bioreactor and analyzer profile bundles), S009 (12- and 24-vessel configurations).
- Design: `docs/design/simulation_spec.md` sections 4, 4.4 and 11.3; `schemas/scenario.schema.json`.

## Author statement (verbatim, if any)

> "근데 우리 분석기랑 바이오리액터는 2개/20개 고정이야? 아니지? 추가할 수 있고 종류/크기도 각기 다르지?" (chat, 2026-10-29)
> Chose "ADR 초안 → S3/S4 구현" (chat, 2026-10-29)

## Decider's note
Decided by the author in chat on 2026-10-29: "혼합구성 허락."
