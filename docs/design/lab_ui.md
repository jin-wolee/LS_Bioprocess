# Lab UI design note

Status: S3a deliverable (`prompts/30_S3_lab_ui.md` Steps 0 and 1), written for the build batches that follow (Steps 2 to 6), amended in S3a2 for the author's answers of 2026-10-30 (Open, items 1, 3 and 5). Synthetic data only. No simulation result of the lab exists yet and this note states none. The author's decisions are taken as given and not reopened: Preact pinned, the lineage view drawn as SVG by the page, the engine in a Web Worker (ADR-0018, ADR-0003), the browser check of ADR-0016 as ADR-0019 changes it (the engine's own deterministic maths, one strict comparison), ninth flag `material_lot_links` (ADR-0017), the challenge "find the error in the record" with a sample variant and a decision variant, the provisional chip for figures on sources below `main-reread`, and the label-error sentence (spec section 5, "Notes from S2g"). ADR-0016 to ADR-0019 were decided in chat on 2026-10-30; their status lines stay as the author leaves them.

Numbers in this note: domain numbers carry the `A###` or `S###` id of the ledgers; budgets are those of `prompts/00_master_build.md` section 4; the measurements and findings of section 12 come from a throwaway spike of 2026-10-30 and are the project's own measurements of its tooling and runtime, so they carry no ledger id (the precedent is the Evidence section of ADR-0016).

## 1. What the lab is, and the rules it keeps

A static page in which a reader runs the synthetic plant in the browser, records it under architectures A, B and C (and C with one flag off), sees what each record can reconstruct, follows one sample through each record, and tries the challenge. Later it shows the contamination break-out of SC12. It makes no claim about a real plant and predicts nothing (spec section 10).

| Rule | What it means in the lab |
|---|---|
| Truth and recorded world stay separate (invariant 1) | The page never receives a truth log, a hidden field or the answer key. Truth reaches the page only as plain data that a Worker message carries on purpose (a verdict, a reveal), and never before the reader has acted (sections 4, 8, 9). |
| Determinism (invariant 2) | The page draws no random number. `Math.random` is banned in `src` as in `engine/src` (`check_all.sh` greps both). Every lab draw (the challenge) is keyed by the canonical tuple (section 9). Elapsed times use `performance.now()` in the Worker and the page, never in a result. The engine's maths is its own (ADR-0019), so a seed gives the same bytes in every JavaScript engine; the browser check (section 7) tests that on every load. |
| Every number carries an id or a result label (invariant 3) | Section 6. |
| No result before it exists (invariant 9) | The shipped files hold no result: every number the page shows as an output is computed in the Worker on this visit. |
| Headless browsers only (invariant 7) | The end-to-end tests (section 12) run headless Chromium through Python Playwright and close it. |
| No publishing (invariant 6) | The Pages workflow (section 13) is a file the author runs. |

## 2. Stack and layout

- Preact 11.0.1, exact (ADR-0018; the newest release at least two weeks old on 2026-10-30; 11.0.2 is newer than that, so it is not used). Vite 8.3.5 is already pinned and compiles Preact JSX by itself: the spike built a Preact page with `oxc: { jsx: { runtime: "automatic", importSource: "preact" } }` in its Vite config and no plugin, so no Vite plugin is added. TypeScript needs `jsx: react-jsx` and `jsxImportSource: preact`; the spike page passed `tsc` 6.0.3 with the options of the repository's `tsconfig.json` and passed `eslint` with the existing `eslint.config.js` unchanged.
- No other UI dependency: no router (hash routes, a few lines), no state library (hooks and one reducer in context; the signals package of ADR-0018 is not added), no chart library (range bars and the lineage view are SVG drawn by the page), no font files and no external request: a system font stack. The end-to-end test fails on any request to another origin.
- Layout. Names are the executor's call, the zones are not.

| Path | Role |
|---|---|
| `src/index.html`, `src/main.tsx` | The Vite root of the lab, mounts the app and creates the Worker. Its config is a new file, `vite.lab.config.ts` (`root: "src"`, `base: "./"` so the build works under any Pages path, output `dist/lab/`, the JSX options above); the existing `vite.config.ts` keeps its Vitest root and flags. |
| `src/ui/**` | Screens and components (section 3). |
| `src/protocol.ts` | The message shapes of section 4, types only. |
| `src/i18n/en.ts`, `src/i18n/ko.ts` | Texts (section 10). |
| `src/generated/ledger_view.json` | Grade, status, range and sources of the ids the lab names, written from the ledgers by `scripts/lab_ledger.py --write`, committed, and compared with a fresh generation by a pytest test (section 6). |
| `src/worker/worker.ts` | The Worker entry. The only file of `src` with value imports from `engine/`. |
| `src/worker/data.ts` | The bundled JSON: the scenarios, profiles, architectures, evaluation settings and dialects the lab offers, imported by Vite; for the decision variant of the challenge also `sc08_ph_restandardisation` (reachable from the challenge only, not from the Setup picker) and the seed list of `experiment2.json`. The engine reads no file; it is handed parsed JSON. |
| `engine/src/experiments/assembly/lab/*.ts` | The Worker-facing functions: one per request of section 4 (run, lineage, challenge, check, later break-out). They live in the assembly folder because they read truth the way the assembly does (spec section 3, rule 2) and so need no change to the import zones of `eslint.config.js`. |

- Import boundary (checked by a new `no-restricted-imports` object for `src/**` in `eslint.config.js`, added without touching an existing object, and by a test beside `engine/tests/contract/import_zones.test.ts`):

| Importer | May import | May never import |
|---|---|---|
| `src/ui/**`, `src/main.tsx`, `src/i18n/**` | `preact`, `src/protocol.ts` (types), `src/i18n`, `src/generated/ledger_view.json`; `import type` of `engine/src/generated/metrics.schema` and `experiment_report.schema` | any value import from `engine/` or `scenarios/` |
| `src/worker/worker.ts` | `engine/src/experiments/assembly/lab/*`, `src/worker/data.ts`, `src/protocol.ts` (types) | a truth module directly (`process`, `sampling`, `analysis`, `measure`, `instrument`, `stability`, `sensors`, `run`), `evaluate/answer_key.ts`, `raw/key.ts`, `generated/event.schema` (it carries the hidden fields), any test file |
| `engine/src/experiments/assembly/lab/**` | what the other assembly files import | `evaluate/answer_key.ts` and `raw/key.ts` (zones 2 and 5 already refuse them); Node-only modules (the Web Worker rule) |

  The page itself therefore imports no engine module at all. The list of flags, the engine version and the schema version reach it in the `ready` message, so the page never hard-codes how many flags exist.
- Build commands: `npm run build:lab` runs `scripts/lab_ledger.py` in check mode, the reference script of section 7 under the engine's Node flags, and then `vite build -c vite.lab.config.ts`. `npm run check` gains `src` in `lint` and `typecheck` and `src/**/*.test.ts` in the Vitest include. Nothing in `vite.config.ts`, `tsconfig.json` or `eslint.config.js` is loosened; each only gains what the lab needs, and the batch report includes their diff (`prompts/30`, allowed paths).
- Routing: `location.hash`. The path picks the screen; the query carries the shareable state (section 4). A link carries `schema_version`, `engine_version` and the seeds (spec section 3, rule 4); a link made with another engine version shows a banner and runs anyway.

## 3. Screens

| Screen | Purpose | Shows | From which engine output | Built in |
|---|---|---|---|---|
| Home | States what the lab is and runs the default scenario once so the reader sees the synthetic plant produce events. | The notice (synthetic, not a prediction); the browser-check chip; engine and schema version; the count of events by type of one run; the inputs of the default scenario with their ids. | `ready` payload; the check message; `summary` of one `runScenario` (counts per event type, as in `tests/golden/*.summary.json`). | Step 2 |
| Setup | Lets the reader choose what to run. | Scenario picker (`default`, `sc02_shift_burst`, `sc03_feed_in_gap`, `sc05_one_analyzer_down`); N reactors, M analyzers and the profile of each bay and each analyzer (ADR-0015); preset picker A, B, C and C with one flag off; the capture path (`manual_transcription`, `adapter_ingest`) with the dialect sentence of section 10; seeds; the flag matrix (section 11). Every input with its id and a warning when a typed value lies outside the ledger range of its id (00 section 2, item 8). | `ready` payload (the bundled JSON, so the ids come from the files). | Step 3 |
| Results | Shows what each architecture reconstructs, as a distribution over seeds. | Per architecture the metrics of spec section 8 with the median and the percentile range the report gives (data_model section 7, "Seed aggregate"; "a spread across seeds, not a confidence interval", as the report says), the seed count, the denominator and the `status` of each row (`reported`, `none_occurred`, `not_evaluable`, `not_modelled`, `not_applicable`) with its reason in words; one SVG range bar per metric; recall always beside precision and false-alarm rate (spec section 8, rule 3); the label-error sentence next to the detection metric; no composite score and no rank column. | `runOpenLoop` per seed, then `buildReport` (`schemas/experiment_report.schema.json`). | Step 3 |
| Notes | Says what the numbers are and are not. | Scope and non-goals (spec section 10); the grades (sourced, proxy, derived, assumed) and the provisional chip; the dialect sentence; the main-reread sources behind the ids shown; versions. | Static text and `ledger_view.json`. | Step 3 |
| Lineage | Follows one sample through the record of each architecture. | Section 8. | `lineage` message; `runSeed` datasets. | Step 4 |
| Challenge | The reader searches one record for the planted error (a sample, or a decision made on a wrong input), then sees the truth. | Section 9. | `challenge_*` messages. | Step 4 |
| Break-out (SC12) | Shows, per architecture, what the walk-back finds after a contamination signal. | The scripted event (type, origin, A176 and A177 inputs printed), the observable timeline (`signal_observed`, `hold_placed`, `confirm_result`, `result_reflagged`), directions 1 and 3 with their sets, and the extension metrics of spec section 11.6 with the same rules as section 8. Direction 3 in a record without `material_lot_links` reads "not reachable from this record", never an empty set. | `breakout` message (Step 5 engine). | Step 6 |

Only Results and Break-out show distributions; Lineage and Challenge are one seed. Results need at least the minimum seed count of A103 to be called a comparison: with fewer, the report's `meets_min_seeds` is false and the page says so beside every spread. The default seed list is the first 20 of `scenarios/experiments/experiment1.json` (A103); the reader may take up to the whole list, or type neutral integers that pass the same rules as the experiment config (no repeat, not date-shaped). Review timing stays at the default ("next shift start", A215); the sensitivity variants are not offered (parked).

## 4. The Worker protocol

One module Worker, created by the page at load. Messages are plain data (`structuredClone`-safe: no function, no class instance, no typed array of a hidden series). `src/protocol.ts` holds the shapes. Both sides are one build, so the page trusts the Worker's messages; the Worker does not trust a `RunSpec`, because a link is user input: it checks the scenario id, the names of the settings against a whitelist, the architecture ids and the seeds (the rules of the experiment config) and answers `invalid_spec`.

```ts
// page -> Worker
type Request =
  | { type: "run"; id: number; spec: RunSpec }                                   // Results, Home
  | { type: "cancel"; id: number }
  | { type: "lineage"; id: number; spec: RunSpec; seed: number; pick: { rule: "sc3" } | { sample_id: string } }
  | { type: "challenge_start"; id: number; variant: "sample" | "decision"; spec: RunSpec; seed: number; shown: string }
  | { type: "challenge_open"; id: number; challenge: string; sample_id: string }
  | { type: "challenge_guess"; id: number; challenge: string; target: { sample_id: string } | { decision_id: string } }
  | { type: "challenge_giveup"; id: number; challenge: string }
  | { type: "breakout"; id: number; spec: RunSpec; seed: number; event: BreakoutSpec }; // Step 6

interface RunSpec {
  schema_version: "1";
  scenario: string;                          // id of a bundled scenario
  settings: Record<string, number>;          // replaces only the `value` of named scenario settings (N, M, ...); unit and ref stay
  bay_profiles?: string[];                   // ADR-0015, once the engine has it (section 14, Step 3)
  analyzer_profiles?: string[];
  capture_path?: "manual_transcription" | "adapter_ingest";   // overrides every preset; turns the raw layer on
  architectures: string[];                   // "a_manual", "b_lims_lite", "c_context", "c_context_minus_<flag>"
  seeds: number[];
}

// Worker -> page
type Response =
  | { type: "ready"; engine_version: string; schema_version: "1"; flags: string[]; min_seeds: number; seed_list: number[];
      scenarios: ScenarioInfo[]; presets: PresetInfo[]; evaluation: RefValue[]; challenge_variants: ("sample" | "decision")[] }
  | { type: "check"; state: CheckState; detail: CheckDetail }
  | { type: "progress"; id: number; done: number; total: number }
  | { type: "result"; id: number; summary?: RunSummary; report?: ExperimentReport; footer: ResultFooter }
  | { type: "lineage"; id: number; view: LineageView }
  | { type: "challenge_ready"; id: number; challenge: string; announced_type: string; record: RecordView | DecisionRecordView }
  | { type: "sample_record"; id: number; sample: SampleRecord }
  | { type: "challenge_reveal"; id: number; reveal: Reveal }
  | { type: "breakout_result"; id: number; result: BreakoutResult }
  | { type: "error"; id: number | null; code: "invalid_spec" | "locked" | "cancelled" | "engine_error"; message: string };

type CheckState = "pending" | "identical" | "failed" | "error";
interface CheckDetail {
  runs_ms: number[];                                      // the five timed runs of seed 1 (section 12)
  truth: { seed: number; equal: boolean }[];              // the strict log hash against the reference, seeds 1 to 3
  repeats_equal: boolean; cells_equal: boolean;           // the five repeats agree; the digest of the metric cells equals the reference
  reason?: string;                                        // only in the state `error`
}
interface RunSummary { events: number; event_counts: Record<string, number> }
interface RefValue { name: string; value: number | string; unit: string; ref: string }    // ref is an A### or S###
interface ScenarioInfo { id: string; description: string; settings: (RefValue & { range?: [number, number] })[]; profiles: Record<string, string> }
interface PresetInfo { id: string; role: "preset" | "ablation"; ablated_flag: string | null; flags: Record<string, boolean>; labelling: string; capture_path: string }
interface ResultFooter { kind: "simulation_result"; scenario: string; seeds: number[]; engine_version: string; architectures: string[]; inputs: RefValue[]; check: CheckState }
```

The one-seed requests (`lineage`, `challenge_start`, `breakout`) take their seed from `seed` and ignore `spec.seeds`. The shapes of `LineageView` (section 8), `RecordView`, `DecisionRecordView` and `Reveal` (section 9) are given below; `SampleRecord` is the drill-down of one sample in the shown record (the `LineageView` column of that record without truth and verdicts); `BreakoutSpec` and `BreakoutResult` are set in Step 6 from spec sections 11.4 and 11.6. Every one is a tree of numbers, strings, booleans, null and arrays. `ready.challenge_variants` lists the variants the build offers (`decision` only once the closed-loop batch of section 14 has landed), so the page never assumes a variant exists. A `challenge_start` for a variant that is not listed, or a `decision` variant on any scenario but `sc08_ph_restandardisation`, is answered with `invalid_spec`.

What runs inside the Worker, by request:

| Request | Runs in the Worker |
|---|---|
| (startup) | `loadScenario` of the bundled JSON, the browser check (section 7), then `ready`. |
| `run` | Per seed: `runScenario` (truth), then `runOpenLoop` for that one seed with the chosen architectures (inject, record, validate, review, evaluate); the Worker yields to its event loop between seeds, posts `progress`, concatenates the per-seed outcomes and calls `buildReport` once. `cancel` sets a flag read between seeds. A run with one seed and no architectures returns the `summary` only (Home). |
| `lineage` | One seed of the scenario through `runSeed` for A, B and C (and any ablation named), the pick rule on the truth log, the analyst's three questions against each dataset, the realised errors from the injector's plain output. |
| `challenge_*` | Planting, the shown record, the guess and the reveal (section 9). The decision variant runs the closed loop of one seed (`runClosedLoopSeed`, SC8) twice, without and with the plant, and posts `progress` between the two. The planted error lives in Worker memory under the challenge id and leaves it only inside `challenge_reveal`. |
| `breakout` | The SC12 script, the three recorders, the walk-back and the extension metrics (Step 5 engine, Step 6 screen). |

Rules of the protocol, each with a test:

1. The page imports no engine module (section 2). A request is a `RunSpec` or an id; there is no way to ask for a truth log, an event stream, the answer key or the raw quirk key.
2. `lineage` is refused with `code: "locked"` for any run that is an unrevealed challenge, so the lineage screen cannot be used to read the truth of a challenge in progress.
3. Before `challenge_guess` or `challenge_giveup` no message carries the planted sample, its detail, the affected decisions or any `reveal` field (section 9).
4. Engine exceptions (a scenario that fails validation) arrive as `error` with the engine's English message, shown verbatim in a `lang="en"` block under a translated heading.
5. A shareable link is `#/<screen>?scenario=…&arch=…&seeds=…&schema=1&engine=<version>`; it holds the spec, never a result.

## 5. Engine additions the Worker needs

Most are small, plain-data functions in `engine/src/experiments/assembly/lab/` (or a structure-only move of existing test-support code first, per Tidy First: the move lands alone, tests green before and after, then the behaviour). Two rows are not of that kind and say so: the deterministic maths, which is its own batch, and forced errors in the closed loop, which is a mechanism.

| Addition | Why | Origin |
|---|---|---|
| The engine's own deterministic `log`, `exp` and `cos` in place of the native ones, with the lint rule of ADR-0019 | The strict browser check (section 7): a seed gives the same bytes in every JavaScript engine. | Batch S3m (ADR-0019, Proposed), before Step 2. The goldens are regenerated once, only if the logs differ in float fields alone, with the author's approval recorded in `docs/progress.md`. |
| `outcomeOf(planted, dataset)` returning `prevented`, `invisible` or `detected` with the evidence names | The reveal (section 9). | A generalisation of `classify` in `engine/tests/support/cells.ts`, whose hand-typed expected cells (`cell_tables.ts`) stay the oracle. |
| The three questions of the lineage view and the pick rule | Section 8. | Moves from `engine/tests/support/trace_sample.ts`; the fixture `tests/fixtures/trace/single_sample_trace.json` stays read-only and is the oracle. |
| `SeedOutput` gains the injector's `materialised` list per architecture (plain data) | The reveal and the lineage view name the realised errors without reading the answer key (spec section 3, rule 2: the evaluator is its only reader). | Addition to `runSeed`; no existing field changes. |
| Mixed-fleet fields of ADR-0015 | The N by M controls with a profile per bay and per analyzer. | Section 14, Step 3. |
| Forced errors in the closed loop: `buildShared` (`assembly/closed_loop_shared.ts`) runs `inject` with a `forced` list before it records, maps each recorded pH row to the result it stands for with `physicalIds` (`assembly/physical_ids.ts`), and `runArm` returns a decision log (tick, action, the row read with the container and hold time the arm saw, taken from the arm's own `recordedContext` exported as it is and never re-derived) beside its counts; `buildShared` keeps the injector's `materialised` list per architecture for the background rule | The decision variant of the challenge (section 9). Experiment 2 records the lab run once, with no injector, today. | A new mechanism, not a move: the spec does not yet say how a mislabelled pH row reaches an arm. Spec first (a clarification of `data_model.md` section 7, "Experiment 2"), then red tests: with no `forced` the closed-loop report and the SC8 tests are byte-identical to today, and `decideReadjust` is not edited. Proposed batch S3d, before Step 4 (section 14; Open, item 8). |
| `challenge_decision.ts` in `engine/src/experiments/assembly/lab/`: the eligible samples from the unplanted loop, the plant, the planted loop, the affected decisions, the reveal | Section 9. | New; in the assembly folder because it reads truth the way the assembly does. Built in Step 4 once S3d has landed. |
| Material lots, the event script, `material_lot_links` | SC12. | Step 5, as `prompts/30` says. |

## 6. Numbers on the page (invariant 3)

Every number the page shows is in exactly one of three places, and a number anywhere else is a defect that the end-to-end check `numbers` finds (it walks every text node that contains a digit).

| Class | Marker | What it shows |
|---|---|---|
| Input | `<Ref ids>` renders `data-ref="A001"` | The value and unit from the scenario, profile, architecture or evaluation file, its `S###`/`A###`, the grade word (sourced, proxy, derived, assumed) and, when any source that the id follows to is not `main-reread`, a dashed `provisional` chip. A grade-A id with no source reads "assumed" and is not provisional. |
| Output | `<ResultBlock>` renders `data-result` | The label "Simulation result", then the scenario id, the seed list (or its count and ends), the engine version, the architecture ids and the browser-check state; the inputs the metrics used (SLA threshold A097, staffed window A098, hold limit A046, seed minimum A103) with their ids. Outputs have no id of their own; their thresholds do. |
| Label | `data-label` | Identifiers and counts of things on screen: seed values, sample ids, row counts, clock stamps of a record, version strings. They sit inside a result block or a list the screen names. |

- The ids come from the files the Worker bundles: each parameter is `{value, unit, ref}` (ADR-0012), so `ScenarioInfo.settings`, the profile lists and `ResultFooter.inputs` carry them. Static texts that cite an id use `<Ref>` in the dictionary. The grade, the status and the range of an id come from `src/generated/ledger_view.json`, written by `scripts/lab_ledger.py --write`, which reads `docs/research/assumptions.yaml` and `sources.yaml` (the reader of `infographic/build.py` is the model) for exactly the ids that the shipped JSON and the dictionaries name, and fails on an unknown id. The file is committed, and a pytest test regenerates it and fails on drift (the pattern of the trace table in `single_sample_trace.md`), so a grade change in a ledger shows up in the next check. A unit test checks that every shipped `ref` resolves. The ledgers are never edited by the lab.
- Provisional figures. The infographic shows a figure that rests on a source below `main-reread` with a dashed provisional chip, and the lab does the same. This is the author's reading of invariant 3 (chat, 2026-10-30: "점선 '잠정' 칩과 함께 표시 (Recommended)"; Open, item 3). Extension figures are stricter: ADR-0013 says nothing from the extensions goes on a public page until its sources are re-read, and every source behind A135 to A158 is below `main-reread` (spec section 11 header). The public build therefore refuses the Break-out screen while any id it shows follows to such a source (Open, item 2).
- Inputs without a default (A176, A177) are chosen by the reader on the Break-out screen and printed with every result as "assumed input".
- The decision variant of the challenge (section 9) shows recorded pH values, clock stamps of the ticks and sample ids as labels inside the record it names, and prints the inputs of the loop with `<Ref>`: the readjustment switch and interval (A051, A108), the hold limit (A046), the open-sample and hold effects (A041 to A043) and the technique-error probability (A064). It computes no metric and shows no effect size; its record and decision list sit in a result block (scenario, seed, engine version, architecture, check state) like any other output.
- A result is never worded as a fact: "simulation result under the inputs shown", with scenario and seeds, and the notice of Home ("synthetic, not a prediction of a real plant") stays visible on every screen as a one-line footer.
- The page ships no sentence that contains a result. Text about a mechanism says what a flag does; it never says which architecture wins, and no text or test states an ordering of architectures (00 section 2, item 8).

## 7. The browser check of ADR-0016 under ADR-0019

ADR-0016 leaves the browser open and suggests that the page recomputes the default scenario's log hash and compares it with a shipped one. On the engine as it stood when this note was first written that comparison failed: the spike (section 12) found that **a strict hash computed in a browser differed from the hash computed in Node on the same machine, in every browser tried**, because the engines' maths libraries give different last digits for `Math.log`, `Math.cos` and `Math.exp`, which the engine calls for every Gaussian and exponential draw. The first version of this note designed a second, rounded tier around that finding. The author then decided to remove the cause (chat, 2026-10-30: "결정적 수학 함수로 교체"; ADR-0019, Proposed; Open, item 1): the engine uses its own deterministic `log`, `exp` and `cos` (batch S3m, which lands before the lab shell, section 14), so a seed gives the same bytes in every JavaScript engine. The check is therefore ADR-0016's plain comparison, strict, with no tolerance and no second tier.

**What is checked.** Three things, all strict, all computed in the Worker at startup:

| Part | What | Meaning when it passes |
|---|---|---|
| Truth | `logHash` (SHA-256 of the canonical JSONL of the truth log, `canonicalJsonl(runScenario(cfg).events)`, sensor ticks excluded) of the default scenario for seeds 1, 2 and 3 (the seeds of the goldens, spec section 7), each against the reference | The truth world is byte-identical to the reference build. |
| Repeats | Seed 1 run five times in a row inside the Worker; the five `logHash` values must be equal; no reference is needed | No run-to-run change: this is the signature the miscompile of ADR-0016 left in Node. |
| Cells | SHA-256 of the canonical JSON of the metric cells of seed 1 under A, B and C, against the reference | The recorders and the evaluator (where the miscompile was found) are byte-identical to the reference. |

**Where the reference comes from.** `npm run build:lab` first runs `engine/tests/support/lab_reference_cli.ts` (the path ruled in Open, item 7; it sits with the other CLIs, imports `require_node_flags.ts` and so runs with `--no-maglev-escape-analysis`, ADR-0016). It recomputes the three truth hashes in Node and **refuses to build if they differ from the `log_hash` of `tests/golden/default_seed{1,2,3}.summary.json`** (the goldens as batch S3m regenerates them once, under the author's approval; no check regenerates them). A stale or miscompiled build therefore cannot ship a wrong reference. It then computes the cell digest and writes `reference.json` beside the page: the engine version, the Node version and flags, and the hashes. The Worker fetches this small file (same origin) at startup; a separate file lets the end-to-end test swap it.

**What the page says.** The state is one of four:

| State | When | Banner (English; the Korean text follows the rules of section 10) |
|---|---|---|
| `pending` | the Worker is running the check | "Browser check running. Results shown now are unchecked." |
| `identical` | the repeats agree and every hash equals the reference | "Browser check passed: this browser reproduces the reference run byte for byte." |
| `failed` | the repeats disagree, or any hash differs from the reference | "Browser check FAILED: this browser gave a different result from the reference. Results below are not reproducible. The page cannot tell a compiler fault from another engine difference." The result blocks keep their numbers, marked "not verified". |
| `error` | the Worker could not run the check (no module Worker, no `crypto.subtle`, `reference.json` missing) | "Browser check could not run: {reason}. Results are unchecked." |

A strict difference is `failed`; there is no softer state for a difference in the last digits, because ADR-0019 removes the only known source of one. `CheckDetail` says which part differed (`truth`, `repeats_equal`, `cells_equal`) so the author can see it; the banner does not guess a cause. If Firefox or WebKit read `failed` in the optional `engines` check (section 12), that is a finding about another engine difference (the open question of ADR-0019), to be fixed in the engine, not tolerated in the page. The lab's `engines` check is expected to read `identical` in both.

**No result is called reproducible before the check passes.** The word "reproducible" and the passed chip appear only in the state `identical`; every result block carries the state it was shown under (`pending`, `failed` and `error` read "unchecked" or "not verified"), and the check message re-labels blocks shown while it was pending. The Notes screen states the reach of the check: it covers the default scenario's three seeds and one set of cells, so a run of another configuration is "not covered by a reference" and says so in its footer; it is evidence about this browser, not a proof for every run. A pending result is never dropped, only labelled.

The check's timings are reused as the time budget (section 12): the five timed runs of seed 1 use the I12 marks.

## 8. The lineage view

**Reference case.** The S2d single-sample trace (`docs/design/single_sample_trace.md`): SC3, seed 1, the sample picked by the stated rule, three questions (unit, `sampled_at`, process context) answered from each record and judged against truth. The lab's view of the same sample must give the same three answers and verdicts as the read-only fixture `tests/fixtures/trace/single_sample_trace.json`; the end-to-end test compares them.

**What it shows.** One physical sample, one column per chosen record (A, B, C by default; any ablation of C may be added). Each column draws the rows the record actually stores for the sample, as nodes, and the keys that join them, as edges:

| Node (table of data_model section 2) | Key it carries | Edge to the next node |
|---|---|---|
| `sample` | `sample_id`, `unit_id`, `batch_id`, `sampled_at`, `planned_at`, `operator_id`, `container` | `analysis_request` by `request_id` |
| `analysis_request` | `request_id`, `control_id` | `run` by `request_id` |
| `run` (one per attempt and visit) | `run_id`, `attempt`, `visit`, `analyzer_name`, `started_at`, `qc_outcome` | `instrument_state` by `instrument_state_id` when stored; a rerun is a further run of the same request |
| `result` (one per version) | `result_id`, `version`, `value`, `measured_at`, `available_at`, `state` | `superseded_by` along `supersedes`; to its `run` by `run_id` |
| `process_context` (a view) | `join_basis`, `join_time`, `feed_epoch`, `batch_phase` | dashed edge from the sample, labelled with the join basis (`sampled_at` or `measured_at`) |
| `audit_event`, `validation_finding` | `rule`, `target`, `status` | attached to the row they concern |

The recorder of S2 stores keys, not `lineage_edge` rows, so the edges are those keys, named after the data_model relation each one stands for (`measured_in`, `superseded_by`, `rerun_of`); no aliquot is drawn because none is recorded. With the extension (Step 6) the batch gains `consumed_in` and `seeded_from` edges to its lots, drawn the same way.

A truth column sits at the left (unit, true `sampled_at`, true process context) and the three questions run along the bottom of each record column with their verdict.

**How a field is drawn.** Shape and text carry the meaning; colour only repeats it (ADR-0011: a status keeps one meaning in every theme; contrast is checked per theme):

| Case | Drawn as | Text |
|---|---|---|
| `correct` | solid outline | the value, then "correct" |
| `wrong` (answered, differs from truth) | solid heavy outline with a cross mark | the recorded value, then "wrong, truth: {value}" |
| `unanswerable` (the record stores nothing to answer with) | dashed hollow outline | "not stored" |
| an edge whose key is null | a stub line that ends in a gap | the missing key named, "no link stored" |

`unanswerable` is a field the architecture does not store; the view never guesses a value. Under each column the view lists "errors the injector materialised on this sample in this architecture" from the injector's plain output (production rates; spec section 6.1), so a verdict is never blamed on the wrong cause, as the S2d table does. The sample is chosen by the pick rule of S2d for SC3 or by the reader from a list of the run's samples.

```ts
interface LineageView {
  sample: { sample_id: string; unit_id: string; picked_by: "sc3_rule" | "reader" };
  truth: { unit_id: string; sampled_at: number; context: { feed_epoch: number; batch_phase: string } };
  columns: {
    architecture: string; flags_on: string[]; labelling: string;
    nodes: { id: string; table: string; key: string; fields: { name: string; value: string | number | null }[] }[];
    edges: { from: string; to: string | null; relation: string; basis?: "sampled_at" | "measured_at" }[];
    answers: { question: "unit" | "sampled_at" | "process_context"; answer: unknown; verdict: "correct" | "wrong" | "unanswerable" }[];
    realised_errors: { type: string; detail: Record<string, string | number> }[];
  }[];
}
```

## 9. The challenge: find the error in the record

The challenge has two variants. In the sample variant the reader looks for a sample whose record is wrong; in the decision variant (the end of this section; the author put it into version one on 2026-10-30, Open item 5) the reader looks for a decision that was made on a wrong input. Both plant one error from the injector's catalogue, keyed by the canonical tuple, and both end in a reveal that the page cannot show earlier.

**What is planted (sample variant).** One error, from the injector's catalogue only (`engine/src/inject/types.ts`, `ERROR_TYPES`). The catalogue has two kinds: the drawn types `label_error`, `unit_rekey` and `duplicate_replay`, which the injector can be forced to materialise on a named sample (`ForcedError`), and the structural types (feed in the gap, lost rerun, unattributable record, planned versus actual) and `clock_offset`, which follow from the stream, the flags or a per-analyzer setting and are not placed on one sample. The challenge plants the drawn types; the others are present by construction (below) and are never the planted one.

**Which record the reader sees.** One architecture, chosen on the start screen from A, B and the ablations of C. The announced type is one that the shown architecture does not prevent (`prevented` in `engine/src/inject/catalogue.ts`), because a prevented error leaves nothing in the record. C itself is listed as disabled with the reason "every drawn type is prevented in C": all of its relevant flags are on. The type is announced ("a label error was planted"); the sample is not.

**How the planted error is drawn (invariant 2).** The run seed is the challenge seed (a neutral integer from the experiment list, or typed under the experiment-config rules). Two keyed draws, both with the canonical key tuple `(run_seed, physical_sample_id, analyte, attempt, purpose)`:

| Draw | Key | Use |
|---|---|---|
| Type | `(run_seed, "challenge", "-", 0, "challenge:type")` | index into the types the shown architecture does not prevent, in catalogue order |
| Sample | `(run_seed, <sample_id>, "-", 0, "challenge:pick")` for every eligible sample | the eligible sample with the smallest `u` is planted |

The sample draw is one value per sample and the plant is the minimum, so adding a sample or rerunning the lab never changes another sample's draw (spec section 3, rule 3). A sample is eligible when it was drawn, has at least one measured result, and, for `label_error`, has a neighbouring draw whose id the label takes (as the production content of a label error does), for `unit_rekey` when another unit exists (its target unit is one more keyed draw on the sample with purpose `challenge:rekey_unit`). Nothing is keyed by a label text. The planted error enters the run through `runSeed`'s `forced` input, which bypasses the rates, so the only random errors of the run are the planted one; the structural errors stay as they are in every run.

**What the reader can open.** Tables of the shown record only: the samples (id, unit, batch, the times the record stores), the results (value, times, version, state), the validation findings the record's own rules raised, the audit events where `audit_trail` is on, and for one sample the lineage drill-down of section 8 with the truth column and the verdicts left out. No truth log, no other architecture's record, no planted list, no answer key. The record travels as plain data in `challenge_ready` (the recorded rows are observable by construction); the drill-down is the `challenge_open` message. Where the outcome in the shown record is `invisible`, no rule shows the error; the reader may still find it by reading the data (a result that does not fit the process values of its unit, a result row twice) or may not, and the reveal says which record could have shown it. That is the point of the comparison, not a defect of the game.

```ts
interface RecordView {
  architecture: string; flags_on: string[];
  samples: { sample_id: string; unit_id: string; batch_id: string | null; sampled_at: number | null; planned_at: number | null; state: string | null }[];
  results: { request_id: string; analyte: string; version: number; value: number; measured_at: number; available_at: number | null; state: string | null }[];
  findings: { rule: string; target: string; severity: string; status: string }[];
}
interface Reveal {
  planted: { type: string; affected: string[]; detail: Record<string, string | number> };
  score: { result: "hit" | "background" | "miss"; background_type?: string };
  per_architecture: { architecture: string; outcome: "prevented" | "invisible" | "detected"; evidence: string[]; reading: string; decision_same?: boolean }[];
  lineage: LineageView;
  decisions?: {                                            // decision variant only
    affected: string[];                                    // decision ids
    rows: { decision_id: string; read_as: string; from_sample: string; value: number;
            record: { container: string | null; hold_s: number | null }; truth: { container: string; hold_s: number } }[];
  };
}
// decision variant (offered only when ready.challenge_variants lists it, once the closed-loop batch of section 14 has landed)
interface DecisionRecordView {
  architecture: string; flags_on: string[];
  samples: (RecordView["samples"][number] & { container: string | null; hold_s: number | null })[];   // samples with a pH result; null where the record stores none
  decisions: {
    decision_id: string;                                   // "<unit_id>@<t>"
    unit_id: string; t: number;                            // the readjustment tick
    action: "readjust" | "skip" | "none";                  // none: no new available pH row at the tick
    read: { filed_under: string; measured_at: number; value: number; container: string | null; hold_s: number | null; state: string | null } | null;
    onto: number | null;                                   // readjust: the value the probe is set to read
    reason: "known_bias" | null;                           // skip
  }[];
  findings: RecordView["findings"];
}
```

**How a guess is scored.** One guess, a sample id, then the reveal; "give up" reveals with no score. The affected set is the planted sample, plus the sample whose id the results were recorded under for a label error (the mixed-up pair, as `mixedUp` in the test support). `hit`: the guess is in the affected set. `background`: not planted, but the shown record carries a structural error on that sample (the injector's plain list names the type), and the reveal says so and names it. `miss`: otherwise. There is no running score, no ranking and no store of guesses (YAGNI).

**What the reveal shows.** The planted error (type, affected samples, detail: the id the label read, or the unit it was re-keyed to). For each of A, B and C, the same planted error on the same run, recorded by that architecture: `prevented`, `detected` with the rule ids or evidence names that show it in the record, or `invisible`, with the reading of ADR-0005's flag table for the flag that decides it (`reading` is a dictionary key, so the sentence is translated). The three-column lineage of the planted sample, with truth and verdicts. These are the forced-error cells of S2 on a full run; the expected outcomes of the hand-typed cell tables are the oracle (section 12).

**The reveal never reaches the page before the guess.** The Worker keeps the plant under the challenge id; `challenge_ready` is built from the recorded dataset and the announced type only; the `locked` rule of section 4 keeps the lineage screen out; the end-to-end test records every Worker message before the guess and fails on the sample id of the plant, on the id of an affected decision, on a `reveal` or `planted` key, or on any message type outside the allow-list. The page states plainly that this is a game on the honour system, not a security boundary: the engine runs in the reader's browser and the seed is in the link.

### The decision variant

The author's answer of 2026-10-30 ("결정까지 포함", Open, item 5) puts an error whose effect is a decision into version one. The engine has two decision makers. The table says which can be the target, with its spec section and code.

| Decision | Spec and code | Target in version one |
|---|---|---|
| Readjustment of the online pH probe onto the newest offline pH value (experiment 2, SC8) | `simulation_spec.md` section 6.2; `data_model.md` section 7, "Experiment 2"; `decideReadjust` in `engine/src/experiments/arms/closed_loop.ts`, called by `runArm` (`engine/src/experiments/assembly/closed_loop_arm.ts`) at every readjustment tick of every reactor (A051, A108) | **Yes**, for the label error, once the closed-loop batch of section 14 (Open, item 8) has landed. The spec makes this decision per tick and reactor, not per sample; but each decision reads exactly one recorded row (the newest available pH row not used before; a value is used once) and names its sample, so a recorded row reaches at most one decision and the sample-level plant has a place to land. |
| Routine feed decision of the day (10:00) | `simulation_spec.md` section 2.1; the `decision` moment in `engine/src/process.ts`; A050, A194 | **No.** The engine takes it on the true glucose in the truth world, so no recorded row reaches it, and no `feed_decision` event is emitted although the layer table of spec section 2 names one. A target would need a rule that decides on recorded results, which is a new L5 mechanism. Left out; Open, item 9. |

The other catalogue types are not planted in this variant, each for a reason in the code. `unit_rekey`: the assembly gives each reactor's loop the samples drawn on it (the unit of the draw), so a re-keyed sample moves no decision unless a loop read its rows by the recorded unit, which no code does. `duplicate_replay`: the copy repeats the value and `measured_at` of the row, so no decision changes. `clock_offset`: the injector realises it on every result of the analyzer a scenario names (`engine/src/inject/inject.ts`; A049 is an example offset and no frequency, SC6 sets one analyzer), so the spec gives it no sample-level target, and SC8 sets no offset. The structural types stay what they are in the sample variant: present by construction, never the planted one.

**Which record the reader sees.** SC8, one seed (a neutral integer of the `experiment2.json` list, or typed under the experiment-config rules, A103), one architecture. Only A and C with `system_issued_id` off do not prevent a label error (`prevented` in `catalogue.ts`); B, C and the other ablations are listed as disabled with the reason "`system_issued_id` is on". The type is announced ("a label error was planted") and needs no type draw; the sample and the decision are not announced.

**How the planted error reaches a decision (invariant 2).** One keyed draw per eligible sample, key `(run_seed, <sample_id>, "-", 0, "challenge:pick_decision")`; the eligible sample with the smallest `u` is planted, so an added sample never moves another's draw. A sample is eligible when a decision of the shown architecture reads its pH row (action `readjust` or `skip`) in the unplanted loop of the same seed (the same function without `forced`), and it has a neighbouring draw whose id the label takes, as in the sample variant. The plant enters through the `forced` input of the closed-loop assembly, `{ type: "label_error", sample_id, detail: { as_id } }`, a type of the catalogue and no new one. It does what it does in any record: the analyzer-side events of the sample carry the neighbour's id, so its pH rows are filed under that id. The decision code is not changed and reads the container and the hold time by the id a row is filed under (`recordedContext`), so a decision can read the value of one sample together with the container and hold of another. The technique draw (A064) and the hold effects (A041 to A043, A046) are truth-side effects of SC8: they stay in the planted run as in every SC8 run, are never the planted error, and count as background below. The row-to-value mapping that makes this possible, and the decision log, are the engine additions of section 5.

**What the reader sees and opens.** `DecisionRecordView`: the decisions of the shown architecture in time order, filtered by reactor, each with the row it read as the record holds it (the id it is filed under, `measured_at`, value, container, hold time and review state, each null where the record holds none) and what it did (`readjust` onto a value, `skip` with the reason "known bias", or `none`); the samples with a pH result and what the record stores of them; the findings the record's own rules raised. `challenge_open` returns the sample drill-down of section 8 without truth and verdicts and without the `value` of pH results, because the recorded structure carries placeholder pH values (`data_model.md` section 7, "Experiment 2"); the values the decisions used are in the decision list only. The reader never receives the true pH, the probe offset, the oracle's decisions, another architecture's decisions, the unplanted loop or the planted samples. The inputs of the loop are printed with `<Ref>` (section 6).

**How a guess is scored.** One guess, a decision id, then the reveal; "give up" reveals with no score. The affected decisions are those of the planted loop of the shown architecture that read a row of the planted sample or of the neighbour whose id it took, or whose action or row differs from the same tick of the unplanted loop. Action and row are compared, not values: after the first changed decision the loop itself moves later values, and nothing is marked for that. `hit`: the guess is an affected decision, the decision made on the wrong input. `background`: not affected, but the decision rests on a sample that carries a structural error of the injector's plain list, or on a value that SC8 biases by construction (an open container, A064; a hold above A046); the reveal names which. `miss`: otherwise. No running score, no ranking, no store of guesses.

**What the reveal shows.** The planted error (type, the two samples, the id the label read). For each affected decision: the row it read, the id it was filed under and the sample it came from, the value used, the container and hold time the record gave it and the container and hold time the sample really had (truth, after the guess only). For A, B and C and the shown ablation: the outcome of the same forced label error in that record (`prevented`, `invisible` or `detected`, from `outcomeOf`, with `LABEL_CELLS` of `engine/tests/support/cell_tables.ts` as the oracle), the flag that decides it, and whether the decision at the affected tick is the same as in the unplanted loop of that architecture (`decision_same`). Read together, they say which flag would have kept the wrong input out (`system_issued_id`, which prevents the error) and which flag would have exposed it, if any (the cell tables name the rule or evidence, or none). The three-column lineage of the planted sample. No effect size and no metric: the reveal shows decisions, not a distribution.

**What the Worker adds.** `challenge_start` with `variant: "decision"`, `challenge_guess` with a `decision_id`, `DecisionRecordView` and the `decisions` part of `Reveal` (section 4); `sc08_ph_restandardisation` and the `experiment2.json` seed list in `src/worker/data.ts`; the lab function `challenge_decision.ts` and the closed-loop additions (section 5). Step 4 builds the Worker function and the screen; the closed-loop batch builds the engine part before it (section 14). The Setup picker and Results do not gain SC8: version one shows no experiment 2 report and no distribution of it.

Not in the first version: the routine feed decision as a target (Open, item 9), a planted `clock_offset`, `unit_rekey` or `duplicate_replay` as the error behind a decision, SC8 in the Setup picker, a hint, a leaderboard.

## 10. Texts

- English first, Korean on a toggle (ADR-0006). `src/i18n/en.ts` is the source (a flat object, keys by screen, `{name}` placeholders); `src/i18n/ko.ts` is typed `Record<keyof typeof en, string>`, so a missing Korean key is a type error. A unit test checks, per key, the same placeholders, the same set of `A###`/`S###` ids, and no digit sequence in Korean that English lacks (ADR-0006: the Korean text introduces no number, claim or source); the end-to-end check `ko` limits unchanged strings as `qa_checks.KO_LIMIT` does for the infographic. Korean terms follow `infographic/src/i18n.js` where a term exists there. The choice is kept in `localStorage` inside `try/catch` (it can be blocked) and the default is always English.
- Strings from the engine (reasons, notes, error messages) are data: shown verbatim in a `lang="en"` element under a translated label. Lists of flags, error types and metric names are dictionary keys (`flag.<name>.label|on|off|effect`, `error.<type>`, `metric.<name>`), never engine strings.
- The label-error sentence (spec section 5, "Notes from S2g"), shown next to the detection metric of every architecture in Results whose flags have `system_issued_id` off and `ingest_idempotency` on (today the ablation `c_context_minus_system_issued_id`; the condition reads the flags, not the id), with its numbers unchanged:

  > Without `system_issued_id`, a label error is not detected here. A conflict of the duplicate-file check (VR-008b) cannot tell a replayed file from two analyses that a label error gave the same label, and the double-label check (VR-009) looks for two different ids, so the error appears as false alarms of the type `duplicate_replay`. The numbers are shown as they are.

- The dialect sentence of ADR-0014 rule R3, verbatim, on every screen that describes a dialect or the capture path (Setup, Notes): "synthetic formats modeled on public documentation". The English dictionary contains none of the words "supports", "compatible" or "certified" (a test), so nothing refers to a real instrument that way.
- Themes: tokens on `:root`; light and dark follow `prefers-color-scheme`, a manual toggle sets `data-theme`; no neon (ADR-0011 applies it to the infographic; the lab adds no extra theme, YAGNI). Status shapes and text as in section 8. No motion, so `prefers-reduced-motion` needs no branch. Focus is visible and every control is reachable by keyboard; each SVG has a `<title>` and a text alternative.

## 11. The flags in every place that lists them

The list comes from one place: `ready.flags`, which is the engine's `FLAG_NAMES`. The page never types the number of flags. Until Step 5 it lists eight; from Step 5 `material_lot_links` is the ninth (presets A off, B off, C on; ADR-0017) and appears everywhere without a page change except its dictionary entries (`flag.material_lot_links.*`, including the sentence of its ablation row).

| Place | What it lists |
|---|---|
| Setup, flag matrix | Every flag against A, B, C; each cell on or off from `PresetInfo.flags`. |
| Setup, "C with one flag off" picker | One option per flag, `c_context_minus_<flag>`. |
| Results, architecture legend and each result footer | The flags on for each architecture shown. |
| Lineage, head of each column | The flags on. |
| Challenge, record picker and reveal | The ablation options; the flag that decides each outcome. |
| Break-out (Step 6) | The flags on per architecture, and which flag direction 3 needs. |
| Notes | The flag table of ADR-0005 as dictionary text. |

The end-to-end check `flags` marks each of these with `data-flag-list` and fails when one lacks a flag of `ready.flags` or names one that is not in it. Outputs that list flags in the engine (the report, the key, the trace fixture) gain their entry under ADR-0017 in Step 5; the lab compares only what it needs from the read-only trace fixture (the three answers), so the fixture's eight-flag line does not conflict.

## 12. Budgets, the spike and the tests

**Budgets** (00 section 4; a breach is a major finding). First load of the lab at most 300 KB gzip, measured with `gzip -c <file> | wc -c` over the files the browser fetches on a cold first load of `dist/lab/index.html`; the engine run of the default scenario, one seed, at most 1 s in a Web Worker in headless Chromium. The infographic budget (150 KB) is unchanged and not touched.

**Spike, 2026-10-30** (scratch project outside the repository, deleted after measuring; macOS arm64, Node v25.6.1, Vite 8.3.5, Preact 11.0.1, pure-rand 8.4.2, headless Chromium 156.0.8078.4; the engine files were copies of the repository's `engine/src`, the repository's `package.json`, lockfile and `node_modules` untouched). A minimal page ran the default scenario in a module Worker and showed one number; a second build gave the Worker the realistic lab surface (scenario run, injector, recorders, review, evaluator, `runOpenLoop`, `buildReport`, the raw layer and the experiment report).

| Measure | Minimal page | Lab surface |
|---|---|---|
| Files, `gzip -c` bytes | page chunk 6,087 (Preact 11.0.1 and hooks, about 14 KB raw); Worker 15,154; html 230 | page chunk 6,087; Worker 41,015 (129,943 raw); html 227 |
| First load, sum | 21,471 B (21.0 KB) | **47,329 B (46.2 KB), 15.4 percent of 300 KB (307,200 B)** |
| Engine run, median of 5 in the Worker (I12 marks of `engine/tests/perf_i12.test.ts`), per page load | 70.7 to 72.5 ms (5 loads) | 68.2 to 72.6 ms (3 loads) |
| First of the 5 runs in a load | 82.6 to 95.5 ms | 83.5 to 85.1 ms |

The engine is 41,015 B of the 47,329 B and the budget is not near, so no further breakdown was made: the headroom for UI code, styles and the two dictionaries is about 253 KB. The same Worker through `runOpenLoop`, single timings of one page load in Chromium (Firefox 157.0 and WebKit 27.2 in brackets), for one seed: three architectures 217 ms (315; 164), the three plus the eight ablations of C that existed then 406 ms (595; 356); for the 20 seeds of A103, three architectures 3.5 s (6.3 s; 3.4 s) and all eleven 7.0 s (13.9 s; 8.3 s). A twenty-seed run is therefore several seconds, which is why section 4 runs seed by seed with `progress` and a between-seeds `cancel`; the gate does not time it. All these timings were taken with the native maths functions: ADR-0019 makes the draws slower, batch S3m measures that against the I12 budget, and the `time` check below applies to the engine as it is after S3m. The size of the engine bundle gains the maths module and is re-measured by the `size` test. The closed loop of one SC8 seed (decision variant) has no measured time yet; the batch that builds it reports it (Open, item 8).

**Cross-engine findings of the spike** (kept as history: they are why ADR-0019 exists, and ADR-0019 removes the cause, so section 7 no longer relies on any tolerance). Same engine code, same machine, before ADR-0019, with the native maths functions:
- Strict `logHash` of the default scenario, seeds 1 to 5: equal to the golden in Node, different in Chromium, Firefox and WebKit on 5 of 5 seeds, and different between those three too. For seed 1 in Chromium, 248 of the 7,211 log lines differ from the golden, in 253 fields, all of them floats (`drift_before_pct` 159, `noise` 89, `value` 5); the largest relative difference is 9.3e-15; no id, count, integer time or event order differs.
- A probe of eight `Math` functions on 20,000 inputs, bit patterns: `sqrt` and `pow` identical in the four engines; `log`, `cos`, `sin`, `exp` and `atan` different in all four; `tanh` different in Node and Firefox, equal in Chromium and WebKit.
- History of a dropped tier: a hash of the log rounded to 6 significant digits was the second tier of the first design of the check and is not built, so `roundedLogHash` is not an engine addition. Rounded hash, seeds 1 to 5, equal in the four engines on 5 of 5 seeds at 6 and at 9 significant digits, and on 4 of 5 at 12 (one value straddled a rounding boundary). Six digits is the choice: a boundary straddle needs a noisy value near a rounding edge, which is rarer the coarser the rounding, and 6 digits still separates any value that is wrong in its fifth digit or earlier. The rounded digest of the metric cells of seed 1 for three and for eleven architectures was equal in Node and the three browsers.
- Five page loads in Chromium gave the same strict hashes for seeds 1 to 3 each time, so no run-to-run change showed in the truth path (the ADR notes that this proves nothing about other runs). The five repeats inside one Worker that section 7 asks for were not part of the spike; they are part of the designed check.
- The findings are one operating system, one processor family and one version of each browser; another platform could have differed in other last digits, which a build-time reference cannot predict.
- ADR-0019 removes the cause: the engine's own `log`, `exp` and `cos` replace the native ones (batch S3m), so the strict hash is expected to agree in every engine. The lab's `engines` check (Firefox and WebKit, headless, below) is now expected to read `identical` in both, and a difference there is a new finding about the engine.

**How each budget is measured in the gate.**
1. Size. A Vitest test builds the lab into a temporary directory with Vite's JS API and sums `gzip -c <file> | wc -c` (run through `child_process`) over every built file; it fails above the budget. It sits in `npm run check`, so the Stop hook catches a regression early. The end-to-end script repeats the sum over exactly the files in the page's request log of a cold load and fails on any request to another origin.
2. Time. The end-to-end script reads `detail.runs_ms` (the five timed runs of seed 1) from the `check` message of the built page in headless Chromium and takes the median; it fails above 1 s. This is the I12 marks: START the line before `runScenario(cfg)` with the scenario loaded, STOP the line after it returns the complete truth log and observable events; not measured: sensor-tick serialisation, canonical JSONL, hashing.

**End-to-end tests** are headless only, in Python Playwright through `uv` as `scripts/qa_infographic.py` does (no new Node dependency, the Chromium build already installed, the same pure helpers): `scripts/qa_lab.py` (CLI, server, report to `qa_out/`) and `scripts/qa_lab_checks.py` (checks and pure helpers), with pytest unit tests of the helpers in `tests/test_qa_lab.py`. Command: `uv run python scripts/qa_lab.py` (it runs `npm run build:lab` first unless `--no-build`). AHA: the contrast, viewport and gzip helpers are imported from `qa_checks.py`; the second copy of a sweep is allowed, a third is extracted. Checks:

| Check | Given-When-Then in one line |
|---|---|
| `load` | Given the built page in Chromium, then no console error, no request to another origin, the Worker answers `ready`. |
| `size`, `time` | The two budgets above. |
| `check` | Given the real `reference.json`, the state is `identical` and the banner reads "byte for byte". Given a copy with one hash digit changed (swapped by `page.route`), the state is `failed`, the banner reads as in section 7, and the texts "reproducible" and "byte for byte" are absent. |
| `lineage_sc3` | Given SC3 seed 1 and the rule pick, the three answers and verdicts of A, B and C equal the fixture `tests/fixtures/trace/single_sample_trace.json`. |
| `challenge` | Given a started challenge, no Worker message before the guess carries the plant (nor, in the decision variant, an affected decision); after a guess the reveal holds `prevented`, `invisible` or `detected` for A, B and C equal to the hand-typed expected cell of the planted type. In the decision variant (when `ready.challenge_variants` lists it) a guess on a decision of the affected set reads `hit`. |
| `numbers`, `flags` | Sections 6 and 11. |
| `ko` | Section 10; no horizontal scroll at the narrow viewport. |
| `matrix`, `contrast` | The two viewports of `qa_checks.VIEWPORTS` by light and dark by English and Korean; contrast per theme. |
| `engines` (optional, `--engines all`) | Given Firefox and WebKit headless, the page loads and the check state is `identical` (expected under ADR-0019; a `failed` is reported as a finding about the engine, never tolerated). |
| `sc12` (Step 6) | The walk-back and the retro-flag per architecture; direction 3 unreachable without `material_lot_links`. |

Unit tests (Vitest, `src/**/*.test.ts` and `engine/tests/lab/*.test.ts`; pytest for the two scripts) written red first: protocol type switch, `invalid_spec` and the `locked` rule; the plant is a function of the seed alone, an added sample moves no other draw, and its keys are listed and collide with none (as `rng_collision.test.ts` does for a run); the reveal object does not exist before the guess; the decision plant is a function of the seed alone, its eligible samples are those that a decision of the unplanted loop reads, the affected set of a hand-built pair of loops is the one typed by hand, the decision list holds no truth field and the drill-down no pH value (Step 4, after the closed-loop batch); the reference equals the goldens; the import zones; the dictionary parity; ledger ids; the size budget.

**Does `check_all.sh` run them?** The fast tests do, through `npm run check` (they add little: no browser). The browser run does not belong in the Stop hook, which runs in every turn that changes the working tree. `check_all.sh` gains a flag `--lab` that appends `uv run --frozen python scripts/qa_lab.py`; the S3 batches from Step 2 on use `bash scripts/check_all.sh --manual --lab` in their Done line, and the default and `--manual` runs stay as they are.

## 13. The Pages workflow (Step 6)

`.github/workflows/pages.yml`, triggered only by `workflow_dispatch` with a boolean input `deploy` (default false). Nothing is published by an executor: the file is written and never run by one; running it is the author's act, and the repository's Pages setting is the author's too.

| Job | Does |
|---|---|
| `build` | Checks out, installs Node from `.nvmrc` and `uv`, `npm ci`, `uv sync --frozen`; runs `check_docs.py --all --ci` with the banned-token list from the secret `GUARDRAIL_TERMS` (the CI reader of `scripts/docs_rules.py`), `uv run pytest -q` and `npm run check`; builds the lab with `npm run build:lab`; assembles `site/` as the committed `infographic/index.html` at `site/index.html`, the lab at `site/lab/` and an empty `.nojekyll`; uploads `site/` as the Pages artifact. |
| `deploy` | Only when `inputs.deploy` is true: deploys the artifact to the `github-pages` environment. |

Actions are pinned by full commit SHA with the release in a comment, each release at least two weeks old (the Preact rule). The end-to-end browser run stays a local gate (it is the AI path's Playwright gate) and is not in the workflow. The full-history banned-token scan is `scripts/check_docs.py --history`, which the `pre-push` hook runs; Step 6 runs it without pushing.

## 14. Build plan against `prompts/30`

| Step | Builds | Red tests first | Gate added |
|---|---|---|---|
| S3m (engine, before Step 2) | The engine's own deterministic `log`, `exp` and `cos` (ADR-0019, Proposed): the five call sites, the exponent operator in `engine/src/evaluate/stats.ts`, and the lint rule that refuses the native transcendental functions in `engine/src`. The goldens are regenerated once, only if the logs differ in float fields alone (the largest relative difference stated) and with the author's approval; the cost against the I12 budget is measured. | known values, and a comparison with the native function to the accuracy the draws need; the regenerated logs differ from the old ones in float fields only | the lint rule |
| 2 shell | Vite and Preact setup, the Worker with the strict check (section 7), Home, the import zones, `engine/tests/support/lab_reference_cli.ts`, `scripts/lab_ledger.py`, `qa_lab.py` with `load`, `size`, `time`, `check` | zones, reference equals goldens, size test | `--lab` flag of `check_all.sh` |
| 3 | Mixed-fleet engine part of ADR-0015 as its own batch before the UI (field names, load-time validation and the routing of a request two analyzer profiles can both measure are Open item 4), then Setup, Results, Notes, the dictionaries, the label-error sentence | settings override, per-seed run and cancel, report passthrough, dictionary parity, `numbers`, `flags` | `numbers`, `flags`, `ko`, `matrix`, `contrast` |
| S3d (engine, proposed name, before the decision part of Step 4) | Forced errors in the closed loop (section 5): a clarification of `data_model.md` section 7, "Experiment 2", first; then the `forced` input through `buildShared`, the map from a recorded pH row to the result it stands for, and the decision log of `runArm`. The time of one SC8 seed is reported. Needs the orchestrator's go (Open, item 8). | with no `forced` the closed-loop report and the SC8 tests are byte-identical to today; a hand-built forced label error makes the arm read the value of the planted sample with the container and hold of the neighbour whose id it took (typed by hand); the zero-bias identity still holds | none of its own |
| 4 | Lineage and Challenge; the structure-only moves of section 5 first. The decision variant (section 9) when S3d has landed, otherwise the sample variant alone and `ready.challenge_variants` says so. What the decision variant needs from the engine: the `forced` input of the closed loop, the decision log (tick, action, the row read), and nothing else. The Worker side is `challenge_decision.ts`, the SC8 bundle in `src/worker/data.ts` and the protocol additions of section 4. | pick rule and three questions against the S2d fixture, plant is a function of the seed, reveal absent before the guess, outcomes equal the hand-typed cells; for the decision variant the unit tests of section 12 | `lineage_sc3`, `challenge` |
| 5 | Engine only (spec section 11.4, data_model section 15, ADR-0017); the page gets the ninth flag from `ready.flags` and its dictionary entries | as `prompts/30` Step 5 | `flags` now sees nine |
| 6 | Break-out screen, Pages workflow, release checks; a link-only change under `infographic/` with `scripts/qa_infographic.py` rerun (Open, item 6) | `sc12` | the full-history scan; the public-build refusal of extension figures |

The mutation spot checks of `prompts/30` map to tests of this note: a page file importing a truth module (the zone test); the browser check against a wrong hash (the `check` test with the altered `reference.json`); the reveal before the guess (the `challenge` test and the unit test of the Worker state); the lot edge dropped when `material_lot_links` is on, direction 3 two steps back, a break-out draw keyed by the label (Step 5 tests). Each runs in a scratch copy and is reverted.

## 15. Open

The seven questions of the first version of this note were answered or ruled on 2026-10-30: the author answered items 1, 3 and 5 in chat; the orchestrator ruled on items 2, 4, 6 and 7 in the S3a review. Items 8 and 9 are new from S3a2.

1. **Determinism across engines. Resolved (author, 2026-10-30):** "결정적 수학 함수로 교체". ADR-0019 (Proposed) replaces the engine's native `log`, `exp` and `cos` by its own deterministic ones (batch S3m), so a seed gives the same bytes in every JavaScript engine. Section 7 is one strict comparison with no rounded tier; the goldens are regenerated once, with the author's approval recorded in `docs/progress.md`, only if the logs differ in float fields alone.
2. **Extension figures on the public page. Ruled (orchestrator, S3a review): accepted.** The SC12 inputs (A135 to A158 and the tests A142 to A147) rest on S057 to S083, none of them `main-reread`; ADR-0013 keeps them off a public page until the research role has re-read the sources. The Break-out screen is built in Step 6 and the public build refuses it until that re-read, which joins the research list.
3. **Reading of invariant 3 for provisional figures. Resolved (author, 2026-10-30):** "점선 '잠정' 칩과 함께 표시 (Recommended)". A figure on a source below `main-reread` is shown with a dashed provisional chip, as in the infographic (section 6).
4. **ADR-0015 before the N by M controls. Ruled (orchestrator, S3a review): accepted.** The mixed-fleet engine part of ADR-0015 (a per-bay and a per-analyzer profile list, their load-time validation and the routing rule for a request two analyzer profiles can both measure) is its own batch, with a clarification in spec section 4, before the Step 3 UI. It leaves the goldens as they are.
5. **Scope of the first challenge. Resolved (author, 2026-10-30):** "결정까지 포함". The first version also plants errors whose effect is a decision, not only the sample-level types. Section 9 designs it for the closed-loop readjustment decision of experiment 2 and the label error (item 8 is its engine prerequisite); the routine feed decision is left out (item 9); a planted `clock_offset` stays out because the spec gives it no sample-level target (an analyzer-level setting, SC6, A049); SC8 stays out of the Setup picker and of Results, which show experiment 1 only.
6. **One Pages site. Ruled (orchestrator, S3a review):** the Step 6 batch may make a link-only change under `infographic/`, with `scripts/qa_infographic.py` rerun.
7. **Paths for the build scripts. Ruled (orchestrator, S3a review):** `scripts/lab_ledger.py` and `engine/tests/support/lab_reference_cli.ts`.
8. **Forced errors in the closed loop (new engine mechanism; the orchestrator decides).** The decision variant needs experiment 2 to run the injector with a forced label error and to read each recorded pH row's value through the physical-id map. Neither exists: `buildShared` records the lab run once with no injector, `runArm` looks rows up by the physical sample id, and the spec does not say how a mislabelled pH row reaches an arm (S2c3 fixed the structure the other way, `data_model.md` section 7, "Experiment 2"). So this is a mechanism and not plumbing: a spec clarification first, red tests, and the orchestrator's go for the proposed batch S3d (section 14). If it is not approved, Step 4 builds the sample variant alone, nothing of the decision part of section 9 is built, and the page work does not change because `ready.challenge_variants` lists what exists. Also open there: the time of one SC8 seed through two loops (no budget exists for it; S3d reports it, and the screen shows `progress` between the loops), and whether the by-construction effects of SC8 (technique error A064, hold above A046) stay on in the planted run (this note keeps them, as background).
9. **The routine feed decision as a challenge target (left out).** The engine takes the feed decision of the day (A050, A194) in the truth world on the true glucose (`engine/src/process.ts`; spec section 2.1), so no recorded row reaches it, and no `feed_decision` event is emitted although the layer table of spec section 2 names one. The note of A194 says experiment 2 decides it on the most recent recorded result, but spec section 6.2 and the engine build only the pH loop: the ledger text describes a mechanism that does not exist, for the research role and the orchestrator to reconcile. A recorded-data feed rule (which glucose result it reads, how old it may be, which viable cell density the prediction uses) is a new L5 mechanism and needs the author's decision on its meaning before any challenge can plant an error into it. The availability metric (does the record show the result at the decision time, A050) measures the input of that decision and is not a decision made on a wrong value, so it is not offered as a substitute.
