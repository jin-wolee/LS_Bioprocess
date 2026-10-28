# Simulation specification

Status: design draft, no simulation result exists yet. Synthetic scenario built from public sources and labelled assumptions (ADR-0001). Nothing here predicts a real laboratory.

How to read the numbers: every number carries a ledger id (`S###` source, `A###` assumption; grades S, P, D, A are explained in `docs/research/README.md`). A number marked with a dagger (†) is a design parameter that has no ledger id yet; section 11 lists them. Figures that rest on a source below `main-reread` are provisional and may not appear on the public README or infographic.

## 1. Purpose

N bench-scale bioreactors in a process-development (PD) laboratory send in-process samples to M shared at-line analyzers. One synthetic "truth" run is recorded under several data architectures, so the only thing that changes is how data is captured and stored. The simulator shows how an analysis result loses its process context (which reactor, which moment, which instrument state) and what each architecture preserves.

Default: 24 reactors in two bays of 12, 2 analyzers; N from 5 to 100 and M from 1 to 6 (A001, A022; ADR-0009). Average load is low, so waiting comes from bursts, not capacity: 12.6 to 16 percent of two analyzers over a 9 to 10 h staffed window, 5 to 6 percent over a 24 h clock (A074, grade A).

## 2. Five layers

| Layer | Contents | Events emitted | Entities |
|---|---|---|---|
| L1 process (truth) | staggered inoculation, simple kinetics for cells, metabolites and titer (A011), online sensor series at a one-minute cadence†, scheduled events | `inoculation`, `process_event` (feed, temperature shift, alarm, harvest), `sensor_tick` | Site/Area/Unit, Batch, ProcessEvent, historian tag |
| L2 sampling and logistics | planned window, actual draw, label, transport, aliquot by storage condition, stability effects while waiting | `sample_planned`, `sample_drawn`, `label_bound`, `sample_received`, `aliquot_created`, `draw_skipped_volume_budget` | Operator, Sample, Aliquot, label method |
| L3 analysis (discrete-event) | queue policy, QC and maintenance windows, reruns, dilution, instrument state, multi-visit routing, setup time | `request_queued`, `visit_started`, `visit_finished`, `run_started`, `qc_result`, `calibration_recorded`, `maintenance_started`, `maintenance_ended`, `result_measured`, `rerun_requested`, `dilution_applied` | Analyzer, InstrumentState, Run, Method |
| L4 recording (the comparison axis) | one recorder per architecture, error injector, event log | `record_written`, `record_corrected`, `flag_raised`, `ingest_received` | Recorder, ErrorInjector |
| L5 use | feed decision, batch comparison, analyst queries, optional model; truth-oracle arm | `query_answered`, `feed_decision`, `probe_restandardised` (experiment 2) | DecisionRule, AnalystQuery |

```mermaid
flowchart LR
  L1["L1 process (truth)"] -->|draw| L2["L2 sampling and logistics"]
  L2 -->|arrival at queue| L3["L3 analysis (DES)"]
  L1 --> TL[("truth_log: everything")]
  L2 --> TL
  L3 --> TL
  L1 -->|recorded historian values| OE[("observable_events")]
  L2 -->|planned label, received| OE
  L3 -->|run, QC, calibration, maintenance| OE
  OE --> L4["L4 recorders: A, B, C"]
  L4 --> L5["L5 use: queries, decisions"]
  L5 -. "experiment 2 only" .-> L1
  TL --> EV["metrics evaluator + error answer key"]
  L4 --> EV
  L5 --> EV
```

Time is an integer number of seconds everywhere in the engine. ISA-88 vocabulary is used for the physical model (Site, Area, Unit, Batch).

### 2.1 L1 process

Fed-batch is the default mode (A003): production culture 13 to 17 d (A004, S017; default 14, and the ledger range's 12 d low end comes from a different study, S019), preceded by an N-1 seed of 2 to 5 d (A005), inoculated at 0.5 to 1.5 million cells/mL (A007). Glucose is kept above 1.0 g/L by discrete feeds (A010, S017), so a feed can fall between a draw and its measurement. Peak viable cell density has no source and is an assumption (A008 for fed-batch, A009 for perfusion, both grade A). Harvest follows a simulator rule (A013). Perfusion (A006, only one duration sourced) is deferred to session S4.

### 2.2 L2 sampling and logistics

- Sampling pattern: one sample per reactor per day, a second in the feed window on a share of reactor-days (A014, A015); shift-start burst (A016) and shift pattern (A017) are assumptions; transport and preparation time (A018) and draw delay spread (A063) are assumptions.
- Labelling method (handwritten, pre-printed barcode, issued at draw) is an L2 setting, independent of the L4 flags.
- Container model: closed syringe for pH and gases, open cup for cell count and metabolites (A037, proxy). A held-sample effect is applied only as a scenario knob: viability slope default 0 for neat samples (A040), with the observed value kept separately and valid only to 55 min (A038, A039, S012); open-sample pH offset (A041) and relaxation (A042) and closed-sample drift (A043) follow their ledger grades; settling bias and in-tube glucose and lactate change are assumptions (A044, A045); the 30 min maximum hold is a blood-gas proxy (A046).
- Volume budget: each draw consumes a share of the culture (A057, derived). An over-budget draw is skipped and logged, and still counts in every metric denominator.
- Aliquot storage policy by analyte class (A021, assumption).

### 2.3 L3 analysis

Queue policy defaults to first-in-first-out, with priority, earliest-deadline-first and SLA variants (A035). QC time per analyzer per day and maintenance windows are scenario settings (A031). Instrument behaviour (drift, resets, lot change, inter-instrument bias, habitual assignment) is assumed and switched on per scenario (A033, A032, A034). Service times come from the analyzer profile (section 4). A run may not overlap a QC or maintenance window, and a window is checked over the whole run, not only at its start.

## 3. Truth, recorded world and the observation contract

The engine emits two streams.

- `truth_log`: everything, including hidden quantities (true analyte values at draw, true pH, true instrument bias).
- `observable_events`: what a person or an instrument could see: sample drawn with its planned label, received, run started with instrument and QC lot, QC result, calibration record, maintenance log, recorded historian values.

Rules (invariants, tested):

1. Recorders (L4) consume `observable_events` only. Hidden fields are annotated `"x-visibility": "hidden"` in the schemas. Test: change hidden-only fields and the recorder output must be byte-identical.
2. Only the metrics evaluator reads the error answer key. L5 never reads truth, except the oracle arm of experiment 2.
3. Same `(scenario, seed, engine_version)` gives a byte-identical event log. Randomness comes from a keyed integer generator with key (physical sample, analyte, attempt, purpose); experiment 2 adds `seed` and `reactor`. A rerun or an added sample never changes another sample's draws.
4. Every export and shareable URL carries `schema_version`, `engine_version` and `seed`.

## 4. Profiles

Scenarios pick profiles. Profiles are data under `scenarios/profiles/{bioreactor,analyzer,staff}/`; each numeric parameter is `{value, unit, ref}` with `ref` resolving to a ledger id (ADR-0012). A bundle takes the grade of its weakest component.

### 4.1 Bioreactor

| Profile (default first) | How samples are taken | Sample as share of culture | Bundle grade | Ids |
|---|---|---|---|---|
| `bench_manual`: 2 to 5 L glass or single-use | operator draws into a closed container or syringe | 0.014 percent | S (with derived part) | A067, A002, A057 |
| `micro_mini_parallel`: micro-scale 10 to 15 mL, 24 or 48 vessels; mini-scale 100 to 250 mL, 12 or 24 vessels | automated liquid handler into a cup | micro 4.8 percent; mini 0.31 percent (0.16 to 0.7) | S (with derived part) | A065, A066, A057, S009, S011 |
| `pilot`: 50 to 250 L single-use (class boundary assumed) | sterile syringe from a sampling line | 0.00055 percent, analyzer volume only | A (boundary and purge volumes unsourced) | A068, A057, S036 |

On micro-scale systems the number of samples consumes the culture: 14 daily samples would draw 67 percent of the vessel (A057, derived), which is why the source calls sampling a burden there (S011). Pilot line purge and discard volumes are not sourced and are not modelled (A068). Automation also changes who creates the label, whether an operator is present, whether draws burst at shift start, and the delivery order (a vessel-order autosampler makes high-numbered vessels wait longest).

### 4.2 Analyzer

| Profile (default first) | Service and volume | Consequence | Bundle grade | Ids |
|---|---|---|---|---|
| `allinone_atline` (FLEX2 class) | 4.5 min stand-alone, 6 to 8 min coupled to a parallel system; 275 uL, or 400 to 700 uL coupled; about 13.3 samples/h | one queue, one file, one clock | S (with derived part) | A069, A019, A020, A023, A075, S001, S007 |
| `split_cellcounter_metabolite` | 130 s plus 120 s = 4.2 min of instrument time; 220 + 135 = 355 uL, 29 percent more | two queues; the two results can be measured at different times and carry different clocks | A (hand-off unsourced) | A070, A025, A026, S005, S006 |
| `hplc` (titer) | 1 min run, 5 to 50 uL injection; column changeover and system-suitability time is assumed | shared column is the contested resource | A | A071, A028, A029, A030, S026 |

The 355 uL and 4.2 min figures are sums of sourced numbers (derived); the metabolite side uses the FLEX2 chemistry module as a stand-in (A070). Interface: shared-folder CSV drop by default; a vendor OPC server is a separately licensed alternative (A036). Calibration behaviour (drift, resets, lot change) is assumed (A033).

### 4.3 Staff

| Profile | Count variability | Label errors | Delay and technique | Bundle grade | Ids |
|---|---|---|---|---|---|
| `experienced` | manual 2.81 percent CV between operators, automated 0.46 percent (bead study); counting-statistics floor 7.1 percent | 6.1 per 1000 (clinical proxy) | delay spread 5 min, technique error 0.02 (assumed) | A | A072, A058, A059, A060, A047, A063, A064 |
| `trainee` | manual CV times 2 (assumed), automated unchanged | 6.1 per 1000 times 2 (assumed) | delay spread 12 min, technique error 0.10 (assumed) | A | A073, A076, A062, A063, A064 |

What is sourced is narrow (A058, A059, A060, A047). The effect of training on label errors could not be established, and standardised labelling protocols are the lever with evidence (A061, S024, proxy). Shift and fatigue modifiers and the roster mix per shift have no ledger values yet (section 11). Operator id and qualification reference ride on the `audit_trail` flag.

### 4.4 Generic engine mechanisms

Multi-visit routing, sequence-dependent setup, volume budget, rate multipliers and delivery order. Nothing in the engine branches on a profile id, scenario id or architecture id.

## 5. Data architecture = feature flags

| Flag | On | Off | Error it targets |
|---|---|---|---|
| `system_issued_id` | key issued by the system at label creation | key typed or handwritten | label and transcription errors (A047, A061) |
| `two_clocks` | `sampled_at` and `measured_at` stored | one time stored: planned time if a sampling plan exists (needs `system_issued_id`), else analysis time | alignment error, feed-in-the-gap mis-join |
| `available_at` | each row carries when it became knowable | queries see rows as of now | time-travel leakage |
| `instrument_state_snapshot` | run links instrument, calibration, reagent lot | free-text analyzer name at most | instrument effect read as process effect (A032, A033) |
| `append_only_versions` | correction, rerun, reprocess create versions | overwrite in place | lost reruns, silent edits |
| `write_time_keys` | immutable `unit_id`, `batch_id`, `sampled_at` at write time | context joined later by measured time | misattribution, mis-joined context |
| `ingest_idempotency` | source event id and key; duplicates and replays are no-ops | duplicates double count | duplicate or replayed files |
| `audit_trail` | who, when, what changed; operator id and qualification | no history | unattributable records |

Dependency: with `two_clocks` off, the stored time is the planned sampling time only if a plan exists, which needs `system_issued_id`; otherwise it is the analysis time.

| Preset | Flags on | Labelling default | Realistic limits kept |
|---|---|---|---|
| A manual/Excel | none | handwritten | transcription, analysis-time clock, overwrite, no instrument id |
| B LIMS-lite | `system_issued_id`, `ingest_idempotency`, `audit_trail` | pre-printed barcode | records planned time not actual; reagent lot and calibration not linked; dilution factor typed by hand; joined to the historian by measured time. B is not a straw man: barcodes, automatic capture and an audit trail exist |
| C context-preserving | all eight | issued at draw | immutable keys at write time; process context as a versioned as-of projection joined with `AS OF`; residual error remains, such as a correct barcode stuck on the wrong tube |

- Labelling method is set independently of the flags; scenarios may cross them.
- Ablation: C with exactly one flag off, for each flag (eight runs).
- The system of record for routine in-process results (MES/EBR or LIMS) differs by site and is a setting (A056, SC11); only release-relevant tests get state-machine and Part 11-grade control.

Hypothesis matrix (a design hypothesis to be tested in session S2, not a result):

| Error type | Prevented by | Detected by | Invisible when |
|---|---|---|---|
| label or transcription error | `system_issued_id` | duplicate and plausibility rules | handwritten, no checks |
| feed in the gap (wrong clock for the join) | `two_clocks` with `write_time_keys` | a time-order rule on `sampled_at` and `measured_at` | one time stored, joined by measured time |
| clock or time-zone error (A049) | none | `two_clocks` plus clock rule (S029, S030) | one time stored |
| duplicate or replayed file | `ingest_idempotency` | idempotency log | no keys |
| lost rerun or silent overwrite | `append_only_versions` | `audit_trail` | overwrite in place |
| instrument or lot effect | none | `instrument_state_snapshot` with a bridging study | no instrument link |
| late correction leaking into an earlier decision | `available_at` | as-of query | queries see rows as of now |
| sampling technique error (A064) | none | recorded container and hold context | context not recorded |

## 6. Experiments

### 6.1 Experiment 1 (primary, open loop)

One truth run per `(scenario, seed)` is shared by every architecture. Step durations are identical across architectures. Error opportunities (label error, dilution transcription, clock misconfiguration, technique error and similar) are drawn once per sample, independent of architecture, then materialised per architecture. Detection only raises flags; it never triggers a re-draw or a re-measure. The truth-log hash is identical across architectures.

**Flagship 1: feed in the gap (SC3).** Illustrative times†: a sample is drawn at 08:40, a bolus feed happens at 09:00, the sample is measured at 09:25. The holding time is 45 min (arithmetic on the illustrative times; the 30 min blood-gas rule would already flag it, A046, proxy). Joining to the historian by `measured_at` pairs a pre-feed value with post-feed process state, which contaminates anything trained on it. Joining by `sampled_at` pairs it correctly.

```mermaid
sequenceDiagram
  participant R as Reactor (truth)
  participant Q as Analyzer queue
  participant H as Historian
  Note over R: 08:40 sample drawn (sampled_at)
  R->>Q: sample waits
  Note over R: 09:00 bolus feed (process_event)
  Q->>H: 09:25 measured (measured_at)
  Note over H: join on measured_at sees post-feed state<br/>join on sampled_at sees pre-feed state
```

Same family: an autosampler that loads in vessel order makes the high-numbered vessels wait longest.

### 6.2 Experiment 2 (closed loop, SC8)

**Flagship 2: offline pH used to re-standardise the online probe.** The practice exists (S013, A051): the offline value is treated as the source of truth, and sampling, hold time, temperature and CO2 degassing add offsets. Offsets depend on equipment and local procedure (S013). The ledger default (A041) is a cell-free, liquid-handler case, so scenarios sweep its range and report sensitivity; no single offset is presented as general.

```mermaid
flowchart LR
  P["Process pH (truth)"] --> S["Sample drawn: open or closed container"]
  S -->|"hold time, CO2 outgassing, container, technique"| O["Offline pH value"]
  O -->|"treated as truth: probe readjusted"| PR["Online probe offset"]
  PR --> C["pH controller acts on probe reading"]
  C --> P
  O -. "context kept: container, hold, who, when" .-> G["Delta-probe alarm or exclusion instead of readjusting"]
```

The context-preserving story follows the alternative described in the same source: avoid readjusting onto offline values, using a CO2-based reference and delta-probe alarms (S013; the exhaust-CO2 note S045 is snippet-level). A record that keeps how the sample was taken and held lets the offset be modelled or excluded.

Design: arms are an oracle that decides with truth, versus A, B and C. Common random numbers keyed by (seed, reactor, sample, purpose). Paired difference against the oracle over at least 20 seeds† with intervals. Outputs: probe offset, control excursion, paired difference. Wording is always "model-internal effect under assumptions A###, not a prediction". Feedback is off in every other scenario (default `feedback: false`, tested).

## 7. Scenario catalogue

Each scenario asks one question. Scenarios live in `scenarios/*.json`.

| ID | Question | Settings (ids) | Main metrics | Session |
|---|---|---|---|---|
| SC1 Ordinary Tuesday | What disappears on an ordinary day? | defaults (A001, A014, A015, A016), architecture toggle | exact reconstruction, misattribution, alignment error | S2 |
| SC2 Shift-start burst | Why wait when mean utilisation is low? | shift burst (A016) versus staggered sampling window | holding time median and p90, SLA exceedance, utilisation (window stated, A074) | S1 |
| SC3 Feed in the gap | Which timestamp should the join use? | a feed between draw and measurement (A010, A050) | alignment error with context mismatch, phantom effect size | S2 |
| SC4 New lot on AN-2 | When does an instrument effect look like a process effect? | inter-instrument bias on (A032), habitual assignment (A034), lot-change step (A033), bridging samples | phantom effect size, detection precision and recall | S2 |
| SC5 One analyzer down | Whom does the priority rule hand the cost? | maintenance window of 4 h† (A031), FIFO versus earliest-deadline-first (A035) | holding p90, SLA exceedance, availability before decision deadline (A050), delay by bay | S1 |
| SC6 Wrong clock | What if one clock is wrong? | one analyzer with a time-zone offset (A049; control need in S029, S030) | alignment error, detection recall, false-alarm rate | S2 |
| SC7 Re-run and dilution | How are reruns and dilutions recorded? | QC failure†, manual dilution factor (A048, A031) | rerun traceability, exact reconstruction | S2 |
| SC8 pH re-standardisation | How does a record error reach control? | experiment 2 (A051, A041, A042, A043, A064, A037) | probe offset, control excursion, paired difference | S2 |
| SC9 Perfusion campaign | What if the context unit is not the batch? | long perfusion with harvest intervals (A006, A003, A009) | exact reconstruction by harvest interval | S4 |
| SC10 Pool genealogy | What happens at merges across batch boundaries? | cross-batch pool (A052, A053, A054; turnaround unset, A055) | lineage-query exact reconstruction | S4 |
| SC11 GMP preset | Same model, different control strength? | source-of-record setting (A056); clock and audit expectations (S029, S030) | attributable rate, exact reconstruction, availability | S3 |

No numeric claim is made for any scenario until its session has produced results.

## 8. Metrics

No composite score. Every table reports the seed count and the spread across seeds. A metric without a stated denominator is a defect.

| Metric | Definition | Denominator |
|---|---|---|
| Holding time | `measured_at` minus true `sampled_at`; median, p90, SLA exceedance share | all analysis requests; requests never measured count as SLA exceedances; median and p90 are over completed requests with the completed share printed beside them |
| Utilisation | analyzer busy time over available time; state the window (staffed 9 to 10 h versus 24 h, A074) and whether setup counts | analyzer-time in the stated window |
| Availability before a decision deadline | share of requests whose result `available_at` is at or before the decision time (A050) | all analysis requests |
| Misattribution rate | recorded reactor or batch differs from truth; unattributed reported separately | all analysis requests |
| Detection precision and recall | per error type | realised error opportunities (recall); raised flags (precision) |
| False-alarm rate | flags on clean requests over clean requests | clean requests |
| Exact reconstruction rate | share of requests whose analyst-query answer equals truth on reactor, batch, `sampled_at`, process context as of, and instrument state; unanswerable counts as wrong | all analysis requests |
| Alignment error | seconds between the time the join used and true `sampled_at` (median, p90), plus the resulting context mismatch | all analysis requests |
| Phantom effect size | absolute difference between recorded and true group effect, over the pooled truth SD, for a group contrast whose true effect is zero | requests in the contrast |
| Rerun traceability rate | reruns whose original, reason and link are recoverable | all rerun requests |
| Attributable rate | operator and qualification present and correct | all analysis requests |
| Experiment 2 | probe offset, control excursion, paired difference versus oracle with intervals | reactors over the seeds |

Anti-gaming rules:

1. The denominator is fixed to all analysis requests, including missing, rejected, skipped (volume budget) and delayed ones; no metric may improve by dropping a hard request.
2. Only the evaluator reads the error answer key.
3. Detection metrics are always shown in pairs: recall with precision, detection with false-alarm rate.
4. Detection never causes a re-draw or re-measure, so it cannot improve operational metrics.
5. Golden files are never regenerated by a script or a test; a change needs the author's recorded approval.
6. Each metric is shown as a distribution over seeds, with sensitivity to grade-A inputs; residual failures of the best architecture are shown, not hidden.
7. No result is stated for a stage that has not run, and extrapolation beyond a source's range (for example holds beyond 55 min, A039) carries a warning.

## 9. Verification ladder

1. **Invariants** (property-style loops over many seeds): no double occupancy of an analyzer, sample conservation, results immutable once released, time monotone, truth never visible to recorders, no run overlapping a window, queue discipline.
2. **M/M/c-only mode** (engine unit test only; the real scenarios are closer to deterministic service with bursty arrivals and are explained, not validated, by it).
3. **Hand-calculated fixtures:** arrival reversal (queue admission must follow arrival at the analyzer, not draw order, because transport can reverse them), window boundary (a run must not straddle a QC or maintenance window), rerun, tandem visit, setup change, rack burst, earliest-deadline-first.
4. **SimPy trace-driven parity:** same input file, integer seconds, exact equality on event times; golden files read-only (the author's gate, ADR-0010).
5. **Scenario sanity:** qualitative relations only (sign, ordering, structural zero), not magnitudes.

## 10. Deliberately out of scope

- Predicting any real laboratory; compliance claims (Part 11, Annex 11, ASM, SiLA, OPC UA) — describe, never claim.
- Real data, verbatim vendor file formats, any LIMS or MES product.
- A single summary score; a server, accounts or a database service.
- A PAT or soft-sensor model (optional, only on explicit request); downstream processing and perfusion before session S4.
- Pyodide; DuckDB-WASM in the default bundle (ADR-0003).
- Making architecture C win by construction.
- Viability loss in a held neat sample as a central effect (A040 default 0).
- Pilot-scale purge and discard volume (A068), downstream assay turnaround (A055), instrument-to-instrument bias magnitudes (A032) — unsourced, so not modelled.

## 11. Design parameters without ledger ids (†)

These are design choices to be added to the assumption ledger by the research role, or removed.

| Item | Where used |
|---|---|
| at least 20 seeds for experiment 2 | 6.2 |
| one-minute online sensor cadence | 2 (L1) |
| illustrative times 08:40, 09:00, 09:25 and the 45 min holding time derived from them | 6.1 |
| 4 h maintenance window in SC5 (A031 only says "set per scenario") | 7 |
| QC failure probability in SC7 | 7 |
| SLA thresholds for holding time | 8 |
| shift and fatigue modifiers, roster mix per shift | 4.3 |
