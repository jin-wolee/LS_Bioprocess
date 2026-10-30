import { describe, expect, it } from "vitest";
import type { ObservableEvent } from "../../src/observe.ts";
import { record } from "../../src/record/recorder.ts";
import type { Transition } from "../../src/record/transitions.ts";
import type { BreakoutInput, RecordedDataset } from "../../src/record/types.ts";
import { FX12A, FX12A_MASTER, FX12E, FX12E_MASTER, H, equipmentUse, inoculationFrom, mediumAddition } from "../support/breakout_streams.ts";
import { BASE, VALID_QUALIFICATIONS, byTime } from "../support/cell_stream.ts";
import { CONFIGS } from "../support/cells.ts";

// Break-out batch 3, row 3 of spec 11.8.5: the recorder side of the break-out events. FX12a and FX12e are recorded under A, B, C, C without material_lot_links (C-L) and C without
// equipment_links (C-E). Every expected table below is typed by hand from spec 11.8.4 (the fixtures), 11.8.2 rule S7 and data_model 15.6, never read off the recorder.
//   Lot rows and the edges consumed_in and seeded_from exist only with material_lot_links; equipment rows and the edges used_in only with equipment_links. B (equipment_links on, material_lot_links off)
//   therefore stores the equipment edge and not the lot edges. Confirming samples, requests, runs and results, and the deviation, exist in every architecture. Times are seconds (hours times 3600).

const NAMES = { A: "A", B: "B", C: "C", "C-L": "C-material_lot_links", "C-E": "C-equipment_links" } as const;
type Name = keyof typeof NAMES;
const config = (n: Name) => (CONFIGS.find((c) => c.name === NAMES[n]) as (typeof CONFIGS)[number]).config;
const rec = (events: readonly ObservableEvent[], master: BreakoutInput | undefined, n: Name, log?: Transition[]): RecordedDataset =>
  record({ events, sensors: [], qualifications: VALID_QUALIFICATIONS, ...(master && { breakout: master }) }, config(n), log);

const edges = (ds: RecordedDataset) => (ds.lineage_edge ?? []).map((e) => [e.edge_id, e.relation, e.from_kind, e.from_id, e.to_kind, e.to_id, e.occurred_at, e.available_at]);
const lots = (ds: RecordedDataset) => (ds.material_lot ?? []).map((l) => [l.lot_id, l.kind, l.prepared_at, l.state]);

describe("FX12a recorded: lot rows and edges only with material_lot_links (no equipment exists)", () => {
  // U01 consumes SL-1 at inoculation, ML-1 at 1 h (PE1) and ML-2 at 5 h (PE4); U02: SL-2, ML-1 at 1 h (PE2); U03: SL-3, ML-3 at 1 h (PE3). The stop of U01 at 19 h is PE5.
  const SIX = [["SL-1", "seed", 0, "in_use"], ["SL-2", "seed", 0, "in_use"], ["SL-3", "seed", 0, "in_use"], ["ML-1", "medium", 0, "in_use"], ["ML-2", "medium", 0, "in_use"], ["ML-3", "medium", 0, "in_use"]];
  const C_EDGES = [
    ["E1", "seeded_from", "material_lot", "SL-1", "batch", "B-U01", 0, 0], ["E2", "seeded_from", "material_lot", "SL-2", "batch", "B-U02", 0, 0], ["E3", "seeded_from", "material_lot", "SL-3", "batch", "B-U03", 0, 0],
    ["E4", "consumed_in", "material_lot", "ML-1", "process_event", "PE1", 3600, 3600], ["E5", "consumed_in", "material_lot", "ML-1", "process_event", "PE2", 3600, 3600],
    ["E6", "consumed_in", "material_lot", "ML-3", "process_event", "PE3", 3600, 3600], ["E7", "consumed_in", "material_lot", "ML-2", "process_event", "PE4", 18000, 18000],
  ];
  const EXPECT: Record<Name, { lots: unknown[]; edges: unknown[]; seed: (string | null)[]; lot_col: (string | null)[] }> = {
    A: { lots: [], edges: [], seed: [null, null, null], lot_col: [null, null, null, null, null] },
    B: { lots: [], edges: [], seed: [null, null, null], lot_col: [null, null, null, null, null] }, // equipment_links on, but FX12a has no equipment: B equals A
    C: { lots: SIX, edges: C_EDGES, seed: ["SL-1", "SL-2", "SL-3"], lot_col: ["ML-1", "ML-1", "ML-3", "ML-2", null] },
    "C-L": { lots: [], edges: [], seed: [null, null, null], lot_col: [null, null, null, null, null] },
    "C-E": { lots: SIX, edges: C_EDGES, seed: ["SL-1", "SL-2", "SL-3"], lot_col: ["ML-1", "ML-1", "ML-3", "ML-2", null] },
  };
  it.each(Object.keys(NAMES) as Name[])("Given %s When FX12a is recorded Then the lot rows, the edges, batch.seed_lot_id and process_event.lot_id are exactly the typed ones", (n) => {
    const ds = rec(FX12A, FX12A_MASTER, n);
    expect(lots(ds)).toEqual(EXPECT[n].lots);
    expect(edges(ds)).toEqual(EXPECT[n].edges);
    expect(ds.batch.map((b) => b.seed_lot_id)).toEqual(EXPECT[n].seed);
    expect(ds.process_event.map((p) => p.lot_id)).toEqual(EXPECT[n].lot_col);
    expect(ds.process_event.map((p) => p.equipment_id)).toEqual([null, null, null, null, null]);
    expect(ds.process_event.map((p) => [p.event_id, p.kind])).toEqual([["PE1", "medium_addition"], ["PE2", "medium_addition"], ["PE3", "medium_addition"], ["PE4", "medium_addition"], ["PE5", "unit_stopped"]]);
    expect(ds.equipment).toEqual([]);
  });
});

describe("FX12e recorded: equipment rows and used_in edges only with equipment_links; B stores the equipment edge and not the lot edges", () => {
  // U01: SL-1, ML-1 at 1 h (PE1), TL-1 at 5 h (PE4); U02: SL-2, ML-2 at 1 h (PE2), TL-1 at 9 h (PE5); U03: SL-3, ML-3 at 1 h (PE3). The stops of U01 (19 h) and U02 (23 h) are PE6 and PE7.
  const SIX = [["SL-1", "seed", 0, "in_use"], ["SL-2", "seed", 0, "in_use"], ["SL-3", "seed", 0, "in_use"], ["ML-1", "medium", 0, "in_use"], ["ML-2", "medium", 0, "in_use"], ["ML-3", "medium", 0, "in_use"]];
  const LOT_EDGES = [
    ["E1", "seeded_from", "material_lot", "SL-1", "batch", "B-U01", 0, 0], ["E2", "seeded_from", "material_lot", "SL-2", "batch", "B-U02", 0, 0], ["E3", "seeded_from", "material_lot", "SL-3", "batch", "B-U03", 0, 0],
    ["E4", "consumed_in", "material_lot", "ML-1", "process_event", "PE1", 3600, 3600], ["E5", "consumed_in", "material_lot", "ML-2", "process_event", "PE2", 3600, 3600], ["E6", "consumed_in", "material_lot", "ML-3", "process_event", "PE3", 3600, 3600],
  ];
  const used = (first: string, second: string, avail: boolean) => [[first, "used_in", "equipment", "TL-1", "process_event", "PE4", 18000, avail ? 18000 : null], [second, "used_in", "equipment", "TL-1", "process_event", "PE5", 32400, avail ? 32400 : null]];
  const TL = [["TL-1", "Shared transfer line", "in_service"]];
  const stateOf = (ds: RecordedDataset) => (ds.equipment ?? []).map((e) => [e.equipment_id, e.name, e.state]);
  const EXPECT: Record<Name, { lots: unknown[]; equipment: unknown[]; edges: unknown[]; lot_col: (string | null)[]; eq_col: (string | null)[] }> = {
    A: { lots: [], equipment: [], edges: [], lot_col: Array(7).fill(null), eq_col: Array(7).fill(null) },
    B: { lots: [], equipment: TL, edges: used("E1", "E2", false), lot_col: Array(7).fill(null), eq_col: [null, null, null, "TL-1", "TL-1", null, null] },
    C: { lots: SIX, equipment: TL, edges: [...LOT_EDGES, ...used("E7", "E8", true)], lot_col: ["ML-1", "ML-2", "ML-3", null, null, null, null], eq_col: [null, null, null, "TL-1", "TL-1", null, null] },
    "C-L": { lots: [], equipment: TL, edges: used("E1", "E2", true), lot_col: Array(7).fill(null), eq_col: [null, null, null, "TL-1", "TL-1", null, null] },
    "C-E": { lots: SIX, equipment: [], edges: LOT_EDGES, lot_col: ["ML-1", "ML-2", "ML-3", null, null, null, null], eq_col: Array(7).fill(null) },
  };
  it.each(Object.keys(NAMES) as Name[])("Given %s When FX12e is recorded Then the equipment rows, the lot rows, the edges and the lot and equipment columns are exactly the typed ones", (n) => {
    const ds = rec(FX12E, FX12E_MASTER, n);
    expect(lots(ds)).toEqual(EXPECT[n].lots);
    expect(stateOf(ds)).toEqual(EXPECT[n].equipment);
    expect(edges(ds)).toEqual(EXPECT[n].edges);
    expect(ds.process_event.map((p) => p.lot_id)).toEqual(EXPECT[n].lot_col);
    expect(ds.process_event.map((p) => p.equipment_id)).toEqual(EXPECT[n].eq_col);
    expect(ds.process_event.map((p) => p.kind)).toEqual(["medium_addition", "medium_addition", "medium_addition", "equipment_use", "equipment_use", "unit_stopped", "unit_stopped"]);
  });

  it("Then a lot edge exists exactly where material_lot_links is on and an equipment edge exactly where equipment_links is on, in every architecture of the two fixtures", () => {
    for (const n of Object.keys(NAMES) as Name[]) {
      const ds = rec(FX12E, FX12E_MASTER, n);
      const relations = new Set((ds.lineage_edge ?? []).map((e) => e.relation));
      expect(relations.has("consumed_in"), `${n} consumed_in`).toBe(config(n).flags.material_lot_links);
      expect(relations.has("seeded_from"), `${n} seeded_from`).toBe(config(n).flags.material_lot_links);
      expect(relations.has("used_in"), `${n} used_in`).toBe(config(n).flags.equipment_links);
      expect((ds.material_lot ?? []).length > 0, `${n} lots`).toBe(config(n).flags.material_lot_links);
      expect((ds.equipment ?? []).length > 0, `${n} equipment`).toBe(config(n).flags.equipment_links);
    }
  });
});

describe("The deviation and the holds table, in every architecture", () => {
  // DEV-1 is opened at the first signal, 17 h = 61200 s, for the batch B-U01. opened_by is stored with audit_trail (B, C and their ablations) and is then the role that opens it; available_at with its flag
  // (C and its ablations; B has none). The estimated onset, the assumed lag and the closing belong to the investigation (batch 4), so they are null here.
  const row = (n: Name) => {
    const d = (rec(FX12A, FX12A_MASTER, n).deviation ?? [])[0];
    return d && [d.deviation_id, d.batch_id, d.opened_at, d.opened_by, d.trigger, d.state, d.available_at, d.estimated_onset, d.assumed_lag, d.closed_at, d.closed_by];
  };
  it.each([
    ["A", ["DEV-1", "B-U01", 61200, null, "signal", "opened", null, null, null, null, null]],
    ["B", ["DEV-1", "B-U01", 61200, "reviewer", "signal", "opened", null, null, null, null, null]],
    ["C", ["DEV-1", "B-U01", 61200, "reviewer", "signal", "opened", 61200, null, null, null, null]],
    ["C-L", ["DEV-1", "B-U01", 61200, "reviewer", "signal", "opened", 61200, null, null, null, null]],
    ["C-E", ["DEV-1", "B-U01", 61200, "reviewer", "signal", "opened", 61200, null, null, null, null]],
  ] as [Name, unknown[]][])("Given %s When FX12a is recorded Then the one deviation row is the typed one", (n, want) => {
    expect(row(n)).toEqual(want);
    expect(rec(FX12A, FX12A_MASTER, n).deviation).toHaveLength(1);
  });
  it.each(Object.keys(NAMES) as Name[])("Given %s Then the table of holds exists and is empty: the holds are placed by the investigation (batch 4)", (n) => {
    expect(rec(FX12A, FX12A_MASTER, n).quality_hold).toEqual([]);
  });
});

describe("Confirming samples, requests, runs and results, in every architecture", () => {
  // U01-CONF and U02-CONF are drawn at 19 h = 68400 s. Bioburden arrives at 139 h = 500400 s and sterility at 355 h = 1278000 s (A142, A143). U01 reports detected, U02 not_detected (FX12a).
  // The request id is the sample id (data_model 15.6); the two tests are two results of that request, with the test as the analyte; a run per test, visit = the position of the test.
  const samples = (n: Name) => rec(FX12A, FX12A_MASTER, n).sample.filter((s) => s.sample_id.endsWith("-CONF")).map((s) => [s.sample_id, s.unit_id, s.batch_id, s.sampled_at, s.operator_id, s.qualification_id]);
  it.each([
    ["A", [["U01-CONF", "U01", null, null, null, null], ["U02-CONF", "U02", null, null, null, null]]],
    ["B", [["U01-CONF", "U01", null, null, "OP-1", "Q1"], ["U02-CONF", "U02", null, null, "OP-1", "Q1"]]],
    ["C", [["U01-CONF", "U01", "B-U01", 68400, "OP-1", "Q1"], ["U02-CONF", "U02", "B-U02", 68400, "OP-1", "Q1"]]],
  ] as [Name, unknown[]][])("Given %s Then the confirming sample rows carry exactly the columns that architecture stores", (n, want) => {
    expect(samples(n)).toEqual(want);
  });

  it.each(Object.keys(NAMES) as Name[])("Given %s Then the requests are confirmatory for the two samples and routine for every other, and the runs are on the external lab", (n) => {
    const ds = rec(FX12A, FX12A_MASTER, n);
    expect(ds.analysis_request.filter((r) => r.purpose === "confirmatory").map((r) => [r.request_id, r.control_id])).toEqual([["U01-CONF", null], ["U02-CONF", null]]);
    expect(ds.analysis_request.filter((r) => r.purpose === "routine")).toHaveLength(9);
    expect(ds.analysis_request).toHaveLength(11);
    expect(ds.run.filter((r) => r.request_id.endsWith("-CONF")).map((r) => [r.run_id, r.attempt, r.visit, r.analyzer_name, r.instrument_id, r.instrument_state_id, r.started_at, r.ended_at, r.qc_outcome])).toEqual([
      ["U01-CONF/1/1", 1, 1, "external_lab", null, null, 68400, 500400, null], ["U01-CONF/1/2", 1, 2, "external_lab", null, null, 68400, 1278000, null],
      ["U02-CONF/1/1", 1, 1, "external_lab", null, null, 68400, 500400, null], ["U02-CONF/1/2", 1, 2, "external_lab", null, null, 68400, 1278000, null],
    ]);
  });

  // result_id, request, analyte, run, measured_at, outcome, then available_at and ingested_at: stored where a system writes the rows (A none; B, C and the ablations the event stamp), available_at only with its flag
  const results = (n: Name) => rec(FX12A, FX12A_MASTER, n).result.filter((r) => r.request_id.endsWith("-CONF")).map((r) => [r.result_id, r.request_id, r.analyte, r.run_id, r.value, r.measured_at, r.outcome, r.available_at, r.ingested_at, r.state]);
  const rows = (avail: number | null, ingested: number | null) => [
    ["CR1", "U01-CONF", "bioburden", "U01-CONF/1/1", null, 500400, "detected", avail && 500400, ingested && 500400, null],
    ["CR2", "U02-CONF", "bioburden", "U02-CONF/1/1", null, 500400, "not_detected", avail && 500400, ingested && 500400, null],
    ["CR3", "U01-CONF", "sterility", "U01-CONF/1/2", null, 1278000, "detected", avail && 1278000, ingested && 1278000, null],
    ["CR4", "U02-CONF", "sterility", "U02-CONF/1/2", null, 1278000, "not_detected", avail && 1278000, ingested && 1278000, null],
  ];
  it.each([["A", rows(null, null)], ["B", rows(null, 1)], ["C", rows(1, 1)], ["C-L", rows(1, 1)], ["C-E", rows(1, 1)]] as [Name, unknown[]][])("Given %s Then the four confirming results are the typed ones (a null value and an outcome, K18)", (n, want) => {
    expect(results(n)).toEqual(want);
  });

  it("Then K18 holds in every architecture: the outcome is set exactly on the results of confirmatory requests, and the value is null exactly then", () => {
    for (const n of Object.keys(NAMES) as Name[]) {
      const ds = rec(FX12A, FX12A_MASTER, n);
      const confirmatory = new Set(ds.analysis_request.filter((r) => r.purpose === "confirmatory").map((r) => r.request_id));
      expect(ds.result.length).toBe(9 + 4);
      for (const r of ds.result) {
        expect(r.outcome !== null, `${n} ${r.result_id} outcome`).toBe(confirmatory.has(r.request_id));
        expect(r.value === null, `${n} ${r.result_id} value`).toBe(confirmatory.has(r.request_id));
      }
    }
  });
});

describe("A lot used twice by one batch has one consumed_in edge, to the first use (data_model 15.1); the state of a lot never used is available", () => {
  const events = byTime([...BASE, inoculationFrom("U01", "SL-1"), mediumAddition(1, "U01", "ML-1"), mediumAddition(6, "U01", "ML-1"), equipmentUse(7, "U01", "TL-1"), equipmentUse(8, "U01", "TL-1")]);
  const master: BreakoutInput = { lots: [{ lot_id: "SL-1", kind: "seed", prepared_at: 0 }, { lot_id: "ML-1", kind: "medium", prepared_at: 0 }, { lot_id: "ML-9", kind: "medium", prepared_at: H(2) }], equipment: [{ equipment_id: "TL-1", name: "Line" }, { equipment_id: "TL-2", name: "Spare line" }] };
  it("Given ML-1 added at 1 h and 6 h and TL-1 used at 7 h and 8 h Then there is one consumed_in edge (to PE1) and two used_in edges (PE3 and PE4); ML-9 and TL-2 are never used", () => {
    const ds = rec(events, master, "C");
    expect(edges(ds)).toEqual([
      ["E1", "seeded_from", "material_lot", "SL-1", "batch", "B-U01", 0, 0], ["E2", "consumed_in", "material_lot", "ML-1", "process_event", "PE1", 3600, 3600],
      ["E3", "used_in", "equipment", "TL-1", "process_event", "PE3", 25200, 25200], ["E4", "used_in", "equipment", "TL-1", "process_event", "PE4", 28800, 28800],
    ]);
    expect(lots(ds)).toEqual([["SL-1", "seed", 0, "in_use"], ["ML-1", "medium", 0, "in_use"], ["ML-9", "medium", 7200, "available"]]);
    expect((ds.equipment ?? []).map((e) => [e.equipment_id, e.state])).toEqual([["TL-1", "in_service"], ["TL-2", "in_service"]]);
  });
  it("Then a lot row is the typed columns: no quantity, no cell line, no parent lot", () => {
    expect((rec(events, master, "C").material_lot ?? [])[2]).toEqual({ lot_id: "ML-9", kind: "medium", cell_line_id: null, prepared_at: 7200, quantity: null, parent_lot_id: null, state: "available" });
  });
});

describe("The state of a lot goes through the machine of data_model 15.2", () => {
  it("Given FX12a in C When it is recorded with a log Then each of the six consumed lots is prepared -> available by the administrator, then available -> in_use by a rule; nothing else is performed", () => {
    const log: Transition[] = [];
    rec(FX12A, FX12A_MASTER, "C", log);
    const lotLog = log.filter((t) => t.entity === "material_lot");
    expect(lotLog.filter((t) => t.from === "prepared" && t.to === "available" && t.by === "administrator")).toHaveLength(6);
    expect(lotLog.filter((t) => t.from === "available" && t.to === "in_use" && t.by === "rule")).toHaveLength(6);
    expect(lotLog).toHaveLength(12);
    expect(log.filter((t) => t.entity !== "material_lot")).toEqual([]);
  });
  it("Given material_lot_links off Then no lot row exists and no lot transition is performed", () => {
    const log: Transition[] = [];
    rec(FX12A, FX12A_MASTER, "C-L", log);
    expect(log).toEqual([]);
  });
});

describe("With no break-out master data the recorder adds nothing: the arrays and the columns are absent, not null (regression rule d)", () => {
  it.each(Object.keys(NAMES) as Name[])("Given %s and the FX12a stream but no master data Then the dataset has none of the five new tables, and no row has a break-out column", (n) => {
    const ds = rec(FX12A, undefined, n);
    for (const t of ["material_lot", "equipment", "lineage_edge", "deviation", "quality_hold"]) expect(t in ds, `${n} ${t}`).toBe(false);
    for (const b of ds.batch) expect("seed_lot_id" in b).toBe(false);
    for (const p of ds.process_event) expect(["lot_id" in p, "equipment_id" in p]).toEqual([false, false]);
    for (const r of ds.analysis_request) expect("purpose" in r).toBe(false);
    for (const r of ds.result) expect("outcome" in r).toBe(false);
    expect(ds.sample.some((s) => s.sample_id.endsWith("-CONF"))).toBe(false);
    expect(ds.run.some((r) => r.analyzer_name === "external_lab")).toBe(false);
    expect(ds.result.every((r) => r.value !== null)).toBe(true);
  });
});
