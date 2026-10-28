# ADR-0009: Default scenario: 24 reactors in two bays, 2 analyzers, N by M adjustable
- **Status:** Proposed
- **Date:** 2026-10-28

## Context

Every scenario needs a default size. The default must be easy to explain, supportable by something real, and structured enough that the scenario catalogue can ask different questions of it (shift-start burst, one analyzer down, per-bay sampling windows). The setting is a process-development (PD) laboratory.

## Options

1. **24 reactors in two symmetric bays of 12, sharing 2 analyzers; N (5 to 100 reactors) and M (1 to 6 analyzers) adjustable.**
   - Pro: two equal bays give natural splits (staggered windows per bay, one analyzer per bay as a baseline); 24-vessel parallel systems exist as a real-world anchor (S009 lists 12-vessel and 24-vessel configurations); the sizes sit inside the adjustable ranges (A001, A022).
   - Con: the anchor is an automated mini-parallel system, whereas the default background is a manually sampled bench-scale bay (A067), so the anchor supports the plausibility of a 24-vessel PD group, not of 24 manually sampled benches; the default count itself is a scenario setting (grade A).
2. **A single bay of 12 with 2 analyzers.**
   - Pro: smaller, simpler.
   - Con: no symmetry to exploit; bay-level scenarios disappear; load is lower still.
3. **A very large default chosen to force congestion.**
   - Pro: dramatic queues.
   - Con: manufactures the result; conflicts with the honest finding that average load is low and queueing comes from bursts.
4. **Fixed counts with no N by M control.**
   - Pro: less configuration.
   - Con: readers cannot test whether a finding depends on the size.

## Decision

Proposed: option 1. The default is a PD-laboratory background with the bench-scale manual profile (A067), one sample per reactor per day with a second sample in the feed window on a share of reactor-days (A014, A015), and the analyzer count at 2 (A022). N and M stay adjustable within the ledger ranges.

Any utilisation figure must state its window. With 33.6 to 38.4 samples a day at 4.5 min each (A001, A014, A015, A023, S001), the load is 12.6 to 16 percent of two analyzers over a 9 to 10 h staffed window, and 5 to 6 percent over a 24 h clock (A074, grade A because counts and window are assumptions). One stand-alone all-in-one analyzer handles about 13.3 samples per hour (A075, derived). Queueing therefore comes from bursts, not from capacity: the default burst puts 65 percent of draws around 08:30 with a spread of 18 min (A016, assumed).

## Consequences

- Positive: a default that is explainable in a sentence and supported by a real hardware analogue; scenarios SC2 and SC5 have a natural structure.
- Negative: load is low, so the default scenario shows context loss and burst waiting, not saturation; users who want saturation must change N and M and the profile, and the UI should say so.
- Utilisation numbers shown anywhere must carry their window.

## Evidence

- A001, A022 (scenario settings, grade A); S009 (12- and 24-vessel configurations); A067 (bench-scale default profile); A014, A015, A016 (sampling pattern, assumed or second-hand); A023, S001 (4.5 min cycle); A074, A075 (load and capacity).

## Author statement (verbatim, if any)

> Chose "24×2 기본 + N×M 가변" (chat, 2026-10-28)

## Decider's note

_(author only — Claude never writes here)_
