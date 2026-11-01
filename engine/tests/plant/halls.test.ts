import { beforeAll, describe, expect, it } from "vitest";
import { observeEvents } from "../../src/observe.ts";
import { runSeed } from "../../src/experiments/assembly/run_seed.ts";
import { plannedIds } from "../../src/experiments/assembly/lab/plant_plan.ts";
import { recordsOf } from "../../src/experiments/assembly/lab/plant_records.ts";
import type { PlanRecord } from "../../src/experiments/assembly/lab/plant_records.ts";
import { sampleRecordOf } from "../../src/experiments/assembly/lab/lineage.ts";
import { recordContext } from "../../src/experiments/assembly/lab/questions.ts";
import { architecturesNamed, labSeed } from "../../src/experiments/assembly/lab/seed_setup.ts";
import type { RunSpec } from "../../src/experiments/assembly/lab/spec.ts";
import type { RecordedDataset } from "../../src/record/types.ts";
import { labData } from "../support/lab_data.ts";

// P5a (docs/design/plant_ui.md sections 3.3 and 4.1): the cards of the record halls against the recorded datasets they are made from, on the whole default run (seed 1: 394 planned samples, 21
// days, A, B and C). The first group is the truth boundary of a hall: a slot is stored exactly when the architecture's own dataset stores the field for the sample, read here by functions that the
// plan does not use (the rows of the dataset, `recordContext` of the lineage view and the nodes of `sampleRecordOf`), and a hall holds no card for a sample its architecture holds no row of. The
// second group is the two instants that the plan lacks without P5a, typed by hand from the observable events of two samples of the run:
//   U07-D06-1 is drawn at 547200 s; its first run starts at 549000 s, fails QC and its results are written at 549270 s; the rerun starts at 549540 s and its results are written at 549810 s.
//   U01-D06-1 is drawn at 547200 s, runs once from 549270 s and its results are written at 549540 s.
// In C every result of both samples is stored (ingested_at = measured_at) in state `rejected`, so no result is offered and the lineage view holds no process-context node for either sample.

const data = labData();
const HALLS = ["a_manual", "b_lims_lite", "c_context"];

let ids: string[];
let datasets: Record<string, RecordedDataset>;
let records: PlanRecord[];

beforeAll(() => {
  const spec: RunSpec = { schema_version: "1", scenario: "default", settings: {}, architectures: HALLS, seeds: [1] };
  const { run, input } = labSeed(data, spec, 1, architecturesNamed(data, HALLS));
  datasets = runSeed(input).datasets;
  ids = plannedIds(observeEvents(run.events));
  records = recordsOf(HALLS.map((h) => datasets[h] as RecordedDataset), ids);
}, 120_000);

const hall = (architecture: string): PlanRecord => records.find((r) => r.architecture === architecture) as PlanRecord;
const cardOf = (architecture: string, id: string) => hall(architecture).cards.find((c) => c.sample === ids.indexOf(id));
const dataset = (architecture: string): RecordedDataset => datasets[architecture] as RecordedDataset;

describe("The slots of every card against the dataset of its architecture (the truth boundary of a hall)", () => {
  it.each(HALLS)("Given every card of %s Then each slot is stored exactly when the dataset stores the field for the sample, and a context slot carries the join basis of the lineage view", (architecture) => {
    const ds = dataset(architecture);
    expect(hall(architecture).cards.length).toBeGreaterThan(300);
    for (const card of hall(architecture).cards) {
      const id = ids[card.sample] as string;
      const rows = ds.sample.filter((s) => s.sample_id === id);
      const context = recordContext(ds, id);
      const lineage = sampleRecordOf(ds, id);
      const slot = (name: string) => card.slots.find((s) => s.name === name);
      expect(card.slots.map((s) => s.name), id).toEqual(["unit", "sampled_at", "context", "value"]);
      expect(slot("unit")?.stored, `${architecture} ${id} unit`).toBe(rows.length > 0);
      expect(slot("sampled_at")?.stored, `${architecture} ${id} sampled_at`).toBe(rows.some((s) => s.sampled_at !== null));
      expect(slot("context")?.stored, `${architecture} ${id} context`).toBe(context !== null);
      expect(slot("context")?.basis, `${architecture} ${id} basis`).toBe(context?.join_basis);
      expect(slot("value")?.stored, `${architecture} ${id} value`).toBe(ds.result.some((r) => r.request_id === id && r.value !== null));
      // the record panel reads the same sample through the lineage view: its nodes say the same
      expect(lineage.nodes.some((n) => n.table === "process_context"), `${architecture} ${id} node`).toBe(slot("context")?.stored);
      expect(lineage.nodes.some((n) => n.table === "result" && n.fields.some((f) => f.name === "value" && f.value !== null)), `${architecture} ${id} value node`).toBe(slot("value")?.stored);
    }
  });

  it("Given sample U01-D06-1 in C, all of whose results are rejected and so not offered by the record Then the context slot is not stored, as the lineage view holds no process-context node for it", () => {
    expect(recordContext(dataset("c_context"), "U01-D06-1")).toBeNull();
    expect(cardOf("c_context", "U01-D06-1")?.slots).toEqual([{ name: "unit", stored: true }, { name: "sampled_at", stored: true }, { name: "context", stored: false }, { name: "value", stored: true }]);
  });

  it("Given 8 cards of C whose results are all rejected Then exactly those 8 have no knowable instant and no context", () => {
    const cards = hall("c_context").cards;
    const none = cards.filter((c) => c.available_s === null);
    expect(none).toHaveLength(8);
    expect(none.every((c) => c.slots.find((s) => s.name === "context")?.stored === false)).toBe(true);
    expect(cards.filter((c) => c.slots.find((s) => s.name === "context")?.stored === false)).toHaveLength(8);
  });
});

describe("A hall holds no card for a sample its architecture holds no row of (absence is not drawn)", () => {
  it.each(HALLS)("Given %s Then a sample has a card exactly when the dataset holds a run or a result row of it", (architecture) => {
    const ds = dataset(architecture);
    const has = (id: string): boolean => ds.run.some((r) => r.request_id === id) || ds.result.some((r) => r.request_id === id);
    const carded = new Set(hall(architecture).cards.map((c) => ids[c.sample]));
    for (const id of ids) expect(carded.has(id), `${architecture} ${id}`).toBe(has(id));
  });

  it("Given A, which holds no analysis request for three of the planned samples Then it has 391 cards for 394 samples and none of the three has a card", () => {
    const ds = dataset("a_manual");
    const lacking = ["U06-D09-1", "U13-D03-2", "U18-D03-1"];
    expect(hall("a_manual").cards).toHaveLength(391);
    expect(hall("b_lims_lite").cards).toHaveLength(394);
    expect(hall("c_context").cards).toHaveLength(394);
    for (const id of lacking) {
      expect(ds.analysis_request.some((r) => r.request_id === id), id).toBe(false);
      expect(cardOf("a_manual", id), id).toBeUndefined();
    }
  });
});

describe("The instants a card needs besides its first (version_s, and the instant each finding was raised)", () => {
  it("Given U07-D06-1 in C, a rerun after a failed QC run Then two versions were written, at 549270 s and 549810 s, and the two findings were raised on the rows they concern", () => {
    expect(cardOf("c_context", "U07-D06-1")).toEqual({
      sample: ids.indexOf("U07-D06-1"), shown_s: 549000, available_s: null,
      slots: [{ name: "unit", stored: true }, { name: "sampled_at", stored: true }, { name: "context", stored: false }, { name: "value", stored: true }],
      findings: [{ rule: "VR-010", raised_s: 549810 }, { rule: "VR-012", raised_s: 549270 }],
      version_s: [549270, 549810],
    });
  });

  it("Given U01-D06-1 in C Then one version at 549540 s and one finding raised on it", () => {
    expect(cardOf("c_context", "U01-D06-1")).toMatchObject({ shown_s: 549270, findings: [{ rule: "VR-010", raised_s: 549540 }], version_s: [549540] });
  });

  it("Given a sample in A and in B, which overwrite or keep one row Then one version, at the instant the result was measured (A) or written (B)", () => {
    // A has no system that writes the rows (ingested_at is null), so the stamp is measured_at; B writes at the measured instant (S2a models no ingestion delay)
    const a = cardOf("a_manual", "U01-D06-1");
    expect(a?.version_s).toEqual([549540]);
    expect(cardOf("b_lims_lite", "U01-D06-1")?.version_s).toEqual([549540]);
  });

  it("Given every card of every hall Then version_s is sorted, never earlier than shown_s, and a pennant is raised no earlier than its card is shown", () => {
    for (const r of records) {
      for (const c of r.cards) {
        expect([...c.version_s].sort((x, y) => x - y), `${r.architecture} ${c.sample}`).toEqual(c.version_s);
        expect(c.version_s.every((s) => s >= c.shown_s), `${r.architecture} ${c.sample} versions`).toBe(true);
        expect(c.findings.every((f) => f.raised_s >= c.shown_s), `${r.architecture} ${c.sample} findings`).toBe(true);
        expect(c.findings.map((f) => f.rule), `${r.architecture} ${c.sample} rules`).toEqual([...new Set(c.findings.map((f) => f.rule))].sort());
        expect(c.available_s === null || c.available_s >= c.shown_s).toBe(true);
      }
    }
  });

  it("Given the cards of A and B Then none stacks a version and none carries a finding in this run; C stacks 4 cards and 10 cards carry a finding", () => {
    expect(hall("a_manual").cards.filter((c) => c.version_s.length > 1)).toHaveLength(0);
    expect(hall("b_lims_lite").cards.filter((c) => c.version_s.length > 1)).toHaveLength(0);
    expect(hall("c_context").cards.filter((c) => c.version_s.length > 1)).toHaveLength(4);
    expect(hall("c_context").cards.filter((c) => c.findings.length > 0)).toHaveLength(10);
    expect(hall("a_manual").cards.filter((c) => c.findings.length > 0)).toHaveLength(0);
  });
});
