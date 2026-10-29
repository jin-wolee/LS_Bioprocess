# ADR-0014: Equipment output adapters modeled on public documentation
- **Status:** Accepted
- **Date:** 2026-10-29

## Context

Until now the recorders (L4) receive `observable_events`, which are already structured. Real equipment does not hand over structured events. An analyzer writes a file whose timestamps are local wall-clock text with no zone, whose date order and 12 or 24 h clock are user settings, whose export can repeat earlier rows, and whose over-range results are blank cells with an error note. A bioreactor controller logs a value only when it moves by its deadband or when a maximum interval has passed, and writes alarm and batch-phase records with their own state models. Part of the context loss the simulator studies begins at this boundary, where a device file becomes a record.

The author asked to add equipment output adapters, modeled on public documentation, to S2, so that the whole path from raw device data to contextualised, AI-ready data is one pipeline (statement below). The research for it is in `docs/research/README.md` ("Device output formats"), with sources S084 to S103 and assumptions A159 to A177. Three limits shape the choice: public material only (the project may not hold manual text), origin safety (nothing may point to one employer or one product line), and no claim that any real instrument is supported. The public Allotrope Simple Model schemas are licensed non-commercial or no-derivatives (S087), so only their concept names can be borrowed.

## Options

1. **Canonical-only: no raw layer.** Recorders keep receiving structured events.
   - Pro: nothing to build; S2 stays small.
   - Con: the step where most real data quality problems appear (zone-less stamps, date order, appended duplicate rows, blank over-range cells, sparse deadband logs) is invisible, and the parser of the earlier S2 brief would be tested only on one generic CSV.
2. **One real vendor format, end to end.**
   - Pro: concrete and recognisable.
   - Con: points to one vendor (an origin risk), invites a claim of support that cannot be tested, and the header spellings rest on community files and screen-field lists, not on a published export specification (A160, A166). It would also tempt copying manual text.
3. **Vendor-neutral synthetic dialects modeled on several public documents.** One dialect per analyzer profile and per controller family, written as profile data, with an emitter that renders observable events into a synthetic raw file and an adapter that parses it into the canonical schema.
   - Pro: shows the full pipeline and its failure modes; several sources are treated evenly; every file says that it is synthetic; the round trip (emit, then parse) gives hand-checkable fixtures.
   - Con: more S2 scope, almost every entry behind it is provisional, and a reader may still infer compatibility unless the rules below are enforced.
4. **Use the Allotrope Simple Model schemas as the raw format.**
   - Pro: a public standard vocabulary.
   - Con: the licence is non-commercial or no-derivatives (S087), which conflicts with ADR-0008, and it is a canonical model, not what a device writes.

## Decision

Proposed: option 3.

| Part | What it adds | Dialects | Ledger |
|---|---|---|---|
| Analyzers | per analyzer profile, an output dialect | `allinone_csv`, `counter_csv`, `cds_table` | A159 to A169 |
| Controllers | per controller family, tag log, alarm log and batch-phase log | `ctrl_neutral`, `ctrl_bench` | A170 to A175 |

- A raw device layer sits between L3 and L4 (`docs/design/simulation_spec.md` section 2.4). Its entities and the mapping to `result`, `historian_value`, `alarm_event` and `batch_phase_record` are in `docs/design/data_model.md` section 16.
- Dialects are data under `scenarios/profiles/dialect/` and `scenarios/profiles/controller/`, validated like the ADR-0012 profiles. The engine has one generic emitter and one generic parser and never branches on a dialect id.
- With every quirk switched off, parsing an emitted file returns the observable events it was rendered from (round-trip fixture). The raw layer adds distortion only where a switch asks for it.
- The layer is a scenario setting (`raw_layer`, off by default), not a ninth flag, so ADR-0005 is unchanged. With the layer off every earlier scenario keeps a byte-identical event log. With it on, the same raw files exist for every architecture.
- How a result becomes a record is a second independent setting, `capture_path`, with the values `manual_transcription` and `adapter_ingest`. It is a scenario setting like the labelling method of ADR-0005, not a ninth flag. Under `manual_transcription` a person reads the instrument screen or printout and types the result into a spreadsheet, and no adapter runs; transcription errors, unit and dilution mistakes and late entry live here. Under `adapter_ingest` the raw file of the device dialect is parsed into canonical records. Defaults: preset A `manual_transcription`, presets B and C `adapter_ingest`. Any preset may override the default, so a scenario can show the effect of automatic linkage alone (for example A with `adapter_ingest`, compared with A as it is). The setting is read only when `raw_layer` is on. Definition and effects: `docs/design/simulation_spec.md` section 5 ("Capture path"); where the path is recorded: `docs/design/data_model.md` section 16.2. This follows the author's statement below.
- Built in S2, as its own steps with gates in `prompts/20_S2_capture_metrics.md`. S1 is not touched.
- Not built: real instrument files, vendor OPC servers, SiLA 2 or OPC UA LADS interfaces, summer-time changes, any Allotrope schema file.

## Consequences

- Positive: the pipeline from device file to canonical record is visible and testable; four error classes of the existing matrix gain a raw-level origin and two more are added (spec section 5); ingest metrics (parse failures, ambiguous timestamps, duplicate rows suppressed, quarantines) give the capture side a measurable result.
- Negative: more S2 scope; all ledger entries behind the dialects are provisional (none of S084 to S103 is `main-reread`), so no dialect figure may go on a public page yet; several details are assumed and printed as assumed (the over-range form inside a CSV, A163; the titer amount column, A168; the CSV layout of the bench controller, S099).
- Gaps to close in the ledgers before the controller emitters are built: log deadband and maximum interval for tags other than agitation (A172), alarm deadband and delay for pH and DO (A175), signal parameters for gas flows, pumps and off-gas CO2 (A100 covers pH, DO and temperature only). Until then those tags are not built.
- Rules this decision creates. Each is checked by the checklist in `prompts/20_S2_capture_metrics.md` (Step 8):
  1. **R1 Public material only.** No manual text, table or paragraph is stored in the repo; quotes and links live only in the ledgers. Dialect labels are short field names taken from ledger field lists.
  2. **R2 Origin safety.** Profile ids, dialect ids, file-name prefixes and column labels are vendor-neutral; where sources name products, several vendors are treated evenly; no banned token (`check_docs`) appears.
  3. **R3 No compatibility claims.** Every emitted file starts with the line "synthetic, modeled on public documentation; not a real instrument file", and every page that describes a dialect says "synthetic formats modeled on public documentation". The words "supports", "compatible" and "certified" never refer to a real instrument.
- Capture path: the primitive baseline (results copied by hand) stays in the comparison and automatic linkage is an option, as the author asked. The cost is that every architecture can run both paths, so a path contrast doubles the raw-layer runs of a scenario; it is reported over at least 20 seeds and never gated. The earlier open question (should preset A parse files?) is closed by the setting: A does not by default, and a scenario can make it.

## Evidence

- Ledger: A159 to A169 (analyzer dialects), A170 to A175 (controller dialects), A176 and A177 (response delay and shared-lot topology, used by SC12); sources S084 to S103, all provisional. A049, S029 and S030 for clocks and zones.
- Licence: S087 (Allotrope Simple Model, CC-BY-NC or CC-BY-ND; concept names only), S092 (AnIML concept names).
- Design: `docs/design/simulation_spec.md` section 2.4 and section 5, `docs/design/data_model.md` section 16, `docs/research/README.md` ("Device output formats").
- Related: ADR-0001 (public sources), ADR-0004 (truth and recorded world), ADR-0005 (flags), ADR-0007 (ledgers), ADR-0008 (licence), ADR-0012 (profiles), ADR-0013 (scope extensions).

## Author statement (verbatim, if any)

> "S2에 공개 매뉴얼 기반 장비 출력 어댑터 추가" (chat, 2026-10-29)

> "장비 어댑터 없이 결과를 손으로 옮겨 적는다고 가정...일단 원시적인 방법이니까 그렇게 하고, 자동으로 연계되는 옵션도 해야할듯?" (chat, 2026-10-29)

Taken as (summarised in English by Claude, not verbatim): without an equipment adapter, results are assumed to be copied by hand; that primitive method is the starting point, and an automatically linked option should be offered too.

The author's three cautions in the earlier message, summarised in English by Claude (not verbatim; the author's, not Claude's): (1) use public material only, with no manual text in the repo, only ledger quotes and links; (2) keep origin safety, with vendor-neutral formats or several vendors treated evenly; (3) make no compatibility claim, and call the formats "synthetic formats modeled on public documentation".

## Decider's note

Decided by the author in a guided review on 2026-10-29: chose "수락 (Recommended)".
