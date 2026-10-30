import { describe, expect, it } from "vitest";
import { evaluate } from "../../src/evaluate/evaluate.ts";
import { runSeed } from "../../src/experiments/assembly/run_seed.ts";
import type { ObservableEvent } from "../../src/observe.ts";
import { record } from "../../src/record/recorder.ts";
import { review } from "../../src/record/review.ts";
import type { AnalysisRequestRow, BreakoutInput, RecordedDataset, ResultRow, RunRow, SampleRow } from "../../src/record/types.ts";
import { RULE_IDS, validate } from "../../src/record/validate.ts";
import type { RuleConfig } from "../../src/record/validate.ts";
import { FX12A, FX12A_MASTER, FX12E, FX12E_MASTER, equipmentUse, inoculationFrom, mediumAddition } from "../support/breakout_streams.ts";
import { BASE, VALID_QUALIFICATIONS, byTime } from "../support/cell_stream.ts";
import { CONFIGS } from "../support/cells.ts";
import { A, B, C, CONFIG, QUALIFICATIONS, RULES, WORLD, WORLD_EVENTS, emptyDataset, seedInput } from "../support/eval_fixture.ts";
import { SENSORS, STREAM } from "../support/record_fixture.ts";
import { REVIEW } from "../support/review_setup.ts";

// Break-out batch 3, row 3 of spec 11.8.5: VR-021 and the purpose filters. Expected findings are typed by hand from data_model 15.5 (VR-021) and 15.6 (rulings for S3), and from spec 11.8.2 rule S10
// ("Confirming samples are not routine requests: VR-009, VR-010, VR-020 and the section 8 metrics filter on purpose and count routine requests only").

const NAMES = { A: "A", B: "B", C: "C", "C-L": "C-material_lot_links", "C-E": "C-equipment_links" } as const;
type Name = keyof typeof NAMES;
const ALL = Object.keys(NAMES) as Name[];
const config = (n: Name) => (CONFIGS.find((c) => c.name === NAMES[n]) as (typeof CONFIGS)[number]).config;
const rec = (events: readonly ObservableEvent[], master: BreakoutInput, n: Name): RecordedDataset => record({ events, sensors: [], qualifications: VALID_QUALIFICATIONS, breakout: master }, config(n));
/** Test-only limits: the hold of a routine sample in the fixtures is 3300 s, under the limit, so no rule of the catalogue fires on a generated stream. */
const CFG: RuleConfig = { hold_limit_s: 3600, late_tolerance_s: 600, clock_tolerance_s: 900 };
const lotFindings = (ds: RecordedDataset) => validate(ds, CFG).dataset.validation_finding.filter((f) => f.rule === "VR-021").map((f) => [f.target, f.severity, f.action, f.status]);
const dropped = (ds: RecordedDataset, edge_id: string): RecordedDataset => ({ ...ds, lineage_edge: (ds.lineage_edge ?? []).filter((e) => e.edge_id !== edge_id) });
const HOLD = (target: string) => [target, "warning", "hold", "open"];

describe("No rule of the catalogue fires on a generated break-out record, in any architecture (the fixtures release a sample one hour after its draw)", () => {
  it.each(ALL)("Given %s and FX12a and FX12e as generated Then no finding is raised, no result leaves its null state, and the confirming rows are untouched", (n) => {
    for (const [events, master] of [[FX12A, FX12A_MASTER], [FX12E, FX12E_MASTER]] as const) {
      const v = validate(rec(events, master, n), CFG);
      expect(v.dataset.validation_finding, n).toEqual([]);
      expect(v.dataset.result.every((r) => r.state === null), n).toBe(true);
    }
  });
});

describe("VR-021 is silent on a generated record: the edge is always written", () => {
  it.each(ALL)("Given %s and FX12a and FX12e as generated Then VR-021 raises no finding", (n) => {
    expect(lotFindings(rec(FX12A, FX12A_MASTER, n))).toEqual([]);
    expect(lotFindings(rec(FX12E, FX12E_MASTER, n))).toEqual([]);
  });
  it("Given a lot used twice by one batch, which has one consumed_in edge to the first use Then VR-021 is silent on the second use", () => {
    const twice = byTime([...BASE, inoculationFrom("U01", "SL-1"), mediumAddition(1, "U01", "ML-1"), mediumAddition(6, "U01", "ML-1"), equipmentUse(7, "U01", "TL-1"), equipmentUse(8, "U01", "TL-1")]);
    const master: BreakoutInput = { lots: [{ lot_id: "SL-1", kind: "seed", prepared_at: 0 }, { lot_id: "ML-1", kind: "medium", prepared_at: 0 }], equipment: [{ equipment_id: "TL-1", name: "Line" }] };
    expect(lotFindings(rec(twice, master, "C"))).toEqual([]);
  });
});

describe("VR-021 fires on a hand-built dataset with one edge dropped (a bad-data fixture, data_model section 13): one finding each for a lot, the seed and an equipment item", () => {
  it("Given the consumed_in edge of ML-2 (E7, used by U01 at 5 h in PE4) is dropped from C's FX12a Then the one finding is on process_event:PE4", () => {
    expect(lotFindings(dropped(rec(FX12A, FX12A_MASTER, "C"), "E7"))).toEqual([HOLD("process_event:PE4")]);
  });
  it("Given the seeded_from edge of SL-2 (E2) is dropped from C's FX12a Then the one finding is on batch:B-U02, whose batch.seed_lot_id names SL-2", () => {
    const ds = dropped(rec(FX12A, FX12A_MASTER, "C"), "E2");
    expect(ds.batch.find((b) => b.batch_id === "B-U02")?.seed_lot_id).toBe("SL-2");
    expect(lotFindings(ds)).toEqual([HOLD("batch:B-U02")]);
  });
  it("Given the used_in edge of TL-1 for U02 at 9 h (E8, PE5) is dropped from C's FX12e Then the one finding is on process_event:PE5", () => {
    expect(lotFindings(dropped(rec(FX12E, FX12E_MASTER, "C"), "E8"))).toEqual([HOLD("process_event:PE5")]);
  });
  it("Given the same edge is dropped from B (equipment_links on, material_lot_links off) and from C-L Then the finding is the same, since the equipment check needs equipment_links only", () => {
    expect(lotFindings(dropped(rec(FX12E, FX12E_MASTER, "B"), "E2"))).toEqual([HOLD("process_event:PE5")]);
    expect(lotFindings(dropped(rec(FX12E, FX12E_MASTER, "C-L"), "E2"))).toEqual([HOLD("process_event:PE5")]);
  });
  it("Given the consumed_in edge of ML-1 (E4, PE1) is dropped from C-E (material_lot_links on, equipment_links off) Then the finding is on process_event:PE1", () => {
    expect(lotFindings(dropped(rec(FX12E, FX12E_MASTER, "C-E"), "E4"))).toEqual([HOLD("process_event:PE1")]);
  });
  it("Given both a lot edge and an equipment edge are dropped Then there are two findings, one each, and no row changes state (the rule writes a finding on a process_event or a batch)", () => {
    const ds = dropped(dropped(rec(FX12E, FX12E_MASTER, "C"), "E4"), "E7");
    expect(lotFindings(ds)).toEqual([HOLD("process_event:PE1"), HOLD("process_event:PE4")]);
    expect(validate(ds, CFG).dataset.result).toEqual(validate(rec(FX12E, FX12E_MASTER, "C"), CFG).dataset.result);
  });
});

describe("VR-021 reads a flag only for the edge that flag stores", () => {
  it("Given a lot or an equipment item named in a row whose flag is off (free text, nothing to compare) Then VR-021 is silent", () => {
    const noEquipmentFlag = rec(FX12E, FX12E_MASTER, "C-E");
    const named = { ...noEquipmentFlag, process_event: noEquipmentFlag.process_event.map((p) => (p.kind === "equipment_use" ? { ...p, equipment_id: "TL-1" } : p)) };
    expect(lotFindings(named)).toEqual([]);
    const noLotFlag = rec(FX12E, FX12E_MASTER, "C-L");
    const lotNamed = { ...noLotFlag, process_event: noLotFlag.process_event.map((p) => (p.kind === "medium_addition" ? { ...p, lot_id: "ML-1" } : p)), batch: noLotFlag.batch.map((b) => ({ ...b, seed_lot_id: "SL-1" })) };
    expect(lotFindings(lotNamed)).toEqual([]);
  });
  it("Given A (neither flag) Then VR-021 is not evaluable and the reason names both flags; given B, C and the ablations it is evaluable", () => {
    const reasons = (n: Name) => validate(rec(FX12A, FX12A_MASTER, n), CFG).not_evaluable.filter((x) => x.rule === "VR-021").map((x) => x.reason);
    expect(reasons("A")).toHaveLength(1);
    expect(reasons("A")[0]).toMatch(/material_lot_links/);
    expect(reasons("A")[0]).toMatch(/equipment_links/);
    for (const n of ["B", "C", "C-L", "C-E"] as Name[]) expect(reasons(n), n).toEqual([]);
  });
  it("Given no break-out master data Then VR-021 is not in the catalogue of the dataset: not listed as not evaluable, and RULE_IDS is the earlier twelve", () => {
    const plain = record({ events: STREAM, sensors: SENSORS }, config("A"));
    expect(validate(plain, CFG).not_evaluable.map((x) => x.rule)).not.toContain("VR-021");
    expect(RULE_IDS).toEqual(["VR-002", "VR-003", "VR-004", "VR-008b", "VR-009", "VR-010", "VR-011", "VR-012", "VR-014", "VR-015", "VR-019", "VR-020"]);
  });
});

// ---- confirming rows stay out of VR-009, VR-010 and VR-020 (and VR-011, which an external-lab run would trip) ---------------------------------------------------------------------------
// The same rows typed twice, once as a routine request and once as a confirming one. The routine copy must fire (so the fixture is a real trap), the confirming copy must not.

type Purpose = "routine" | "confirmatory";
const sampleRow = (sample_id: string, sampled_at: number): SampleRow => ({
  sample_id, unit_id: "U1", batch_id: "B-U1", keys_fixed_at_write: true, state: null, sampled_at, planned_at: null, operator_id: null, qualification_id: null, label_method: null, container: null,
});
const requestRow = (request_id: string, purpose: Purpose): AnalysisRequestRow => ({ request_id, control_id: null, purpose });
const runRow = (request_id: string, purpose: Purpose, started_at: number): RunRow => ({
  run_id: `${request_id}/1/1`, request_id, attempt: 1, visit: 1, analyzer_name: purpose === "routine" ? "AN-1" : "external_lab", instrument_id: null, instrument_state_id: null, started_at, ended_at: started_at + 300, qc_outcome: null,
});
const resultRow = (request_id: string, purpose: Purpose, measured_at: number): ResultRow => ({
  result_id: `R-${request_id}`, request_id, analyte: purpose === "routine" ? "glucose" : "bioburden", version: 1, run_id: `${request_id}/1/1`, value: purpose === "routine" ? 5 : null, measured_at, available_at: null,
  supersedes: null, ingested_at: null, reviewed_at: null, state: null, outcome: purpose === "routine" ? null : "detected",
});
/** A dataset of the given flags with one sample per id: drawn at `drawn[id]`, its run started at `start`. */
const world = (flags: Parameters<typeof emptyDataset>[0], purpose: Purpose, drawn: Record<string, number>, start: number, batch: { harvested_at: number | null } = { harvested_at: null }): RecordedDataset => ({
  ...emptyDataset(flags),
  sample: Object.entries(drawn).map(([id, t]) => sampleRow(id, t)),
  analysis_request: Object.keys(drawn).map((id) => requestRow(id, purpose)),
  run: Object.keys(drawn).map((id) => runRow(id, purpose, start)),
  result: Object.keys(drawn).map((id) => resultRow(id, purpose, start + 300)),
  batch: [{ batch_id: "B-U1", unit_id: "U1", inoculated_at: 0, harvested_at: batch.harvested_at, seed_lot_id: null }],
});
const hits = (ds: RecordedDataset, rule: string) => validate(ds, CFG).dataset.validation_finding.filter((f) => f.rule === rule).map((f) => f.target).sort();

describe("Confirming rows enter no VR-009, VR-010, VR-011 and VR-020", () => {
  it.each([["routine", ["result:R-X1", "result:R-X2"]], ["confirmatory", []]] as [Purpose, string[]][])(
    "Given two %s samples of one unit with the same sampled_at and test or analyte but different ids When VR-009 runs Then it flags %j", (purpose, want) => {
      expect(hits(world({ two_clocks: true }, purpose, { X1: 1000, X2: 1000 }, 1500), "VR-009")).toEqual(want);
    });
  it.each([["routine", ["result:R-X1"]], ["confirmatory", []]] as [Purpose, string[]][])(
    "Given a %s sample whose run started 5000 s after the draw (limit 1800) When VR-010 runs Then it flags %j", (purpose, want) => {
      expect(hits(world({ two_clocks: true }, purpose, { X1: 1000 }, 6000), "VR-010")).toEqual(want);
    });
  it.each([["routine", ["result:R-X1"]], ["confirmatory", []]] as [Purpose, string[]][])(
    "Given a %s run with no instrument-state link while the snapshot is on When VR-011 runs Then it flags %j (an external-lab run has no instrument state to miss)", (purpose, want) => {
      expect(hits(world({ instrument_state_snapshot: true }, purpose, { X1: 1000 }, 1500), "VR-011")).toEqual(want);
    });
  it.each([["routine", ["sample:X1"]], ["confirmatory", []]] as [Purpose, string[]][])(
    "Given a %s sample drawn at 5000 on a unit whose batch was harvested at 3000 When VR-020 runs Then it flags %j", (purpose, want) => {
      expect(hits(world({ two_clocks: true }, purpose, { X1: 5000 }, 5500, { harvested_at: 3000 }), "VR-020")).toEqual(want);
    });
  it("Given a confirming sample and a routine sample with the same sampled_at Then the pair does not trigger VR-009 on either (only requests of one purpose are compared)", () => {
    const ds = world({ two_clocks: true }, "routine", { X1: 1000 }, 1500);
    const mixed: RecordedDataset = {
      ...ds,
      sample: [...ds.sample, sampleRow("X2", 1000)], analysis_request: [...ds.analysis_request, requestRow("X2", "confirmatory")],
      run: [...ds.run, runRow("X2", "confirmatory", 1500)], result: [...ds.result, { ...resultRow("X2", "confirmatory", 1800), analyte: "glucose" }],
    };
    expect(hits(mixed, "VR-009")).toEqual([]);
  });
});

describe("Confirming rows enter no section 8 metric", () => {
  // The hand world of the evaluator tests plus a hostile confirming sample: U1-CONF is drawn at 1100, the instant S1 is drawn, and its test carries the name of a routine analyte. Unfiltered, VR-009 would
  // flag S1 as a possible double label and the label-error detection would change. The truth is the hand world's own: confirming draws are not routine requests.
  const HOSTILE: ObservableEvent[] = [
    { type: "confirm_sample_drawn", t: 1100, sample_id: "U1-CONF", unit_id: "U1", batch_id: "B-U1", operator_id: "OP-1", volume_ul: 2000, tests: [{ aliquot_id: "U1-CONF-A1", test: "glucose", volume_ul: 2000 }] },
    { type: "confirm_result", t: 30000, sample_id: "U1-CONF", aliquot_id: "U1-CONF-A1", test: "glucose", outcome: "detected" },
  ];
  const archs = [A, B, C];
  const { key_text } = runSeed(seedInput({ architectures: archs }));
  const cell = (events: readonly ObservableEvent[], master: BreakoutInput | undefined, arch: (typeof archs)[number]) => {
    const recorded = record({ events, sensors: SENSORS, qualifications: QUALIFICATIONS, ...(master && { breakout: master }) }, arch);
    const validated = validate(recorded, RULES);
    const dataset = review(validated.dataset, REVIEW);
    return { dataset, metrics: evaluate({ truth: WORLD, dataset, not_evaluable: validated.not_evaluable, key_text, architecture: arch.id, config: CONFIG }) };
  };
  // Both cells are recorded with the same (empty) break-out master data, so the only difference is the confirming sample. A dataset with the extension lists VR-021 among the rules it could not run
  // (A, which stores neither edge) and a dataset without does not: that is the block's doing and not the confirming row's, and is asserted on its own below.
  const MASTER: BreakoutInput = { lots: [], equipment: [] };
  it.each(archs.map((a) => [a.id, a] as const))("Given %s When the hostile confirming sample is recorded and evaluated Then it is in the dataset and every metric equals the metrics without it", (_id, arch) => {
    const base = cell(WORLD_EVENTS, MASTER, arch);
    const withConfirming = cell([...WORLD_EVENTS, ...HOSTILE], MASTER, arch);
    expect(withConfirming.dataset.result.filter((r) => r.request_id === "U1-CONF").map((r) => [r.analyte, r.value, r.outcome])).toEqual([["glucose", null, "detected"]]);
    expect(withConfirming.dataset.sample.some((s) => s.sample_id === "U1-CONF")).toBe(true);
    expect(withConfirming.metrics).toEqual(base.metrics);
    expect(withConfirming.dataset.validation_finding.filter((f) => f.target.includes("U1-CONF"))).toEqual([]);
  });
  it("Given the hand world with no break-out master data Then the metrics differ from those with the master data in one place only: the rules the detection could not run, which gain VR-021 where neither flag is on", () => {
    for (const arch of archs) {
      const plain = cell(WORLD_EVENTS, undefined, arch).metrics;
      const block = cell(WORLD_EVENTS, MASTER, arch).metrics;
      const extra = block.metrics.detection.not_evaluable.filter((n) => !plain.metrics.detection.not_evaluable.some((p) => p.rule === n.rule)).map((n) => n.rule);
      expect(extra, arch.id).toEqual(arch.flags.material_lot_links || arch.flags.equipment_links ? [] : ["VR-021"]);
      expect({ ...block, metrics: { ...block.metrics, detection: { ...block.metrics.detection, not_evaluable: plain.metrics.detection.not_evaluable } } }, arch.id).toEqual(plain);
    }
  });
});
