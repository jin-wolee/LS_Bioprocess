import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { runLineage } from "../../src/experiments/assembly/lab/lineage.ts";
import type { LineageResult, LineageView } from "../../src/experiments/assembly/lab/lineage.ts";
import type { RunSpec } from "../../src/experiments/assembly/lab/spec.ts";
import { labData } from "../support/lab_data.ts";
import { ROOT } from "../support/paths.ts";
import { SMALL } from "../support/scenarios.ts";

// S3e, the lineage view (docs/design/lab_ui.md section 8). The oracle is the read-only fixture of the single-sample trace (tests/fixtures/trace/single_sample_trace.json, S2d): the lab's view of
// the same sample must give the same three answers and verdicts. Everything else is typed by hand from the fixture's rows (the tables of the three recorders for the sample).

interface Fixture {
  pick: { sample_id: string; unit_id: string; sampled_at: number; context_at_draw: { feed_epoch: number; batch_phase: string } };
  architectures: Record<string, {
    labelling: string;
    answers: Record<string, { answer: unknown; verdict: string }>;
    realised_errors: { type: string; sample_id: string; detail: Record<string, unknown> }[];
    tables: { sample: Record<string, unknown>[]; run: Record<string, unknown>[]; result: Record<string, unknown>[]; process_context: { join_basis: string; join_time: number; feed_epoch: number; batch_phase: string } };
  }>;
}
const fixture = JSON.parse(readFileSync(join(ROOT, "tests", "fixtures", "trace", "single_sample_trace.json"), "utf8")) as Fixture;

const data = labData();
const ARCHS = ["a_manual", "b_lims_lite", "c_context"];
const spec = (architectures = ARCHS): RunSpec => ({ schema_version: "1", scenario: "sc03_feed_in_gap", settings: {}, architectures, seeds: [1] });
const ok = (r: LineageResult): { view: LineageView; sample_ids: string[] } => {
  if (!r.ok) throw new Error(`lineage refused: ${r.message}`);
  return r;
};

// the flags of each preset, in the order of the engine's flag list (ready.flags), typed from the trace table of single_sample_trace.md
const FLAGS_ON: Record<string, string[]> = {
  a_manual: [],
  b_lims_lite: ["system_issued_id", "ingest_idempotency", "audit_trail"],
  c_context: ["system_issued_id", "two_clocks", "available_at", "instrument_state_snapshot", "append_only_versions", "write_time_keys", "ingest_idempotency", "audit_trail"],
};

describe("SC3 lineage, seed 1, the pick rule of S2d", () => {
  let view: LineageView;
  let sampleIds: string[];
  beforeAll(() => {
    const out = ok(runLineage({ data, spec: spec(), seed: 1, pick: { rule: "sc3" } }));
    view = out.view;
    sampleIds = out.sample_ids;
  }, 120_000);

  it("Given the SC3 rule When the view is made Then the sample is the fixture's, picked by the rule, and the truth column holds the unit, the draw instant and the context at the draw", () => {
    expect(view.sample).toEqual({ sample_id: fixture.pick.sample_id, unit_id: fixture.pick.unit_id, picked_by: "sc3_rule" });
    expect(view.truth).toEqual({ unit_id: fixture.pick.unit_id, sampled_at: fixture.pick.sampled_at, context: fixture.pick.context_at_draw });
  });

  it("Then there is one column per architecture in the order asked, with the flags that are on (engine order) and the labelling method", () => {
    expect(view.columns.map((c) => c.architecture)).toEqual(ARCHS);
    for (const c of view.columns) {
      expect(c.flags_on, c.architecture).toEqual(FLAGS_ON[c.architecture]);
      expect(c.labelling, c.architecture).toBe(fixture.architectures[c.architecture]?.labelling);
    }
  });

  it("Then the three answers and their verdicts of A, B and C equal the fixture (unit, sampled_at, process context)", () => {
    for (const c of view.columns) {
      const want = fixture.architectures[c.architecture]?.answers as Fixture["architectures"][string]["answers"];
      expect(c.answers.map((a) => a.question), c.architecture).toEqual(["unit", "sampled_at", "process_context"]);
      for (const a of c.answers) expect({ answer: a.answer, verdict: a.verdict }, `${c.architecture} ${a.question}`).toEqual(want[a.question]);
    }
  });

  it("Then A and B answer 'unanswerable' for the draw instant (the record stores nothing to answer with) and are wrong on the context; C answers all three correctly", () => {
    const verdicts = (arch: string): string[] => (view.columns.find((c) => c.architecture === arch)?.answers ?? []).map((a) => a.verdict);
    expect(verdicts("a_manual")).toEqual(["correct", "unanswerable", "wrong"]);
    expect(verdicts("b_lims_lite")).toEqual(["correct", "unanswerable", "wrong"]);
    expect(verdicts("c_context")).toEqual(["correct", "correct", "correct"]);
  });

  it("Then the errors the injector materialised on the sample, per architecture, equal the fixture's (type and detail)", () => {
    for (const c of view.columns) {
      expect(c.realised_errors, c.architecture).toEqual((fixture.architectures[c.architecture]?.realised_errors ?? []).map(({ type, detail }) => ({ type, detail })));
    }
  });

  it("Then each column draws the sample node with the keys the record stores (the fixture's sample row), a null where the record stores nothing", () => {
    for (const c of view.columns) {
      const row = fixture.architectures[c.architecture]?.tables.sample[0] as Record<string, unknown>;
      const node = c.nodes.find((n) => n.table === "sample");
      expect(node, c.architecture).toBeDefined();
      const field = (name: string): unknown => node?.fields.find((f) => f.name === name)?.value;
      for (const name of ["sample_id", "unit_id", "batch_id", "sampled_at", "planned_at", "operator_id", "container"]) expect(field(name), `${c.architecture} ${name}`).toBe(row[name]);
    }
    const a = view.columns[0]?.nodes.find((n) => n.table === "sample");
    expect(a?.fields.find((f) => f.name === "sampled_at")?.value).toBeNull(); // A stores no sampled_at: the view never guesses a value
  });

  it("Then each column has one result node per result row of the fixture, with its result_id, version, value, measured_at, available_at and state", () => {
    for (const c of view.columns) {
      const rows = fixture.architectures[c.architecture]?.tables.result as Record<string, unknown>[];
      const nodes = c.nodes.filter((n) => n.table === "result");
      expect(nodes.map((n) => n.key), c.architecture).toEqual(rows.map((r) => r.result_id));
      nodes.forEach((n, i) => {
        for (const name of ["result_id", "version", "value", "measured_at", "available_at", "state"]) expect(n.fields.find((f) => f.name === name)?.value, `${c.architecture} ${n.key} ${name}`).toBe((rows[i] as Record<string, unknown>)[name]);
      });
    }
  });

  it("Then the keys join the rows: sample to request to run to results; a run to its instrument state only where the record stores the key, else a stub that ends in a gap", () => {
    for (const c of view.columns) {
      const stored = fixture.architectures[c.architecture]?.tables.run[0]?.instrument_state_id as string | null;
      const run = c.nodes.find((n) => n.table === "run");
      const edge = (from: string, relation: string) => c.edges.filter((e) => e.from === from && e.relation === relation);
      const sample = c.nodes.find((n) => n.table === "sample");
      const request = c.nodes.find((n) => n.table === "analysis_request");
      expect(edge(sample?.id as string, "request_id").map((e) => e.to), c.architecture).toEqual([request?.id]);
      expect(edge(request?.id as string, "request_id").map((e) => e.to), c.architecture).toEqual([run?.id]);
      const results = c.nodes.filter((n) => n.table === "result").map((n) => n.id);
      expect(edge(run?.id as string, "measured_in").map((e) => e.to), c.architecture).toEqual(results);
      const state = c.nodes.find((n) => n.table === "instrument_state");
      if (stored === null) {
        expect(state, c.architecture).toBeUndefined();
        expect(edge(run?.id as string, "instrument_state_id"), c.architecture).toEqual([{ from: run?.id, to: null, relation: "instrument_state_id" }]);
      } else {
        expect(state?.key, c.architecture).toBe(stored);
        expect(edge(run?.id as string, "instrument_state_id").map((e) => e.to), c.architecture).toEqual([state?.id]);
      }
    }
  });

  it("Then the process context is a node joined to the sample by a dashed edge that names the join basis the record used (measured_at in A and B, sampled_at in C)", () => {
    for (const c of view.columns) {
      const want = fixture.architectures[c.architecture]?.tables.process_context as Fixture["architectures"][string]["tables"]["process_context"];
      const ctx = c.nodes.find((n) => n.table === "process_context");
      const fieldsOf = Object.fromEntries((ctx?.fields ?? []).map((f) => [f.name, f.value]));
      expect(fieldsOf, c.architecture).toEqual({ join_basis: want.join_basis, join_time: want.join_time, feed_epoch: want.feed_epoch, batch_phase: want.batch_phase });
      const sample = c.nodes.find((n) => n.table === "sample");
      expect(c.edges.filter((e) => e.relation === "process_context"), c.architecture).toEqual([{ from: sample?.id, to: ctx?.id, relation: "process_context", basis: want.join_basis }]);
    }
  });

  it("Then the view is plain data that holds no hidden truth field (no noise, no true value, no true state)", () => {
    const text = JSON.stringify(view);
    expect(JSON.parse(text)).toEqual(view);
    expect(text).not.toMatch(/"(noise|true_value|true_state|drift_before_pct)"/);
  });

  it("Then the reply lists the samples of the run, so that the reader can pick another one, and the SC3 sample is among them", () => {
    expect(sampleIds.length).toBeGreaterThan(100);
    expect(sampleIds).toContain(fixture.pick.sample_id);
    expect([...sampleIds].sort()).toEqual(sampleIds);
  });
});

describe("The reader's pick and the refusals", () => {
  it("Given the id of the SC3 sample picked by the reader Then the view is the one of the rule, except that it says the reader picked it", () => {
    const byRule = ok(runLineage({ data, spec: spec(["a_manual", "c_context"]), seed: 1, pick: { rule: "sc3" } })).view;
    const byReader = ok(runLineage({ data, spec: spec(["a_manual", "c_context"]), seed: 1, pick: { sample_id: fixture.pick.sample_id } })).view;
    expect(byReader).toEqual({ ...byRule, sample: { ...byRule.sample, picked_by: "reader" } });
  }, 120_000);

  it("Given a sample id the run does not hold Then the request is refused with a message, not answered with an empty column", () => {
    const r = runLineage({ data, spec: spec(["a_manual"]), seed: 1, pick: { sample_id: "U99-D99-9" } });
    expect(r).toEqual({ ok: false, message: expect.stringContaining("U99-D99-9") });
  }, 120_000);

  it("Given the rule on a run in which no sample has a feed between its draw and its run (the small default: the rule is stated for the scenario with a scripted feed in the gap) Then it is refused with the rule's own message, and the engine names no scenario", () => {
    const r = runLineage({ data, spec: { ...spec(["a_manual"]), scenario: "default", settings: SMALL }, seed: 1, pick: { rule: "sc3" } });
    expect(r).toEqual({ ok: false, message: expect.stringMatching(/^no sample of SC3 has a feed in \[sampled_at, run\.started_at\]; pick a sample of this run instead$/) });
  });

  it("Given no architecture Then it is refused", () => {
    const r = runLineage({ data, spec: spec([]), seed: 1, pick: { rule: "sc3" } });
    expect(r.ok).toBe(false);
  });
});
