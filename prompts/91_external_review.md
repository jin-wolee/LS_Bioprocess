# 91 — External third-opinion template (codex and agy)

Used by the orchestrator at a milestone, only when the plan or the author asks: after the S1 gate, after the S2 gate, before the public flip, and in S5. One round per milestone. The same input goes to both tools; raw outputs stay private; only a sanitized disposition table becomes public.

## Working principles (mandatory)

Principles: see `prompts/PRINCIPLES.md`. Stage combination: HITL + KISS + DRY (read-only third opinion at a milestone: one round, one packet, one disposition table). Rails: PRINCIPLES.md section 6.
Exception for this brief: rail 2's ban on `docs/private/` is lifted for `docs/private/reviews/` only.

Sending text to an external tool is an outward-facing act: whatever is in the packet leaves this machine and may be retained. The packet therefore obeys the same rails as a public file.

## Procedure

1. **Build the packet** `docs/private/reviews/YYYY-MM-DD_<topic>_packet.md` from the template below. Use repo-relative paths only. Do not paste raw files that need a context the tool lacks; name them and let the tool read them (its working directory is the repo root and it is read-only).
2. **Token check before sending** (the packet is in an ignored folder, so `check_docs` will not see it):
   `grep -ciFf <(grep -vE '^\s*(#|$)' .guardrails.local.txt) docs/private/reviews/YYYY-MM-DD_<topic>_packet.md` must print `0`. Also read the packet once for fingerprints and absolute paths. If it fails, fix the packet; do not send.
3. **Snapshot the tree:** `git status --short > <scratchpad>/before.txt`.
4. **Run both tools on the identical packet text**, in parallel as two background jobs, 900 s limit each:

```bash
PROMPT="$(cat docs/private/reviews/YYYY-MM-DD_<topic>_packet.md)"

codex exec --skip-git-repo-check -m gpt-6.1-sol -c model_reasoning_effort='"xhigh"' -s read-only "$PROMPT" </dev/null 2>/dev/null > docs/private/reviews/YYYY-MM-DD_<topic>_codex.md

agy --model gemini-4-argon-high --print-timeout 900s --disable-slash-commands -p="$PROMPT" </dev/null > docs/private/reviews/YYYY-MM-DD_<topic>_agy.md
```

5. **Validate each output.** Non-empty; contains findings in the required format or an explicit `NO FINDINGS` line per question; no quota, model-not-found or timeout text (agy can exit 0 on failure). A failed run is recorded as "tool failed, no review obtained", never as "clean". Retry once; if it fails again, say so in the disposition table.
6. **Check nothing changed:** `git status --short | diff - <scratchpad>/before.txt` must be empty. If a tool edited files, revert those files from your own knowledge of the diff, stop, and tell the author.
7. **Triage.** Merge duplicates across tools (a finding raised by both gets one row, source `both`, higher priority). An external finding is a hypothesis: re-read the code or the source yourself before accepting any blocker or major. Domain claims go to `fact-checker`; the orchestrator judges.
8. **Write the public disposition table** `docs/reviews/YYYY-MM-DD_<topic>.md` (below), run `check_docs --all`, and apply accepted fixes through an executor brief, not by hand.
9. Raw outputs stay in `docs/private/reviews/`. Never quote them in a public file.

## Packet template

```markdown
# Review request: <topic>

You are an independent reviewer. Read-only: do not edit, create, or delete any file and do not run commands that write. Output findings only: no praise, no summary, no restating of the code.

## Context
A public portfolio simulator (generic synthetic scenario based on public sources): N bench-scale bioreactors send samples to 2 shared at-line analyzers; the same synthetic truth run is recorded under several data architectures to show how analysis results lose process context. Read `prompts/00_master_build.md` for invariants and `docs/design/` for the model.

## Artifacts to review
- <repo-relative path> : <what to look at>
- ...

## Questions (answer each; if nothing is wrong write `NO FINDINGS` for that question)
1. Model validity: where could the simulation produce a result that its own mechanism does not justify?
2. Truth/recorded leakage: any path by which a recorder, detector or the oracle-free arms sees hidden state?
3. Metric gaming: can an architecture look better through the denominator, the answer key, seed choice, or construction?
4. Determinism and reproducibility: anything that makes the same seed produce a different log?
5. Domain accuracy: statements about laboratory practice, standards or instruments that a practitioner would dispute (cite what is wrong and why).
6. Overclaiming: wording that claims more than a model-internal result.
7. <topic-specific question>

## Out of scope (do not raise)
- Decisions recorded as author decisions in `docs/adr/` (themes, story mode, licence choice).
- Styling preferences; features not in the session brief.

## Output format (strict)
For every finding:
- ID: F1, F2, ...
- Severity: blocker | major | minor
- Section: file path and line or heading
- Failure scenario: a concrete input or sequence that breaks it
- Fix: the smallest change that resolves it
```

## Disposition table (public) — `docs/reviews/YYYY-MM-DD_<topic>.md`

```markdown
# External review disposition: <topic> (<date>)

Two independent tools reviewed the same packet. Raw outputs are private. Each finding below is summarised in neutral wording and judged by the orchestrator.

| # | Source | Severity | Section | Summary | Disposition | Action or reason |
|---|---|---|---|---|---|---|
| 1 | both | major | engine/src/analysis | <= 25 words, neutral | accept | <= 30 words: what changed, where |
| 2 | tool A | minor | docs/design | ... | partial | what was taken, what was not, why |
| 3 | tool B | major | ADR-00NN | ... | keep | author decision stands, reason |
```

Rules: one row per finding; `Disposition` is exactly `accept`, `partial` or `keep`; `keep` states why (author decision, out of scope, finding re-checked and wrong); a failed tool run gets its own row; no quotes from raw output, no private paths, no tool-specific phrasing, no mention of how the scenario began; counts at the bottom (`accepted n, partial n, kept n`).
