# Research ledgers

What the simulator takes from published sources, what it assumes, and how to tell them apart. The data live in two files:

- `sources.yaml` holds the sources (`S###`): where each came from, what it supports, and how far it was checked.
- `assumptions.yaml` holds every simulator parameter (`A###`) with a default, a range, a unit, a grade and the sources behind it.

Every number below carries an id. If it has none, it does not belong here.

## How to read the grades

| Grade | Meaning | Shown in the UI as |
|---|---|---|
| S | Bioprocess primary source (paper, vendor specification, case study) | sourced |
| P | Proxy borrowed from another domain (clinical lab, blood gas, cell-free medium) or a source too weak to count as primary (a bead study by a vendor-affiliated author) | proxy |
| D | Derived by arithmetic from sourced numbers; the arithmetic is written in `notes` | derived |
| A | Assumption with no source | assumed |

A source has a verification level: `snippet` (seen only as an excerpt or second-hand, not opened), `agent-read` (opened and read by the research executor), or `main-reread` (re-read by the orchestrator). Eleven sources are main-reread: S001, S002, S009, S011, S012, S013, S017, S022, S027, S029, S030. Every other source is provisional, and so is any figure that rests on one, directly or through an A id. A line below that cites such a source says "provisional". Public pages may cite only main-reread sources.

Three rules keep the ledger honest:

1. An observed value and the value the simulator applies are separate entries. The slope reported for a held neat CHO sample is observed (A038, S012) and valid only to its longest hold (A039). The slope the simulator applies to other conditions is an assumption (A040).
2. A bundle (a "profile") lists the ids it is built from in `components` and takes the weakest grade among them, in the order S, P, D, A. A profile with one unsourced component is graded A.
3. A value that could not be sourced stays A, with a note on what was searched. A range end that no source shows is marked with `range_grade`.

## Primer

### Upstream and downstream context

- A culture is expanded through a seed train (N-2, then N-1, then production), a term defined in the biopharma industrial ontology (S049, provisional). In the public A-Mab case study the N-1 seed runs 2-5 d (A005, S017).
- The production culture runs 13-17 d in the A-Mab case study and about 12 d in one fed-batch study (A004, S017, S019, provisional). An intensified perfusion run was about 40 d in one bispecific study (A006, S019, provisional); the range ends 30 d and 90 d have no source (A006).
- The production culture starts at 0.5-1.5e6 cells/mL (A007, S017). Glucose is kept above 1.0 g/L with discrete feeds (A010, S017), so a feed can fall between a draw and its measurement.
- Peak viable cell density in fed-batch is typically 10-30e6 cells/mL according to one paper (A008, S053, provisional); no source was found for perfusion (A009).
- Downstream, clarified harvest goes to a Protein A step that is run in several cycles whose eluates are pooled; the pool is about 20 g/L and carries about 7,200 ppm host-cell protein (range 3,000-12,000 ppm) (A052, A053, S017). One harvest split over cycles and re-pooled still has one origin batch; many-to-many lineage appears only when batches are merged.
- Pool hold limits are product-specific. A 36 h hold point is discussed as an example in a trade article and graded A (A054, S018, provisional), and the A-Mab hold data are "not shown" (S017). No turnaround time for downstream assays was found (A055).
- A-Mab is a hypothetical antibody published as a teaching case. It gives the narrative a public anchor; it is not plant data.

### Culture kinetics

- The truth world uses a simple model: nutrient-limited growth, first-order death, nutrient use proportional to viable cells, product proportional to integrated viable cells (A011). The constants come from a few CHO studies and are provisional: maximum growth rate 0.027 per h (range 0.022-0.033) (A080, S053, S054), death rate 0.0042 per h (A081, S053), glucose half-saturation 0.93 g/L (A109, S056).
- Per-cell rates in a 2 L bioreactor with a mAb-producing research line: glucose 2.5 pmol/cell/d in the exponential phase and 2.1 in the stationary phase (A082, S054), glutamine 1.2 and 0.56 (A083, S054), lactate production 2.3 in the exponential phase (A084, S054). Specific productivity is about 35 pg/cell/d in two industrial fed-batch cultures (A086, S053, S017). All of these are provisional.
- Whether lactate switches to net consumption depends on the cell line; the default is off and the switch is a scenario knob graded A (A085, provisional). The cited cultures reached about 10-22e6 cells/mL at most, so applying their per-cell rates at higher density is an assumption (A011, provisional).

### At-line analyzers and how results leave them

- A FLEX2-class all-in-one analyzer reports 16 analytes from 275 uL in 4.5 min stand-alone (A019, A023, S001). The instrument manual lists 275 s in manual mode and 305 s from the carousel (A023, S003). Coupled to an Ambr system the integrated-analyzer table gives 400-700 uL and 6-8 min (A020, A023, S007). All provisional except the S001 figures.
- A cell counter of the Vi-CELL BLU class is rated under 130 s per sample in normal mode and under 80 s in fast mode, with counting repeatability +/-5% and accuracy +/-10% (A025, A079, S005). A Cedex Bio HT metabolite analyzer is rated at 150-300 tests/h (A026, S006). Provisional.
- Titer is a separate HPLC job. A best-case Protein A method runs in 1 min with an injection of 5-50 uL (A028, A029, S026); the 4 min upper end of the run time has no source (A028). Provisional.
- Measurement precision, from a vendor specification for the all-in-one analyzer: within-run CV 5.0% and day-to-day CV 7.0% for glucose, lactate, glutamine, glutamate and ammonium, pH SD 0.007 within-run and 0.018 day-to-day (A077, A078, S003). These are specification limits, not typical performance. Provisional.
- Range and dilution: at the lowest dilution the analyzer's upper limit is 15 g/L for glucose and 6 g/L for lactate, and higher chemistry dilutions of 2 and 4 extend it (A089, A090, S003). It recalibrates automatically every 2 h (A091, S003). Provisional.
- Interfaces in practice: the FLEX2 writes a CSV file to a shared folder on its bridge computer (A036, S003). Its vendor OPC server is a separately licensed add-on (A036, S004). Connector guides treat these instruments as file-based (A036, S038, S039). SiLA 2 and OPC UA LADS are a future direction, not the installed base, according to one vendor map (S040); public SiLA 2 documentation is at version 1.1 with a 1.2 tag, second-hand (S041). A LADS-with-Allotrope demonstration was shown in 2025, seen only as an excerpt (S031). The simulator therefore models a CSV file drop first. Provisional.
- Result files should be mapped to a canonical schema that borrows from public Allotrope Simple Model ideas without claiming conformance (S031, provisional).

### Sample stability

- Viability of a held neat CHO sample: the authors state that neat samples did not exhibit a decrease in viability and attribute the decline they measured to the diluent (S012). The neat slope of -0.03 percentage points per minute is reported without a significance test (A038, S012), is not evidence of a decline, and is valid to 55 min (A039). The simulator's applied slope is 0 for neat samples, and non-zero slopes are a diluent knob (A040).
- pH after sampling: offline pH is commonly used to ensure correct probe signals after sterilisation and to detect drift; when the difference exceeds defined criteria a readjustment is applied with the offline value as the reference, and pH should not be considered stable after sampling at higher cell density (S013).
- Offline minus vessel pH was measured on cell-free medium in three setups: a 2 L bench vessel with manual sampling, 0.02-0.06 with an average of about 0.04; an Ambr 250 liquid handler, mean about 0.05; a 250 L vessel sampled by syringe, mean 0.021. A single point above 0.1 is called not unusual (A041, S013). The default is 0.04, the case that matches the default scenario, graded P because the medium has no cells (A041).
- Container matters: in an open thin layer CO2 leaves and pH rises with a time constant of 2-3 h (A042, S014, proxy, provisional); in a closed sample with respiring cells pH falls (A037, S016, provisional). Blood-gas practice gives 0.02-0.03 pH/h at room temperature and a 30 min rule (A043, A046, S015, proxy, provisional).
- The earlier idea of a +0.1-0.3 pH rise within 15-30 min has no source, and a glucose decay rate in the tube was not found (A041, A045).

### Standards status

- EU Annex 11 (computerised systems): the Commission's page lists the January 2011 revision as current (S027).
- A revised Annex 11, a revised Chapter 4 and a new draft Annex 22 on AI went to consultation from 7 July 2025 to 7 October 2025 (S028, provisional). The revision is a draft and not final. The simulator cites the 2011 text as current and the 2025 draft as pending.
- Clocks: MHRA 2018 asks for controlled or synchronised clocks and a specified time zone (sections 5.1 and 6.13) (S029). WHO TRS 996 lists restricting changes to clocks, including those in process instrumentation (S030). This supports modelling a wrong-clock scenario; how often it happens has no source, and the +5 h example offset is a neutral choice (A049).
- WHO TRS 1033 adds time-zone configuration, second-hand (S052, provisional).
- ISA-95 Part 3 has a quality operations clause with quality test operations, second-hand (S032, provisional; the preview page returned 403). The B2MML schema folder was seen to have no quality-named schema, second-hand (S051, provisional). The simulator uses Part 3 vocabulary to describe the MES-LIMS boundary and does not claim B2MML conformance.
- Which system owns routine in-process results (MES/EBR or LIMS) depends on the site; vendor sources disagree (A056, S042, S043, provisional) and a BioPhorum paper on MES-LIMS integration is a lead only (S044, provisional). It is a setting, not a norm.
- Historians store batches as event frames with equipment as assets (S048, provisional), and one talk says product genealogy needed custom linking code (S047, provisional). OpenLineage supplies job, run and dataset vocabulary for the lineage view (S050, provisional).

## Profiles

The author pointed out that bioreactor type, analyzer type and staff proficiency each change the process. Each is a bundle with sourced and assumed parts; its grade is the weakest of its components. The default scenario is a bench-scale bay with an all-in-one analyzer and experienced staff.

### Bioreactor classes

| Profile | Working volume | Vessels | How samples are taken | Sample as a share of culture | Ids | Status |
|---|---|---|---|---|---|---|
| micro-parallel (Ambr 15 class) | 10-15 mL | 24 or 48 | liquid handler into a cup | 4.8% per sample, about 600 uL | A065, A057, S010, S011 | provisional |
| mini-parallel (Ambr 250 HT class) | 100-250 mL | 12 or 24 | liquid handler into a cup | 0.31% per sample (0.16-0.7%) | A066, A057, S009, S011, S007 | provisional |
| bench glass or single-use | 2-5 L | set by the scenario | manual draw, closed container or syringe | 0.014% per sample | A067, A002, A057, S013 | provisional |
| pilot single-use | 50-250 L (class boundary is assumed) | set by the scenario | sterile syringe from a sampling line | 0.00055% per sample, analyzer volume only | A068, A104, A057, S013, S036 | provisional |

What the table changes in the simulation: on micro-parallel systems the number of samples consumes the culture itself, so a day of sampling can change volume and gassing (S011) and 14 daily samples would draw 67% of the vessel (A057, D). At bench and pilot scale the volume is negligible and the cost is operator time and hold time instead. Pilot line purge and discard volumes are not sourced and are not modelled (A068, A105). Provisional.

### Analyzer classes

| Profile | Per-sample time | Per-sample volume | Consequence | Ids | Status |
|---|---|---|---|---|---|
| all-in-one (FLEX2 class), full 16-analyte menu | 4.5 min stand-alone, 6-8 min coupled | 275 uL, or 400-700 uL coupled | one queue, one file, one clock | A069, A019, A023, A020, S001, S007 | provisional |
| all-in-one, chemistry plus cell-density panel only | 235 s manual mode | 135-220 uL by dilution | same scope as the split row | A107, S003 | provisional |
| split: counter plus metabolite analyzer, stand-alone | 130 s plus 120 s = 250 s of instrument time over two visits | 200 uL plus 135 uL = 335 uL | two queues; the two results can be measured at different times and carry different clocks | A070, A107, A025, A026, S005, S001 | provisional |
| HPLC titer | 1 min run plus prep | 5-50 uL | shared column; switching cost is assumed | A071, A028, A029, A030, S026 | provisional |

The comparison between the all-in-one and the split profile holds only on the same analyte scope: cells, viability, metabolites and electrolytes, without gases, pH or osmolality. On that scope the split profile needs about 6% more instrument time (250 / 235) and 52% to 148% more sample (335 uL against 220 or 135 uL), spread over two instruments (A107, D, S003, S005, S001). The full 16-analyte menu is a different scope, and the integrated-in-Ambr figures (counter 220 uL, 4-5 min) are a different setting that is not added to stand-alone figures (A020, S007). The earlier 355 uL and +29% figure mixed a counter volume from the integrated setting with a stand-alone chemistry volume and the full menu, and is withdrawn. The metabolite side uses the FLEX2 chemistry module as a stand-in because no per-test volume was found for the Cedex Bio HT (S006). The hand-off between instruments is unsourced (A106), so the split profile is graded A. Provisional.

One FLEX2 handles at most about 13.3 samples/h stand-alone; this is a ceiling that excludes QC, calibration and maintenance (A075, D). With 24 reactors and 1.4-1.6 samples per reactor-day (A001, A014, A015) the average load is 12.6-14.4% of two analyzers per 10 h staffed window, or 5.2-6.0% per 24 h (A074, graded A because the counts and the window are assumptions). The load is low; whether queues still form because samples arrive in bursts is the hypothesis the simulator tests, not a result. Provisional.

### Staff proficiency

| Profile | Count variability | Label errors | Delay and technique | Ids | Status |
|---|---|---|---|---|---|
| experienced operator | manual 2.81% CV between operators, automated 0.46% (bead study, proxy); counting-statistics floor 5.0% for about 400 cells counted by hand | 6.1 per 1000 (clinical proxy) | delay sd 5 min, technique error 0.02 (assumed) | A072, A058, A059, A060, A047, A063, A064, S025, S022 | provisional |
| trainee | manual count CV doubled (assumed), automated unchanged | 6.1 per 1000 doubled (assumed) | delay sd 12 min, technique error 0.10 (assumed) | A073, A076, A062, A063, A064 | assumed, provisional |

What is sourced is narrow: operator-to-operator variability of counting beads by hand and by an automated counter, from a tutorial by a vendor-affiliated author that does not label which figure belongs to which method (A058, A059, S025, proxy); the counting-statistics floor derived from "several hundred" cells counted (A060, D, proxy); and a clinical labeling error rate (A047, S022, S023, proxy). The effect of staff training on labeling errors could not be established; a systematic review found standardized labeling protocols cut errors by a median relative 72.45% in a subset of four studies (A061, S024, proxy) but judged the evidence on training insufficient (A062, S024). All trainee multipliers are assumptions and appear as such in the UI. An automated counter narrows the gap between operators (A059 against A058). Provisional.

## Values added for the engine and metrics

These parameters were missing when the engine and metrics briefs were written. The default and range of each are in the ledger; grade A means that no source was found.

| Item | Default | Ids | Status |
|---|---|---|---|
| Measurement noise: analyzer chemistry, pH, cell counter | CV 5.0% within-run and 7.0% day-to-day; pH SD 0.007; counter +/-5% | A077, A078, A079, S003, S005 | provisional |
| Growth, death, uptake, productivity | see Culture kinetics | A080, A081, A082, A083, A084, A086, A109 | provisional |
| Lactate switch to consumption | off | A085 | assumed, provisional |
| QC failure and rerun probability | 0.02 per QC run, 0.02 per measurement | A087, A088 | assumed |
| Over-range limits and dilution factors | glucose 15 g/L, lactate 6 g/L; factors 1, 2, 4 | A089, A090, S003 | provisional |
| Recalibration interval | 2 h | A091, S003 | provisional |
| Drift per interval and lot step | 1.0% and 2.0% of reading, bounded by a derived 4.9% | A092, A093 | assumed, provisional |
| In-line pH probe drift, controller deadband, readjustment interval | 0.01 pH per day, +/-0.05, daily | A094, A095, A108 | assumed, provisional |
| Maintenance window, holding-time threshold | 4 h, 30 min | A096, A097 | assumed |
| Roster, fatigue multiplier, hands-on time | 10 h staffed window with 2 experienced operators, 1.0 (off), 2 min per sample | A098, A099, A101 | assumed, provisional |
| Sensor cadence, example timeline, minimum seeds | 60 s, draw 08:40 / feed 09:00 / measured 09:25, 20 seeds | A100, A102, A103 | assumed |

## Prior art

Among examples surveyed, the closest on method is a browser-based discrete-event simulation lab with seeded trace replay and generic queue scenarios, seen as an excerpt (S033, provisional). A second runs a healthcare SimPy model in the browser through stlite and notes that it does not work in Firefox, also seen as an excerpt (S034, provisional). A third is a penicillin fermentation simulator with a public batch dataset, which has no at-line analyzer or sample-context layer and is not CHO (S035, provisional). None of the examples surveyed combines analyzer-queue contention with context loss and a switch between data architectures on the same seeded run. This survey was shallow and may have missed work.

## Known gaps

- Peak viable cell density in perfusion has no source (A009). A model scenario in a productivity paper was a lead only, and its figures were not seen (A009, S020, provisional).
- Only 40 d is sourced for perfusion; the range ends are leads (A006, S019, provisional).
- No instrument-to-instrument bias data for FLEX2 or Vi-CELL, no hold-time limit from a bioreactor sample vendor, no downstream assay turnaround, no clock-error incidence, no sampling-technique error rate (A032, A046, A055, A049, A064). No source for QC failure, rerun, drift size or lot-step size either (A087, A088, A092, A093). Provisional.
- The Cedex Bio HT per-test sample volume is not on the vendor page read (A107, S006, provisional).
- Staff-proficiency evidence is clinical or bead-based; no bioprocess study of trainee effects was found (A062, A076, S024, provisional).
- Per-cell kinetics come from a few CHO studies at modest density, one of them a research line with low productivity; the lactate switch and the extension to high density are assumptions (A085, A082, S054, provisional).
- Second-hand sources not opened: the Processes 8(6) automated-sampling paper (A014, A032, S021), the Bioresources and Bioprocessing sampling paper (A014, S037), the FLEX2 OPC manual (A036, S004), the ISA-95 preview (S032) and several vendor blogs (S040-S046). Their claims stay at `snippet`, and all of these lines are provisional.
- Corrections to earlier notes found while reading: a "typical 110 s" Vi-CELL BLU cycle is not on the vendor page (A025, S005, provisional); the +0.05 pH offset is for cell-free medium and an Ambr 250 handler, not for open cups at bench scale (A041, S013); the A-Mab fed-batch range starts at 13 d, and 12 d comes from a different study (A004, S017, S019, provisional); the viability slope of a neat sample is not a decline (A038, A040, S012); utilisation always states its window (A074); the counting-bead study was regraded from sourced to proxy (A058, A059, A060, S025, provisional).
- Eleven sources are main-reread: S001, S002, S009, S011, S012, S013, S017, S022, S027, S029, S030. Before any other number goes on a public page, the orchestrator re-reads its source and sets `main-reread`.

## Working with the ledgers

- Add a source with the `source-add` skill, then cite it by id; add or change a parameter with the `assumption-check` skill.
- `uv run --frozen python scripts/check_docs.py --all` checks the schema (range, unit, components, range_grade), unknown ids, banned tokens, and the public-number gate.
- The public README and the infographic may cite only `main-reread` sources, directly or through the sources behind an A id. A line that cites anything else must say "provisional"; the check enforces both.
