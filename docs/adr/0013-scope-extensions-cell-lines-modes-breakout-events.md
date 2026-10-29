# ADR-0013: Scope extensions: cell-line profiles, operating modes and break-out events
- **Status:** Proposed
- **Date:** 2026-10-29

## Context

The simulator was scoped around one story: an analysis result loses its process context on the way from a bioreactor to a record. The default scenario is therefore uniform on purpose, with one cell line, one fed-batch mode and no accidents (ADR-0009). The author asked for the simulator to cover more of what can happen in bio-manufacturing: a cell line that differs from reactor to reactor, operating modes that differ, and contamination or sterility failures as break-out events, because they really happen. The author also said that adding CFD would be too much, and that for now the sample-results-lose-context story may stay the focus.

Two facts shape the choice. First, the ledgers now hold the parameters for all three extensions (A119 to A158, S057 to S083), almost all provisional. Second, an accident is where lineage earns its keep: the question after a positive test is which samples, results, pools and lots the event touched, and that is a lineage question, the thing this simulator already compares across data architectures. ADR-0012 already gives the mechanism for variation: named data profiles chosen by scenarios, with a generic engine.

## Options

1. **Keep the scope as it is (context loss only).**
   - Pro: nothing new to build or grade; the S0 to S2 plan stays small.
   - Con: the simulator never shows the case where records matter most, and every reactor behaves the same, so a difference between reactors always looks like a data error.
2. **Break-out events only** (contamination on the existing uniform fed-batch fleet).
   - Pro: smallest addition that tests lineage under stress.
   - Con: with one cell line and one mode the investigation has little to separate, and "cell line or instrument?" cannot be asked at all.
3. **Profiles only** (cell lines and operating modes, no events).
   - Pro: cheap, reuses ADR-0012 directly, and widens the context-loss story (the context unit changes in perfusion).
   - Con: leaves out the long-turnaround confirmatory results and the retro-flagging of already released results, which no profile can express.
4. **Cell-line profiles, operating-mode profiles and break-out events, designed now and built after S2.** Contamination and sterility failure come first among the events.
   - Pro: one mechanism (data profiles, generic engine) for all three; events reuse the lineage and as-of machinery; S0 to S2 stay focused because nothing here is built before S2 ends.
   - Con: more entities (material lots, holds, confirmatory results), more ledger entries that are provisional or assumed, and a larger surface to keep honest.
5. **CFD or mechanistic transport and mixing models.**
   - Pro: physically richer reactors.
   - Con: far outside what the comparison needs, no public parameter set, and it would turn a data-architecture comparison into a fluid-dynamics project. The author called it too much.

## Decision

Proposed: option 4.

| Extension | What it adds | Built in | Ledger bundles | Bundle grade (weakest component) |
|---|---|---|---|---|
| Cell-line profiles | per-reactor clone draw around the platform kinetics; lactate consumers and high producers | S4 | A150, A151, A152 | A, A, P |
| Operating-mode profiles | batch, fed-batch, intensified fed-batch, perfusion; cadence and context unit per mode | S4 | A153, A154, A155, A156 | A, A, A, A |
| Break-out events | contamination first: origin, signal, confirming tests, holds, investigation walk-back, retro-flagging | S5 | A157, A158 | A, A |

- Scheduling. S0 to S2 are unchanged and stay on context loss. Nothing in this ADR is implemented before S2 ends. With no extension selected, every earlier scenario produces a byte-identical event log.
- Mechanism. Cell lines, modes and event types are data under `scenarios/`, validated like the ADR-0012 profiles (`{value, unit, ref}` with `ref` resolving to a ledger id). The engine gains only generic mechanisms (a per-reactor parameter draw, material-lot consumption, an event script with onset, signal and test times) and never branches on a profile, mode or event id.
- Open loop. Break-out events run as a variant of experiment 1: the truth run, including the scripted response (unit stopped, confirming samples drawn), is shared by all architectures. Architectures differ only in what their records let an investigator find. Detection never changes the truth run (ADR-0004).
- Honesty about rates. The per-batch contamination rate is derived from a 2008 self-reported survey (A135, S066, grade D) and the per-draw rate is an assumption under a derived ceiling (A136, grade A). Scenarios therefore inject an event at a chosen time, origin and type instead of waiting for chance, and any random-draw mode is labelled assumed. No result is presented as a prediction of a real plant.
- Not in scope: CFD, mechanistic mixing or transport, assay sensitivity (tests report the truth), downstream process models beyond lineage edges.
- Detail lives in `docs/design/simulation_spec.md` (section 11, scenarios SC12 to SC14, the extension metrics, the rule-to-flags table in section 5) and `docs/design/data_model.md` (section 15).

## Consequences

- Positive: the simulator can show an investigation, the use of lineage with the highest stakes; cell-line and instrument effects can be confounded on purpose (SC13); the context unit can change (SC14); no new mechanism type is needed beyond ADR-0012's.
- Negative: scope grows by three profile families, new entities (material lots, quality holds, deviations), two new lineage relations and new scenario-level metrics. Almost every new parameter is provisional (none of S057 to S083 is `main-reread`) and many bundles are graded A, so nothing from the extensions may go on a public page until its sources are re-read.
- Data needs: the delays between the first signal, the confirmed result and the hold/quarantine action are A176, and the shared-lot topology (how many reactors share a seed, media or feed lot) is A177; both are grade A scenario inputs without defaults, printed with every result. The lot withdrawal schedule after a recall decision is A187 (grade P).
- Open question for ADR-0005: lot and derivation links need a recorder that stores them. The eight flags may not cover this. Either architectures A and B store lot links as free text (the subset rule of the data model), or a ninth flag is added, which would be an amendment to ADR-0005. Parked; decide when SC12 is built.
- Keeping YAGNI: events other than contamination (equipment faults, power loss, operator errors) stay out until the first event type has run.

## Evidence

- Ledger entries A119 to A158 and the revised A009; sources S057 to S083, all provisional.
- A135, A136, A137 (rates and mix), A138 to A141 (signals), A142 to A148 (confirming tests and volumes), A149 (investigation scope), A134 (port limit).
- Design sources: `docs/design/simulation_spec.md` section 11, `docs/design/data_model.md` section 15, `docs/research/README.md` ("Planned extensions").
- Related: ADR-0004 (truth world and recorded world, experiments), ADR-0005 (flags), ADR-0009 (default scenario), ADR-0012 (profiles).

## Author statement (verbatim, if any)

> "가능한 바이오 제조에서 일어날 수 있는 일들을 폭넓게 다루고 시뮬레이션 하는게 좋지 않겠어? 각 바이오리액터 마다 사용하는 cell line에 대한 변화도 줄 수 있게 하고, 운전 방식에 대해서 변화가 있을 수도 있고, 물론, CFD를 넣는건 너무 too much하겠지만, 오염-멸균 사고는 break-out-event로 둘만 하지 않아? 실제로 일어날 법하잖아. 물론, 지금 당장은 샘플 결과가 공정 맥락을 잃는 이야기에 집중해도 좋아." (chat, 2026-10-29)

## Decider's note

_(author only — Claude never writes here)_
