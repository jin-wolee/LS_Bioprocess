# ADR-0001: Generic synthetic scenario, public sources only
- **Status:** Accepted
- **Date:** 2026-10-28

## Context

The simulator is a public portfolio project. Its scenario has to be concrete enough to simulate (reactors, analyzers, sampling routines, error opportunities) and every number in it has to be traceable by a reader who has only this repository and the internet. Whatever a reader cannot see, they cannot audit, reproduce or build on.

## Options

1. **Generic synthetic scenario, public sources only.** Parameters come from vendor documents, open papers, published case studies and regulatory texts. A parameter with no public source is allowed only as a labelled assumption (grade A).
   - Pro: every number carries a ledger id and can be checked; the repository can be cloned and re-run by anyone; no risk of mixing in material that cannot be shown.
   - Con: where public sources are silent the scenario rests on assumptions (shift pattern, transport time, queue habits are all grade A: A016, A017, A018, A034); the scenario cannot claim to match any real site.
2. **Scenario calibrated on one real site's practice or records, anonymised.**
   - Pro: higher plausibility of the defaults.
   - Con: the calibration cannot be cited by id, cannot be audited or reproduced, and anonymisation can fail silently; results would read as a statement about a real plant.
3. **A public dataset as the scenario.**
   - Pro: real measurements, citable.
   - Con: the one public dataset surveyed is an industrial-scale penicillin fermentation with no at-line analyzer and no sample-context layer, and it is not a CHO process (S035, snippet), so it cannot carry the question this simulator asks.

## Decision

Proposed: option 1. The scenario is synthetic and generic. Its narrative anchor is a published teaching case, a hypothetical antibody process (S017), and its layout default has a published hardware analogue (S009). Results are described as model-internal effects under the stated assumptions, never as statements about a real plant.

## Consequences

- Positive: a reader can follow any number to a source or to a visible assumption; the ledgers (ADR-0007) make that mechanical; the project can be shared without caveats about data provenance.
- Negative: realism is bounded by what is public. Several sampling, staffing and instrument-behaviour parameters stay grade A and the UI must show them as assumed. Claims such as "typical" or "industry practice" are avoided unless a source says so (for example, where routine in-process results live is site-dependent, A056).
- The simulator never states results about a real facility, and no export or screen may imply otherwise.

## Evidence

- A001 (scenario setting, grade A), S009 (24-vessel parallel systems exist), S017 (public teaching case, hypothetical antibody), S035 (public dataset surveyed; not suitable).
- Grade-A examples that remain assumptions: A016, A017, A018, A034.

## Author statement (verbatim, if any)

_None recorded._

## Decider's note

Decided by the author in a guided review on 2026-10-29: chose "수락 (Recommended)".
