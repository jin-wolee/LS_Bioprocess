# ADR-0004: Truth world versus recorded world, observation contract, experiments 1 and 2
- **Status:** Accepted
- **Date:** 2026-10-28

## Context

The simulator compares data architectures on one synthetic run. Two things can ruin the comparison: a recorder that quietly reads the hidden truth (so every architecture looks better than it should), and architectures that are compared on different random worlds (so differences are noise). It also has to show two different things: how recorded context degrades, and how a recording error can travel back into the process.

Two flagship cases drive the design.

1. **Feed in the gap.** A sample is drawn at 08:40, a bolus feed happens at 09:00, and the sample is measured at 09:25 (illustrative scenario times). Joining the result to the historian by `measured_at` pairs a pre-feed value with post-feed process state, which contaminates anything trained on it. Discrete feeds that can fall between a draw and its measurement are part of the process description (A010, A050, S017).
2. **Offline pH used to re-standardise the online probe.** Offline pH is commonly treated as the source of truth when probes are readjusted, and sampling, hold time, temperature and CO2 degassing add offsets (S013, A051 (provisional)). A sampling offset therefore propagates into control. The same source describes a GMP-style alternative that does not readjust onto offline values, using a CO2-based reference and delta-probe alarms (S013; a related exhaust-CO2 recalibration note is snippet-level, S045 (provisional)). That alternative is the "context-preserving" story: record how the sample was taken and held so the offset can be modelled or excluded instead of baked into the probe. Offsets depend on equipment and local procedure; the ledger default (A041) is a cell-free, liquid-handler case and is never presented as a universal figure.

## Options

1. **Strict separation: a `truth_log` that only the evaluator reads, and an `observable_events` stream that recorders consume.** One truth run per `(scenario, seed)` is shared by all architectures.
   - Pro: leakage is testable (change hidden-only fields, recorder output must be byte-identical); differences are attributable to capture.
   - Con: more machinery (two streams, a visibility annotation in the schemas); some hidden quantities need explicit observable proxies.
2. **One shared mutable simulation state that recorders read.**
   - Pro: simple.
   - Con: easy to leak truth into a recorder without noticing.
3. **Simulate each architecture independently with its own random stream.**
   - Pro: no shared infrastructure.
   - Con: differences between architectures mix with sampling noise; no common truth to measure error against.

Experiments:

1. **Experiment 1 only (open loop).** Clear and cheap, but it cannot show how a record error reaches control.
2. **Experiment 2 only (closed loop everywhere).** Feedback couples each architecture to a different process, which makes comparisons hard to read.
3. **Both: experiment 1 primary, experiment 2 for the single question where feedback matters.**

## Decision

Proposed: strict separation; both experiments.

- Recorders consume `observable_events` only: sample drawn with planned label, received, run started with instrument and QC lot, QC result, calibration record, maintenance log, recorded historian values. Hidden fields are marked `"x-visibility": "hidden"` in the schemas. Only the metrics evaluator reads the error answer key. The only layer-5 reader of truth is the oracle arm of experiment 2.
- Randomness is keyed by one canonical 5-tuple, `(run_seed, physical_sample_id, analyte, attempt, purpose)`; a draw that belongs to a unit, an instrument or a generator puts that entity's id in the second slot (`docs/design/simulation_spec.md`, section 3). Experiment 2 draws its common random numbers from the same key, with the run `seed` as `run_seed`. Adding or re-running a sample must not change another sample's draws.
- **Experiment 1 (primary, open loop):** error opportunities are drawn once per sample, independent of architecture, then materialised per architecture. Step durations are identical across architectures. Detection only raises flags; it never triggers a re-draw or a re-measure. The truth-log hash is identical across architectures.
- **Experiment 2 (closed loop, scenario SC8):** open-sample CO2 outgassing biases offline pH, the offline value re-standardises the probe, and the probe offset causes a control excursion. Arms: an oracle that decides with truth, versus A, B and C. Common random numbers; paired difference against the oracle over at least 20 seeds (a design parameter) with intervals. Wording is always "model-internal effect under assumptions A###, not a prediction". Feedback is off in every other scenario.
- Viability loss in a held sample is not the central effect: neat samples showed no decline within 55 min in the cited study (A038, A039, S012), so the applied default is zero (A040) and any non-zero slope is a diluent or handling scenario knob.

## Consequences

- Positive: leakage and comparability are tested properties, not hopes; the two flagship cases map to concrete scenarios (SC3, SC8).
- Negative: experiment 2 needs common random numbers and an oracle, which is more code and more ways to be wrong; the pH controller and the feed rule are simulator choices (A050, A051 (provisional) frequency unsourced), so excursions are model-internal; pH hold effects rest on proxy values (A042 (provisional), A043 (provisional)) and an unsourced technique error rate (A064).
- Results are reported as distributions over many seeds with sensitivity to the grade-A inputs, and no number is stated for a stage that has no result yet.

## Evidence

- S013, A041, A051 (provisional), S045 (provisional) (pH practice and the alternative); A037 (provisional), A042 (provisional), A043 (provisional), A064 (container and hold effects); A010, A050, S017 (discrete feeds); A038, A039, A040, S012 (viability hold).
- Design source: `docs/design/simulation_spec.md`, sections on the observation contract and experiments.

## Author statement (verbatim, if any)

_None recorded._

## Decider's note

Decided by the author in a guided review on 2026-10-29: chose "수락 (Recommended)".
