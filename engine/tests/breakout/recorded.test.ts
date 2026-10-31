import { beforeAll, describe, expect, it } from "vitest";
import type { BreakoutConfig } from "../../src/breakout/config.ts";
import { observeEvents } from "../../src/observe.ts";
import { record } from "../../src/record/recorder.ts";
import type { BreakoutInput, RecordedDataset } from "../../src/record/types.ts";
import { validate } from "../../src/record/validate.ts";
import { CONFIGS } from "../support/cells.ts";
import { H, configOf, docOf, fx12a, fx12e, runOfDoc } from "./support.ts";

// Break-out batch 3, end to end: the stream the engine itself produces for FX12a and FX12e (batch 2) goes through the recorder with the master data of the scenario's own topology, and the
// rows that the hand-typed streams of engine/tests/record/breakout_recorder.test.ts give are the rows the real stream gives. Expected values are the fixture's (spec 11.8.4), in seconds.

const C = (CONFIGS.find((c) => c.name === "C") as (typeof CONFIGS)[number]).config;
const masterOf = (b: BreakoutConfig): BreakoutInput => ({
  lots: b.lots.map((l) => ({ lot_id: l.lot_id, kind: l.kind, prepared_at: l.prepared_s })),
  equipment: b.equipment.map((e) => ({ equipment_id: e.equipment_id, name: e.name })),
});
const recorded = (doc: ReturnType<typeof docOf>): RecordedDataset => {
  const cfg = configOf(doc);
  return record({ events: observeEvents(runOfDoc(doc).events), sensors: [], breakout: masterOf(cfg.breakout as BreakoutConfig) }, C);
};
const edgeTuples = (ds: RecordedDataset, relation: string) => (ds.lineage_edge ?? []).filter((e) => e.relation === relation).map((e) => [e.from_id, e.to_kind, e.to_id, e.occurred_at]);
const confirming = (ds: RecordedDataset) => ds.result.filter((r) => r.outcome != null).map((r) => [r.request_id, r.analyte, r.measured_at, r.outcome]);

describe("FX12a as the engine produces it, recorded under C", () => {
  let ds: RecordedDataset;
  beforeAll(() => {
    ds = recorded(docOf(fx12a()));
  });

  it("Given the topology of FX12a Then six lots are recorded, all in use, and the edges are the three seed edges and the four medium edges at the times of the fixture", () => {
    expect((ds.material_lot ?? []).map((l) => [l.lot_id, l.kind, l.prepared_at, l.state])).toEqual([
      ["SL-1", "seed", 0, "in_use"], ["SL-2", "seed", 0, "in_use"], ["SL-3", "seed", 0, "in_use"], ["ML-1", "medium", 0, "in_use"], ["ML-2", "medium", 0, "in_use"], ["ML-3", "medium", 0, "in_use"],
    ]);
    expect(edgeTuples(ds, "seeded_from")).toEqual([["SL-1", "batch", "B-U01", 0], ["SL-2", "batch", "B-U02", 0], ["SL-3", "batch", "B-U03", 0]]);
    const consumed = edgeTuples(ds, "consumed_in");
    expect(consumed.map((e) => [e[0], e[3]])).toEqual([["ML-1", H(1)], ["ML-1", H(1)], ["ML-3", H(1)], ["ML-2", H(5)]]);
    expect(consumed.every((e) => e[1] === "process_event")).toBe(true);
    expect(ds.batch.map((b) => b.seed_lot_id)).toEqual(["SL-1", "SL-2", "SL-3"]);
    expect(ds.equipment).toEqual([]);
  });

  it("Then the stop of U01 is a process event at 19 h, the deviation DEV-1 is opened at 17 h for B-U01, and no hold exists", () => {
    expect(ds.process_event.filter((p) => p.kind === "unit_stopped").map((p) => [p.unit_id, p.occurred_at, p.source])).toEqual([["U01", H(19), "scripted"]]);
    expect((ds.deviation ?? []).map((d) => [d.deviation_id, d.batch_id, d.opened_at, d.trigger, d.state])).toEqual([["DEV-1", "B-U01", H(17), "signal", "opened"]]);
    expect(ds.quality_hold).toEqual([]);
  });

  it("Then the confirming samples are drawn at 19 h and the four results arrive at 139 h and 355 h: U01 detected, U02 not detected", () => {
    expect(ds.sample.filter((s) => s.sample_id.endsWith("-CONF")).map((s) => [s.sample_id, s.sampled_at])).toEqual([["U01-CONF", H(19)], ["U02-CONF", H(19)]]);
    expect(confirming(ds)).toEqual([
      ["U01-CONF", "bioburden", H(139), "detected"], ["U02-CONF", "bioburden", H(139), "not_detected"], ["U01-CONF", "sterility", H(355), "detected"], ["U02-CONF", "sterility", H(355), "not_detected"],
    ]);
    expect(ds.run.filter((r) => r.request_id.endsWith("-CONF") && r.ended_at === null)).toEqual([]);
  });

  it("Then VR-021 is silent on the generated record, and no finding concerns a confirming row", () => {
    const v = validate(ds, { hold_limit_s: 86400 });
    expect(v.dataset.validation_finding.filter((f) => f.rule === "VR-021")).toEqual([]);
    expect(v.dataset.validation_finding.filter((f) => f.target.includes("-CONF"))).toEqual([]);
  });
});

describe("FX12e as the engine produces it, recorded under C", () => {
  let ds: RecordedDataset;
  beforeAll(() => {
    ds = recorded(docOf(fx12e()));
  });

  it("Then the transfer line is recorded once, used at 5 h and 9 h, and each use has its used_in edge to its own process event", () => {
    expect((ds.equipment ?? []).map((e) => [e.equipment_id, e.name, e.state])).toEqual([["TL-1", "Shared transfer line", "in_service"]]);
    expect(edgeTuples(ds, "used_in").map((e) => [e[0], e[3]])).toEqual([["TL-1", H(5)], ["TL-1", H(9)]]);
    const uses = ds.process_event.filter((p) => p.kind === "equipment_use");
    expect(uses.map((p) => [p.unit_id, p.occurred_at, p.equipment_id])).toEqual([["U01", H(5), "TL-1"], ["U02", H(9), "TL-1"]]);
    expect(edgeTuples(ds, "used_in").map((e) => e[2])).toEqual(uses.map((p) => p.event_id));
  });

  it("Then both units are stopped, U01 at 19 h and U02 at 23 h, and both are confirmed detected, U02 also by the sample of its own signal (F8)", () => {
    expect(ds.process_event.filter((p) => p.kind === "unit_stopped").map((p) => [p.unit_id, p.occurred_at])).toEqual([["U01", H(19)], ["U02", H(23)]]);
    expect(confirming(ds).map((r) => [r[0], r[3]])).toEqual([
      ["U01-CONF", "detected"], ["U02-CONF", "detected"], ["U02-SIG-CONF", "detected"], ["U01-CONF", "detected"], ["U02-CONF", "detected"], ["U02-SIG-CONF", "detected"],
    ]);
    expect((ds.deviation ?? []).length).toBe(1);
    expect(validate(ds, { hold_limit_s: 86400 }).dataset.validation_finding.filter((f) => f.rule === "VR-021")).toEqual([]);
  });
});
