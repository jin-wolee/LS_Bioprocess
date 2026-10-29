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
- Peak viable cell density in fed-batch is typically 10-30e6 cells/mL according to one paper (A008, S053, provisional). For perfusion the default of 60e6 is the density in one worked illustration, not a measurement, so it is graded P (A009, S080, provisional); a general statement of more than 100e6 sits above its upper end (A009, S079, provisional), and the low end 30 has no source (A009).
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
- The earlier idea of a +0.1-0.3 pH rise within 15-30 min has no source (A041). A glucose decay rate in a held tube was not found; the simulator derives one from the bioreactor per-cell rates and an assumed temperature factor, and it is off by default (A045, provisional). Cell settling in an unmixed sample rests on one measurement with Jurkat cells in a tube, 26 % lower after 5 min, applied to CHO cells as an assumption (A044, S117, provisional).

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
| In-line pH probe drift, controller deadband, readjustment interval | 0.01 pH per day, +/-0.02, daily | A094, A095, A108 | drift and interval assumed; deadband from a public manual; provisional |
| Maintenance window, holding-time threshold | 4 h, 30 min | A096, A097 | assumed |
| Roster, fatigue multiplier, hands-on time | 10 h staffed window with 2 experienced operators, 1.0 (off), 2 min per sample | A098, A099, A101 | assumed, provisional |
| Sensor cadence, example timeline, minimum seeds | 60 s, draw 08:40 / feed 09:00 / measured 09:25, 20 seeds | A100, A102, A103 | assumed |

## Values added for the S1b inputs

These parameters were missing when the process and logistics inputs of S1b were checked. Clock times, caps and effect sizes are scenario settings (grade A). Sourced values are from open-access CHO fed-batch studies that were opened but not re-read by the orchestrator, so every line is provisional.

| Item | Default | Ids | Status |
|---|---|---|---|
| Inoculation stagger, horizon | 4 cohorts of 6 reactors, one cohort per day from a Monday, 15 min between reactors from 08:00; 21 d | A188, A189 | assumed |
| Initial glucose and glutamine | 8 g/L (medium content of one study; range 4-15) and 4 mM (range 2-8) | A190, A191, S112, S113, S114 | sourced, low glucose end assumed, provisional |
| Bolus feed | 2.4 % of the volume of a 500 g/L glucose stock, a glucose rise of 11.7 g/L; the nutrient-feed alternative is 10 % of a 60 g/L feed; glutamine 200 mM in the bolus | A192, A193, A208, S110, S112 | derived and sourced, glutamine assumed, provisional |
| Feed window and decision | window 09:00-11:00, bolus executed at the 10:00 decision | A194, A050, A102 | assumed |
| Temperature shift | 37 to 33 C on culture day 4 at 10:00 (range day 3-5, 30-35 C) | A195, S110, S111 | sourced range, default a pick inside it, provisional |
| Shift effect | growth x 0.5, death x 0.5, productivity x 1.5 | A196, S115 | assumed, provisional |
| Alarms and sensors | no scripted alarms; limits relative to set points; pH 7.00, DO 30 %, 37 C; noise sd 0.005 pH, 0.2 %, 0.02 C; 60 s step | A197, A198, A199, A200, S110 | set points sourced, rest assumed, provisional |
| Roster, burst remainder, staggered window | shifts 08:00-13:00 and 13:00-18:00 with 2 operators, weekend 08:00-14:00 with 1; 35 % uniform; staggered windows 45 min wide, 45 min apart | A201, A202, A203 | assumed |
| QC, maintenance, deadline | QC 30 min at 08:00; SC5 maintenance 08:30-12:30 (4 h, A096) on day 8; deadline = next 10:00 | A204, A205, A206 | assumed |
| Sample-volume cap | 33 % of the initial working volume per reactor | A207, S011, S110 | assumed, provisional |
| Held-sample effects | settling 0.05 per min up to 0.30; glucose and lactate at the A082 and A084 rates times 0.35 at room temperature; both off by default | A044, A045, S117, S054 | assumed, provisional |

## Prior art

Among examples surveyed, the closest on method is a browser-based discrete-event simulation lab with seeded trace replay and generic queue scenarios, seen as an excerpt (S033, provisional). A second runs a healthcare SimPy model in the browser through stlite and notes that it does not work in Firefox, also seen as an excerpt (S034, provisional). A third is a penicillin fermentation simulator with a public batch dataset, which has no at-line analyzer or sample-context layer and is not CHO (S035, provisional). None of the examples surveyed combines analyzer-queue contention with context loss and a switch between data architectures on the same seeded run. This survey was shallow and may have missed work.

## Known gaps

- Peak viable cell density in perfusion has no measurement: the default of 60e6 is the density in a worked illustration whose figures come from a model scenario (A009, S080, S020, provisional; graded P). The upper end 100 sits below a general statement of more than 100e6 (A009, S079, provisional), and the low end 30 has no source (A009).
- Only 40 d is sourced for perfusion; the range ends are leads (A006, S019, provisional).
- No instrument-to-instrument bias data for FLEX2 or Vi-CELL, no hold-time limit from a bioreactor sample vendor, no downstream assay turnaround, no clock-error incidence, no sampling-technique error rate (A032, A046, A055, A049, A064). No source for QC failure, rerun, drift size or lot-step size either (A087, A088, A092, A093). Provisional.
- The Cedex Bio HT per-test sample volume is not on the vendor page read (A107, S006, provisional).
- Staff-proficiency evidence is clinical or bead-based; no bioprocess study of trainee effects was found (A062, A076, S024, provisional).
- Per-cell kinetics come from a few CHO studies at modest density, one of them a research line with low productivity; the lactate switch and the extension to high density are assumptions (A085, A082, S054, provisional).
- Second-hand sources not opened: the Processes 8(6) automated-sampling paper (A014, A032, S021), the Bioresources and Bioprocessing sampling paper (A014, S037), the ISA-95 preview (S032) and several vendor blogs (S040-S046). Their claims stay at `snippet`, and all of these lines are provisional.
- Corrections to earlier notes found while reading: a "typical 110 s" Vi-CELL BLU cycle is not on the vendor page (A025, S005, provisional); the +0.05 pH offset is for cell-free medium and an Ambr 250 handler, not for open cups at bench scale (A041, S013); the A-Mab fed-batch range starts at 13 d, and 12 d comes from a different study (A004, S017, S019, provisional); the viability slope of a neat sample is not a decline (A038, A040, S012); utilisation always states its window (A074); the counting-bead study was regraded from sourced to proxy (A058, A059, A060, S025, provisional).
- S1b inputs: no source for the inoculation stagger, horizon, roster and QC clock times, the sample-volume cap (searched; no percentage cap found), the alarm schedule or the size of the temperature-shift effect; initial glucose is the medium content of one study and its low range end is a round number (A188, A189, A201, A204, A207, A197, A196, A190; provisional).
- Eleven sources are main-reread: S001, S002, S009, S011, S012, S013, S017, S022, S027, S029, S030. Before any other number goes on a public page, the orchestrator re-reads its source and sets `main-reread`.

## Working with the ledgers

- Add a source with the `source-add` skill, then cite it by id; add or change a parameter with the `assumption-check` skill.
- `uv run --frozen python scripts/check_docs.py --all` checks the schema (range, unit, components, range_grade), unknown ids, banned tokens, and the public-number gate.
- The public README and the infographic may cite only `main-reread` sources, directly or through the sources behind an A id. A line that cites anything else must say "provisional"; the check enforces both.

## Planned extensions (designed, not built)

The current build stays focused on results that lose their process context. Three extensions are researched and parametrised in the ledgers only; nothing here is implemented. All lines below are provisional: none of the new sources (S057-S083) is main-reread, and several were seen only as search excerpts.

### Cell-line profiles

- Reactors would differ by clone. In one panel of eight clones in 1.2 mL wells the best clone had 2.4 to 15.5 times the specific productivity of the worst depending on mode (A120, S074; provisional, ratios derived from quoted ends), and peak density differed 1.6 to 5.3 times (A121, S074; provisional). The defaults for both are assumed.
- Growth rate varies less. The widest gap among five clones was 0.0041 per h, about 15% of the default growth rate, so a clone SD of about 6.5% is derived (A119, S077; provisional, search excerpt only).
- Lactate behaviour is the visible difference: a production multiplier of 0.44 to 1.25 (A122, S075, S074; provisional proxy) and a late switch to net consumption in some clones (A123, A151, S054, S074; provisional; the share of switchers is assumed). Bundles: A150, A151, A152 (provisional).

### Operating modes

- Batch and intensified fed-batch would join fed-batch and perfusion (A124, S079, S080; provisional). An intensified run starts at 2 to 20e6 cells/mL from a perfused or enriched-batch N-1 seed (A126, S079; provisional), so the seed becomes a lineage parent (A155; provisional). Batch length and intensified run length are assumed (A125, A127).
- Perfusion runs at 1 to 3 vessel volumes per day with a 0.3 per day bleed, both taken from one worked illustration and graded P (A128, A129, S080; provisional), is sampled twice a day (A130, S063; provisional), and has no batch boundary, so the context unit is a harvest window whose length is assumed (A132, S060; provisional). Permeate and bleed are extra streams (A133, S080; provisional).
- Cadence has a side effect on sampling hygiene: 40 days at 2 samples per day is 80 draws against a 50-draw validation limit of one single-use port connection (A134, A156, S069; provisional, derived).

### Contamination: origin and detection

- Rate. Contamination as the stated cause of batch failure was 2.3% in large facilities, about 0.77% in small ones by derivation (A135, S066; provisional, a 2008 self-reported survey). That is about 0.18 events per 24 reactors per cycle (A135, A001; provisional), so a scenario should inject an event rather than wait for chance. Viral events are rarer: 18 since 1985 at 9 of 20 companies (S058; provisional), mostly in CHO and traced to raw materials (S059; provisional).
- Sampling as a route. No measured rate per draw was found; the assumed default sits under a derived ceiling of 0.001 (A136, S064, S068; provisional, graded A). The type mix is assumed (A137; provisional).
- Signals come before tests. Mycoplasma changed the culture 2 to 6 days after introduction in one study (A138, S063; provisional); bacterial contamination shows first as a DO drop and a pH fall (A140, S065, S064; provisional), with the lag and magnitudes assumed (A139, A141).
- Test turnaround. Bioburden 3 to 7 d as a proxy (A142, S073; provisional), sterility 14 d (A143, S072; provisional), mycoplasma culture 28 d or indicator cells 6 to 10 d (A144, A145, S061; provisional), virus assay 14 to 28 d (A147, S060; provisional), nucleic-acid tests about a day (A146; provisional, assumed). Bundles: A157, A158 (provisional).
- Test samples are large. The mycoplasma set needs 11.5 mL (A148, S083; provisional), which is 77% to 115% of a micro-parallel vessel (A148, A110; provisional, derived), so those vessels cannot supply it.

### What an investigation needs from the data

- A positive result starts a walk back over three sets: the reactor's samples and results since the estimated onset, the pools and downstream lots holding its material, and other reactors or batches sharing a seed, feed lot, media lot or equipment; a written deviation record closes it (A149, S071, S060, S064; provisional). For continuous harvest the unit is the harvest window (A132, S060; provisional).
- Two scenario inputs have no source and no default, so each result prints them: the delay from the first signal, and from a confirmed positive, to a hold or quarantine action (A176, S065, S058; provisional, graded A), and how many reactors share a seed, media or feed lot (A177, S071, S049; provisional, graded A). Lot withdrawal after a recall decision has only proxy reference points, from UK recall classes (immediate, within 48 h, within 5 days, given as advice) and a 45-day US reporting limit for distributed biologics, and nothing for putting unreleased pools on hold (A187, S107, S108, S109, S071; provisional, graded P).

### Gaps (provisional)

- No measured contamination probability per draw (A136), no CHO bench-scale per-batch rate (A135 rests on S066, provisional), and no source for the type mix, the bacterial lag, the signal magnitudes or the nucleic-acid turnaround (A137, A139, A141, A146).
- No source for batch length or intensified run length (A125, A127). The perfusion peak density A009 is graded P: its default is one worked illustration and its upper end a general statement, not a measurement, and the low end is unsourced (A009, S080, S079; provisional).
- The sterility text is a 2008 draft and the enumeration text was seen only as an excerpt (S072, S073; provisional); the body of the consortium paper was not read (S057; provisional).

## Device output formats (planned for S2)

The simulator would write synthetic raw files in the shapes that public documentation describes for lab equipment, then parse them into the canonical schema, so the whole path from raw device output to contextualised data can be shown. The formats are modeled on public documentation; the project does not claim to read any real instrument's files, and no manual text is copied. All lines below are provisional: none of the new sources (S084-S109) is main-reread, and several were seen only as search excerpts.

### Analyzers

- Metabolite and cell analyzer. An export is a CSV named `SampleResultsYYYY-MM-DD_HHMMSS.csv`, written when an operator exports selected rows (A159, S003, S086; provisional). Times are local with no zone, the date order and 12 or 24 h are set by the user, and units sit in a second row or are implied by settings (A160, A161, A162, S003, S038, S086; provisional). A reanalysis adds a row and keeps the original time (A164, S003; provisional). An over-range result is documented as error-log text; how it looks in the CSV is assumed (A163, S003, S004; provisional).
- The same analyzer's OPC interface exposes the record with UTC time, a separate local offset, operator, dilution ratios and per-analyte error status (A165, S004; provisional), plus autosampler request and aspirate events (S004; provisional).
- Cell counter. The sample export has 32 columns with units in the headers and a timestamp without seconds or zone (A166, S084, S085, S086; provisional). An append mode can repeat earlier rows, so ingest must be idempotent (A167, S085; provisional).
- Titer by HPLC. A data-system result export is a user-designed table of injection and peak fields, with retention time in seconds and area in mAU*s for UV; the amount column for a titer method is assumed (A168, S088, S090, S091; provisional). Audit trails and result ids exist per injection, result set, sequence and method (A169, S089, S090; provisional).
- Vendor-neutral names are borrowed from public Allotrope and AnIML structures with no conformance claim (S087, S092; provisional). The Allotrope Simple Model licence is non-commercial (CC-BY-NC) or no-derivatives (CC-BY-ND), so no schema file is copied (S087; provisional).

### Controllers

- Vendor-neutral. ISA-88 procedure, unit procedure, operation and phase, with 13 phase states (A170, S093, S094, S051; provisional). Process tags with PV, SP and Out roles (A171, S099, S101; provisional). The ISA-18.2 alarm states and OPC UA alarm fields (A174, S095, S097; provisional), with starting alarm deadbands and delays borrowed from the process industry (A175, S096; provisional). Historian exception and compression defaults (A173, S098; provisional).
- Bench-scale family. One public controller manual describes five record types, deadband logging with a maximum log interval, and an appendix of logger variables (A172, S099; provisional). Another family's OPC tag list is on request only, so it is not usable (S103; provisional); a third has OPC and CSV but no published tag list (S100, S102; provisional).
- Controller signal parameters. The one public bench-controller manual gives default logging deadbands for pH (0.05), DO (2 %), temperature (0.2 C) and the pump duties (1 to 2 %), and a default maximum log interval of 60 min whose unit is read from a label (A178, A179, S099; provisional). Gas flow and pump ranges are capability figures from two products of different scale that bracket the 2 to 5 L bench class: about 0.7 mL/min to 10 L/min for gases, and a 50 % auto-mode cap on the base pump (A180, A181, S099, S104; provisional, graded P). The rule for OUT is a two-sided deadband around the set point, default 0.02 pH and 1 % DO (A182, S099; provisional), the same pH deadband as A095. An off-gas CO2 analyzer spans 0 to 25 %, but no typical culture value was found, and the mini cell-culture system has no exhaust analysis (A183, S105, S104; provisional). The bench controller's default alarm limits are absolute (pH 7.10 to 7.30, DO 30 to 70 %, temperature 35 to 39 C) and no source gives an alarm deadband or delay for pH or DO (A184, A185, S099, S096; provisional). An operator needs about 49 s to respond to an alarm in a process-industry simulator study, a proxy and not a measured acknowledgement time (A186, S106; provisional, graded P).

### Gaps (provisional)

- The analyzer manuals describe screen fields, not the CSV header, so the header spellings come from community test files (A160, A166, S086; provisional).
- No vendor document shows a titer amount column, and the cell counter's instructions for use were not opened (A168, A166, S084; provisional).
- Analyzer files carry no time zone; only the OPC side gives UTC and the local offset (A161, S004; provisional).
- No typical operating gas flow for the 2 to 5 L bench class, no typical exhaust CO2, no alarm deadband or delay for pH or DO, and no acknowledgement-time distribution for a bioprocess laboratory (A180, A183, A185, A186; provisional).
- The ISA-88 and ISA-18.2 standards are paywalled and OPC UA Part 13 aggregates were not opened, so those models rest on summaries (A170, A174, S093, S095; provisional).
