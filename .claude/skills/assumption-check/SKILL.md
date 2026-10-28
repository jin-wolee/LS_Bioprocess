---
name: assumption-check
description: Check that every parameter in code and scenario files maps to an A### entry in assumptions.yaml, and list the P/A-grade ones as UI badges. Use before a release or after parameters change.
---

# assumption-check

Read-only. Do not edit code or ledgers; report gaps.

1. Collect parameters: numeric defaults, rates, durations, counts and thresholds in `engine/`, `src/`, scenario files and `reference/`. Skip pure plumbing (indices, array sizes).
2. Read `docs/research/assumptions.yaml`. For each parameter find the `A###` entry whose name, default and unit match.
3. Print a table: `parameter | file:line | A### | grade | status`. Status is one of `mapped`, `missing`, `value mismatch` (code and ledger disagree), `id not cited` (mapped, but the code or UI does not carry the id).
4. List every entry graded `P` or `A` as a UI badge line: `A### · <name> · <grade>`. These are the numbers the UI must label as plausible or assumed.
5. End with counts: mapped, missing, mismatch. Any `missing` or `value mismatch` is a failure to report to the orchestrator.
