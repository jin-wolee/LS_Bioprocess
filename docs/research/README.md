# Research ledgers

What the simulator takes from published sources, what it assumes, and how to tell them apart. The data live in two files:

- `sources.yaml` holds the sources (`S###`): where each came from, what it supports, and how far it was checked.
- `assumptions.yaml` holds every simulator parameter (`A###`) with a default, a range, a unit, a grade and the sources behind it.

Every number below carries an id. If it has none, it does not belong here.

## How to read the grades

| Grade | Meaning | Shown in the UI as |
|---|---|---|
| S | Bioprocess primary source (paper, vendor specification, case study) | sourced |
| P | Proxy borrowed from another domain (clinical lab, blood gas, cell-free medium) | proxy |
| D | Derived by arithmetic from sourced numbers; the arithmetic is written in `notes` | derived |
| A | Assumption with no source | assumed |

A source has a verification level: `snippet` (seen only as an excerpt or second-hand, not opened), `agent-read` (opened and read by the research executor), or `main-reread` (re-read by the orchestrator). **No source is `main-reread` yet**, so none of the figures in this file is cleared for use as a public number. Treat them as provisional.

Three rules keep the ledger honest:

1. An observed value and the value the simulator applies are separate entries. The viability slope in a held neat CHO sample is observed (A038, S012) and valid only to its longest hold (A039). The slope the simulator applies to other conditions is an assumption (A040).
2. A bundle (a "profile") takes the weakest grade of its parts. A profile with one unsourced component is graded A, and its `components` field says which.
3. A value that could not be sourced stays A, with a note on what was searched.

## Primer

### Upstream and downstream context

- A culture is expanded through a seed train (N-2, then N-1, then production), a term defined in the biopharma industrial ontology (S049). In the public A-Mab case study the N-1 seed runs 2-5 d (A005, S017) and the production culture runs 13-17 d (A004, S017). An intensified perfusion run was about 40 d in one bispecific study, against about 12 d for its fed-batch (A006, A004, S019).
- The production culture starts at 0.5-1.5e6 cells/mL (A007, S017). Glucose is kept above 1.0 g/L with discrete feeds (A010, S017), so a feed can fall between a draw and its measurement.
- Downstream, clarified harvest goes to a Protein A step that is run in several cycles whose eluates are pooled; the pool is about 20 g/L and carries about 7,200 ppm host-cell protein (range 3,000-12,000 ppm) (A052, A053, S017). One harvest split over cycles and re-pooled still has one origin batch; many-to-many lineage appears only when batches are merged.
- Pool hold limits are product-specific. A 36 h hold point is discussed as an example in the trade literature, and the A-Mab hold data are "not shown" (A054, S018, S017). No turnaround time for downstream assays was found (A055).
- A-Mab is a hypothetical antibody published as a teaching case. It gives the narrative a public anchor; it is not plant data.

### At-line analyzers and how results leave them

- A FLEX2-class all-in-one analyzer reports 16 analytes from 275 uL in 4.5 min stand-alone (A019, A023, S001). Coupled to an Ambr system the Sartorius table gives 400-700 uL and 6-8 min (A020, A023, S007).
- A cell counter of the Vi-CELL BLU class is rated under 130 s per sample in normal mode and under 80 s in fast mode (A025, S005). A Cedex Bio HT metabolite analyzer is rated at 150-300 tests/h (A026, S006).
- Titer is a separate HPLC job. A best-case Protein A method runs in 1 min with an injection of 5-50 uL (A028, A029, S026).
- Interfaces in practice: the FLEX2 writes a CSV file to a shared folder on its bridge computer (A036, S003). Its vendor OPC server is a separately licensed add-on (A036, S004). Connector guides treat these instruments as file-based (A036, S038, S039). SiLA 2 and OPC UA LADS are a future direction, not the installed base, according to one vendor map (S040); public SiLA 2 documentation is at version 1.1 with a 1.2 tag, second-hand (S041). A LADS-with-Allotrope demonstration was shown in 2025 (S031). The simulator therefore models a CSV file drop first.
- Result files should be mapped to a canonical schema that borrows from public Allotrope Simple Model ideas without claiming conformance (S031).

### Sample stability

- Viability of a neat CHO sample held up to 55 min fell by 0.03 percentage points per minute in the one study read (A038, A039, S012). That paper is about a PBS-dilution artifact; its hold temperature was not found in the text read, and the neat sample showed no clear decrease by the authors' own reading (S012). The simulator's applied slope is A040 and is labeled assumed.
- pH after sampling: offline pH is commonly used to readjust the online probe, taking the offline value as the source of truth, and pH should not be considered stable after sampling at higher cell density (A051, S013). The one measured open-sample offset is about +0.05 for Ambr 250 liquid-handler samples, taken on cell-free medium before inoculation (A041, S013).
- Container matters: in an open thin layer CO2 leaves and pH rises with a time constant of 2-3 h (A042, S014, proxy); in a closed sample with respiring cells pH falls (A037, S016). Blood-gas practice gives 0.02-0.03 pH/h at room temperature and a 30 min rule (A043, A046, S015, proxy).
- The earlier idea of a +0.1-0.3 pH rise within 15-30 min has no source, and a glucose decay rate in the tube was not found (A041, A045).

### Standards status

- EU Annex 11 (computerised systems): the Commission's page lists the January 2011 revision as current (S027). A revised Annex 11, a revised Chapter 4 and a new draft Annex 22 on AI went to consultation from 7 July 2025 to 7 October 2025 (S028). The revision is a draft and not final. The simulator cites the 2011 text as current and the 2025 draft as pending.
- Clocks: MHRA 2018 asks for controlled or synchronised clocks and a specified time zone (sections 5.1 and 6.13) (S029). WHO TRS 996 lists restricting changes to clocks, including those in process instrumentation (S030). WHO TRS 1033 adds time-zone configuration, second-hand (S052). This supports modelling a wrong-clock scenario; how often it happens has no source (A049).
- ISA-95 Part 3 has a quality operations clause with quality test operations (S032, preview only). The B2MML schema folder was seen to have no quality-named schema, second-hand (S051). The simulator uses Part 3 vocabulary to describe the MES-LIMS boundary and does not claim B2MML conformance.
- Which system owns routine in-process results (MES/EBR or LIMS) depends on the site; vendor sources disagree (A056, S042, S043) and a BioPhorum paper on MES-LIMS integration is a lead only (S044). It is a setting, not a norm.
- Historians store batches as event frames with equipment as assets (S048), and one talk says product genealogy needed custom linking code (S047). OpenLineage supplies job, run and dataset vocabulary for the lineage view (S050).

## Profiles

The author pointed out that bioreactor type, analyzer type and staff proficiency each change the process. Each is a bundle with sourced and assumed parts. The default scenario is a bench-scale bay with an all-in-one analyzer and experienced staff.

### Bioreactor classes

| Profile | Working volume | Vessels | How samples are taken | Sample as a share of culture | Ids |
|---|---|---|---|---|---|
| micro-parallel (Ambr 15 class) | 10-15 mL | 24 or 48 | liquid handler into a cup | 4.8% per sample, about 600 uL | A065, A057, S010, S011 |
| mini-parallel (Ambr 250 HT class) | 100-250 mL | 12 or 24 | liquid handler into a cup | 0.31% per sample (0.16-0.7%) | A066, A057, S009, S011, S007 |
| bench glass or single-use | 2-5 L | set by the scenario | manual draw, closed container or syringe | 0.014% per sample | A067, A002, A057, S013 |
| pilot single-use | 50-250 L (class boundary is assumed) | set by the scenario | sterile syringe from a sampling line | 0.00055% per sample, analyzer volume only | A068, A057, S013, S036 |

What the table changes in the simulation: on micro-parallel systems the number of samples consumes the culture itself, so a day of sampling can change volume and gassing (S011) and 14 daily samples would draw 67% of the vessel (A057, D). At bench and pilot scale the volume is negligible and the cost is operator time and hold time instead. Pilot line purge and discard volumes are not sourced and are not modelled (A068).

### Analyzer classes

| Profile | Per-sample time | Per-sample volume | Consequence | Ids |
|---|---|---|---|---|
| all-in-one (FLEX2 class) | 4.5 min stand-alone, 6-8 min coupled | 275 uL, or 400-700 uL coupled | one queue, one file, one clock | A069, A019, A023, A020, S001, S007 |
| split: counter plus metabolite analyzer | 130 s plus 120 s = 4.2 min of instrument time | 220 uL plus 135 uL = 355 uL, 29% more | two queues; the two results can be measured at different times and carry different clocks | A070, A025, A026, S005, S006, S001 |
| HPLC titer | 1 min run plus prep | 5-50 uL | shared column; switching cost is assumed | A071, A028, A029, A030, S026 |

The 355 uL and 4.2 min figures are sums of sourced numbers (D); the metabolite side uses the FLEX2 chemistry module as a stand-in because no per-test volume was found for the Cedex Bio HT (S006). The hand-off between instruments is unsourced (A070), so the split profile is graded A. One FLEX2 handles about 13.3 samples/h stand-alone (A075, D). With 24 reactors and 1.4-1.6 samples per reactor-day (A001, A014, A015) the average load is 12.6-16% of two analyzers over a 9-10 h window (A074, graded A because the counts and the window are assumptions); the load is low, which is why queueing comes from bursts and not from capacity.

### Staff proficiency

| Profile | Count variability | Label errors | Delay and technique | Ids |
|---|---|---|---|---|
| experienced operator | manual 2.81% CV between operators, automated 0.46% (beads); counting-statistics floor 7.1% for a manual count | 6.1 per 1000 (clinical proxy) | delay sd 5 min, technique error 0.02 (assumed) | A072, A058, A059, A060, A047, A063, A064, S025, S022 |
| trainee | manual count CV doubled (assumed), automated unchanged | 6.1 per 1000 doubled (assumed) | delay sd 12 min, technique error 0.10 (assumed) | A073, A076, A062, A063, A064 |

What is sourced is narrow: operator-to-operator variability of counting beads by hand and by an automated counter (A058, A059, S025), the counting-statistics floor derived from "several hundred" cells counted (A060, D), and a clinical labeling error rate (A047, S022, S023). The effect of staff training on labeling errors could not be established; a systematic review found standardized labeling protocols cut errors by a median relative 72% (A061, S024, proxy) but judged the evidence on training insufficient (A062, S024). All trainee multipliers are assumptions and appear as such in the UI. An automated counter narrows the gap between operators (A059 against A058).

## Prior art

Among examples surveyed, the closest on method is a browser-based discrete-event simulation lab with seeded trace replay and generic queue scenarios (S033). A second runs a healthcare SimPy model in the browser through stlite and notes that it does not work in Firefox (S034). A third is a penicillin fermentation simulator with a public batch dataset, which has no at-line analyzer or sample-context layer and is not CHO (S035). None of the examples surveyed combines analyzer-queue contention with context loss and a switch between data architectures on the same seeded run. This survey was shallow and may have missed work.

## Known gaps

- Peak viable cell density has no source for fed-batch or perfusion (A008, A009). A model scenario in a productivity paper was a lead only, and its figures were not seen (S020).
- Only 40 d is sourced for perfusion; the range ends are leads (A006).
- No instrument-to-instrument bias data for FLEX2 or Vi-CELL, no hold-time limit from a bioreactor sample vendor, no downstream assay turnaround, no clock-error incidence, no sampling-technique error rate (A032, A046, A055, A049, A064).
- The Cedex Bio HT per-test sample volume is not on the vendor page read (A070, S006).
- Staff-proficiency evidence is clinical or bead-based; no bioprocess study of trainee effects was found (A062, A076, S024).
- Second-hand sources not opened: the Processes 8(6) automated-sampling paper (A014, A032, S021), the Bioresources and Bioprocessing sampling paper (A014, S037), the FLEX2 manual's export section and OPC manual (A036, S003, S004), the ISA-95 preview (S032) and several vendor blogs (S040-S046). Their claims stay at `snippet`.
- Corrections to earlier notes found while reading: a "typical 110 s" Vi-CELL BLU cycle is not on the vendor page (A025, S005); the +0.05 pH offset is for cell-free medium and an Ambr 250 handler, not for open cups at bench scale (A041, S013); the A-Mab fed-batch range starts at 13 d, and 12 d comes from a different study (A004, S017, S019).
- Nothing here is main-reread. Before any of these numbers goes on a public page, the orchestrator re-reads the source and sets `main-reread`.

## Working with the ledgers

- Add a source with the `source-add` skill, then cite it by id; add or change a parameter with the `assumption-check` skill.
- `uv run --frozen python scripts/check_docs.py --all` checks the schema, unknown ids and banned tokens.
- The public README and the infographic may cite only `main-reread` sources; the check refuses anything else there.
