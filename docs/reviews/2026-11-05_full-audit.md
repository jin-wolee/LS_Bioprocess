# Full audit — 2026-11-05 (dispositions)

A read-only audit of the repository at commit `df57b4f` and of the public site, run by one Claude session as auditor with eight subagents (security, docs and ledgers, maintainability, fact-checker, UI error paths and test quality, engine mutations, design and accessibility, and the `sim-adversary` pass). Nothing was changed. Every blocker and major candidate was reproduced again by the auditing session on disk before it entered the list; three grades moved on that re-check (two down from blocker to major, one from major to minor), and the reasons are recorded with each. The full report, its evidence files and the executor briefs are private material under `docs/private/` and are not part of this repository. This page holds the public dispositions.

The gate on this tree was green before the audit began: `uv run pytest -q` 989 passed (76 deselected), `uv run pytest -m user_track -q` 76 passed, `scripts/check_docs.py --all` 1,169 files with 0 failures, `npm run check` with 10,811 Vitest tests, `scripts/check_all.sh --manual --lab --plant` PASS (lab QA 16 of 16, plant QA 20 of 20), `qa_infographic.py` 9 of 9, `qa_site.py` 11 of 11. The budgets held: first load 215 KB gzip of 300, plant chunk 156 KB of 200, frame median 33.4 ms and 95th percentile 50.1 ms. The live site is the build of `main` (asset names and the explainer page are byte-identical to a local build of the same commit).

**Count**: 100 findings — 0 blocker, 16 major, 84 minor. 11 findings about the guard hooks and the HTTP headers of the public site are withheld from this page until they are fixed; they are tracked privately as batch R2. Eight findings were already recorded in `docs/progress.md` and are marked so.

## Dispositions

Batches R1 to R10 are the executor briefs the orchestrator sends in that order (the security batch R2 waits for two decisions by the author). "Author" means a decision only the author can take; "Parked" is the usual place for a nicety.

### Major

| ID | Area | Finding | Disposition |
|---|---|---|---|
| S-01 | Engine, challenge | The lock that keeps the plant and the lineage view from showing the truth of an open challenge compares the spec without its operator actions. An action can reproduce another scenario's truth byte for byte (the default scenario plus an analyzer outage equals SC5), so the locked truth can be read through the plant. Reproduced with a test. | Fix in R1 (lock on both keys; regression test) |
| S-02 | Engine, settings | `rerun_probability` accepts 1, every attempt then fails QC and reruns without bound, the Worker never answers and runs out of memory. A plant link can carry the setting, so one link freezes the plant of whoever opens it. Reproduced in Node and in the browser. | Fix in R1 (strict bound; invalid_spec test) |
| Aeng-01 | Engine, tests | The hand fixture F1 does not fail when the queue is ordered by the sampling time instead of the arrival time (52 of 52 pass); the invariant tests and the goldens catch it instead. The rubric's "F1 must fail" and the S1a brief's claim are not true as written. | Fix in R1 (an F1c case with hand-typed values; brief line corrected) |
| Aeng-02 | Engine, lint zones | The recorded-side lint zones do not forbid an import of the scenario loader or of the scenario files, which carry hidden break-out truth. No such import exists today. | Fix in R1 (zone patterns; planted-import test) |
| Aui-01 | Lab, error states | When the Worker crashes or never answers, only Home shows the error; every other screen stays on "Starting the engine" with no message and no timeout. | Fix in R1b |
| Aui-02 | Lab, links | A Setup link with a very large reactor or analyzer count throws an uncaught `RangeError` and leaves Setup without a form or a message. Reproduced. | Fix in R1b (bounds from the ledger ranges; a refusal message) |
| Aui-03 | Lab, inputs | Count fields and links have no upper bound; a large value renders tens of thousands of selects, blocks the main thread for tens of seconds or crashes the tab. | Fix in R1b |
| Aui-04 | Plant, links | A plant link whose `actions=` is a deeply nested array throws an uncaught error in `postMessage` and leaves the plant on "Loading". Reproduced. | Fix in R1b (validate elements, length and depth; catch and refuse) |
| Aui-05 | CI | The Pages workflow runs pytest before it installs Chromium, so the twelve browser-based tests skip silently in CI (probable; the Actions log was not read). | Fix in R1b (reorder the steps) |
| C-01 | Lab, reflow | At 390 and 320 px the Challenge form overflows sideways before a challenge starts (528 px wide); the repository's own matrix check measures the screen only after a start. Reproduced. | Fix in R7 |
| O-04 | Review rubric | Two rubric searches use `git grep -E` with `\b`, which this platform's git ignores, so the overclaiming search always returns nothing (the same pattern with `-P` finds 13 lines in the README). | Fix in R3 (`-P`; the rubric file excluded from its own search) |
| B-01 to B-05 | Guard hooks | Five findings about the command and tool guards. | Withheld until fixed; batch R2 after the author's two decisions |

### Minor

| ID | Area | Finding | Disposition |
|---|---|---|---|
| E-01 | README, ADR process | The decider's notes were transcribed from the author's chat answers into `docs/adr/review_*.json` by the tools and applied by the author with `scripts/adr_accept.py`; README and the ADR index say the notes are the author's own commits. True of the `.md` commits, less precise about the note text. | R4 wording; author to confirm the path (question) |
| E-02 | Ledgers | A deleted assumption id is still cited by A013's notes and by S017's `used_in`; the gate does not check ids inside the ledger files. | Fix in R5 |
| E-03 | Ledgers | `used_in` and `sources` disagree in 65 places; `used_in` holds 21 `README` tokens; three duplicate URLs and one `http://` entry. | Fix in R5 |
| E-04 | Ledger gate | A Korean particle glued to an id (`A046과`) hides it from the id check. | Fix in R3 |
| E-05 | Ledger gate | The public-number rule covers four files; `.tsx`, `.js` and `.sql` are outside the id check; a line with the word "provisional" is exempt as a whole. | Fix in R3 (extensions); scope sentence is an author question |
| E-06 | README | "Every number on the pages carries the id of a ledger entry" and "only main-reread sources back a figure on a public page" are stronger than the rule actually applied (outputs carry no id; weak sources appear with the provisional chip: 72 of the 111 public ids). | R4 wording; author question on the invariant's sentence |
| E-07, Aui-06 | README, CI | The user-track tests pass today but no gate runs them; the README presents their passing as evidence. `pyproject.toml` records them as non-blocking by decision. | R4 wording; R10 adds a non-blocking CI step |
| E-08 | README | "Each increment passes `check_all.sh` before it is committed" is a practice; the git hook checks banned tokens only. | R4 wording |
| E-09 | README | A fresh clone cannot run `check_docs.py` or commit: the banned-token list is not mentioned. | R4 (one sentence) |
| E-10 | README | The Home row does not mention the one-flag card. | R4 |
| E-11, C-22 | README (Korean) | Four of seven pictures on the Korean README are English screens; the first GIF is 3.2 MB. | R6 (Korean results and break-out pictures) |
| E-12 | Design doc | `simulation_spec.md` says it states no simulation result, then line 531 describes a qualitative experiment-2 outcome without its run. | R4 |
| E-13 | Lab, Setup | Five public inputs have range ends that are assumptions (range grade A) while the Setup text says the ledger's range comes from sources. | R5 (range grade in the view) |
| E-14 | Review rubric | Same cause as O-04 (the `\b` searches); the absolute-path search matches its own line. | R3 |
| E-15, E-16 | README | "Working from briefs in `docs/prompts/`" is true of S0–S3 only; `make_media.py` also rewrites the explainer's hero picture (recorded 2026-11-04). | R4 |
| K-01 to K-09 | Public numbers | The fact-checker read 31 claims: none contradicted, 6 with a caveat, 2 with an inferred unit (the S012 viability slopes are quoted "per minute" while the paper gives no unit), 8 with sources that could not be fetched (S013, S017). Also: the 1.4 lower bound of the samples-per-reactor-day range has no ledger basis; 13.3 analyses per hour is the optimistic end; MHRA sections 5.1 and 6.13 are mixed in one sentence; a DOE range reads as a start value. | R4 (wording) and R5 (ledger notes) |
| Aeng-03 | Review rubric | The answer-key search also matches the assembly's key file by design. | R3 (narrower regex) |
| Aeng-04 | Engine, as-of | Module-level caches in `record/asof.ts` key by array identity and length only; safe today, fragile to an in-place write. | R8 (a comment or a cheap stamp) |
| Aui-07, Aui-08 | QA semantics | A plant check that passes on its retry counts as PASS; `--no-engines` reports "not run" as PASS. | R1b (step name) and R10 (a skipped state) |
| Aui-09 | Lab, Setup | A repeated or date-shaped seed is refused by the engine only after Run, in English. | R6 |
| Aui-10 | Lab, Setup | `bay_size` wears the reactor-count ledger id, so its range warning is wrong for bay sizes 1–4. | Author (a ledger id for bay size) |
| Aui-11 | Plant design | The design's overview camera (`O` key, narrow-screen default) is not in the code, and no record says it was dropped. | Author (build or strike it from `plant_ui.md`) |
| Aui-12 | Lab design | `lab_ui.md` section 4's message blocks, section 7's error wording and the section 12 table are older than the code. | Design side moves; R4 |
| Aui-13 | Engine tests | The `it.todo` in `sc07.test.ts` (dilution typed by hand) is a recorded wait for an S2e decision (2026-10-29). | No action (known) |
| B-08 | Guard hooks | The Bash guard's docstring describes an old remote setup. | R4 (docstring) |
| B-10 | Dependencies | The `minimatch` advisory in the ESLint tool chain (recorded 2026-11-03). | Author (override or accept) |
| B-11 | Public bundle | The break-out dictionary is imported unconditionally, so its strings ship in the public bundle while the ledger view assumes they do not. | R5 |
| B-12 | Repository | `.playwright-mcp/` and `coverage/` are not in `.gitignore`. | R3 |
| B-13, F-12 | Node | `engines.node` is a major version only; CI takes the latest 25.x. | Author (exact pin) |
| C-02, C-03 | Korean typography | The lab has no `:lang(ko)` rule, so Korean words break mid-word at phone widths (Home 14, Setup 22, Results 28, Challenge 65 places); flag identifiers split letter by letter in the Setup table at 390 px. | R7 |
| C-04, C-05 | Screen readers | A screen change moves neither focus nor `document.title`; the running `<progress>` has no accessible name and the end of a run is not announced. | R7 |
| C-06, C-07 | Zoom and reflow | At 200 % zoom the plant's action bar is clipped by 61 px; the explainer scrolls 2 px sideways at 320 px. | R7 |
| C-08 | Plant | A lost WebGL context leaves a blank scene with no message (it recovers when the context returns). | R7 |
| C-09, C-10, C-16, C-17, C-18, C-19, F-07 | Explainer and lab, accessibility and language | The story toggle's disabled reason is English-only and unreadable by keyboard; 53 English strings on the Korean explainer carry no `lang`; scrolling figure boxes are unnamed tab stops; the lab has no skip link; refused selects lack `aria-invalid`; the hero picture sits below the fold at 390 px in English; no test pins the explainer's Korean key set. | R7 |
| C-11 | Lab, hierarchy | Run sits at the end of a 5,500 px Setup; Results shows inputs before the first metric. | Feature proposal 6 (layout), otherwise Parked |
| C-12 | Lab, error states | Part of Aui-01 (the check chip stays "Running" after a Worker failure). | R1b |
| C-13, C-14, C-15 | Charts and layout | A spread bar at an axis end is drawn outside the viewBox; the explainer's dark pens sit outside the lightness band; a two-line header clips the plant's action bar at 1440×900 in English. | R6 |
| C-20 | Public site headers | Security headers of the public site. | Withheld; with R2 |
| C-21 | Plant | Leaving and re-entering the plant twenty times grows detached DOM nodes (2,869 to 9,308) and listeners (133 to 646); no leak within one visit. | R7 (measure first, then dispose) |
| F-01 | Structure | Six files are over the 300-line target; only `process.ts` has a recorded exception, and it is stale. | R8 (structure only) |
| F-02, F-03 | QA scripts | The plumbing of the four QA families is duplicated and lives in the first page's module; a `drill` ↔ `drill_results` import cycle; 46 `noqa: E402`. | R8 step 1; step 2 (a package) is an author question |
| F-04 | Python hygiene | 70 `# noqa` comments for a ruff configuration that does not exist; two unused imports. | R8 (imports); ruff itself is an author question |
| F-05 | Lint scope | `site/infographic/src/*.js` and `eslint.config.js` are linted by nothing; the `Math.random` search skips `.tsx`. | R3 |
| F-06, F-08 | Dead code | Six i18n keys are used nowhere, one key is defined twice; one engine export is never read. | R8 |
| F-09 | Test time | One Vitest file (`invariants_s1b.test.ts`, 201 s) sets the wall time of the whole run (191 s). | R9 (split by seed range) |
| F-10, F-11 | CI | The 90-minute comment rests on the private runner; the I12 budget prints no load average. | R10 |
| O-01 | Lab, wording | A zero-denominator metric shows "reason: undefined in every seed", which reads like a leaked `undefined`. | R6 |
| O-02 | Lab, navigation | No screen of the lab links to the code, the design notes, the ADRs or the ledgers; the explainer's footer is the only way. | R6 |
| O-03 | Explainer | Two of the ten flag toggles change nothing in the outcome matrix (they act in break-out cases only) and the page does not say so. | R4 (one line) |
| S-03 | Engine, injection | Adding a reactor changes the neighbour-tube target of 24 of 187 label errors in the other reactors (the draws themselves are unchanged). | Author (spec wording or same-unit neighbour) |
| S-04 | Engine, labels | Preset B's labelling is a pre-printed barcode, but every sample is recorded as hand-labelled; the spec attributes the limit to a setting the code does not read. | Author (spec or code) |
| Aui-14 | Lab, browser check | The 404 and altered-reference states behave as designed. | No action |

## Withheld

Eleven findings concern the command and tool guards of the Claude Code harness and the HTTP headers of the public site. Per the audit's rule they stay out of public files until the fixes land; they are batch R2, which needs two decisions by the author first. The counts above include them.

## Questions for the author (public ones)

1. Keep the current ADR-note path (chat answer → JSON by the tools → applied and committed by the author) and describe it exactly in the README and the ADR index, or amend ADR-0002?
2. Is the README's break-out screenshot a "public page" in the sense of ADR-0013, given that the public build refuses the screen?
3. Restate invariant 3 as the rule actually applied (weak sources allowed with the provisional chip), and put `docs/design/*` and the ADRs under the public-number gate?
4. Mechanise the 300-line rule with an ESLint `max-lines` and an exception list, or keep it a review item?
5. Add ruff as a dev dependency (and a configuration), or delete the `# noqa` comments?
6. Take the QA restructure to a package (step 2), or stop at the flat step 1?
7. Pin Node to an exact version, or rely on the ADR-0016 canary?
8. Is a lazily loaded DuckDB-WASM chunk that runs the three reference queries in the browser worth a Proposed ADR (it touches ADR-0003's bundle rule)?

## Feature proposals

Ten ranked proposals are in the private report (a "read more" path from the lab to the code and the documents; a "what this record cannot answer" panel; a model card; the reference SQL in the browser; a data-package download; a comparison layout for Results; a break-out tour for the local build; Korean pictures and a lighter README first paint; Firefox and WebKit in the Pages workflow; SC8 in Setup). None states a simulation result.
