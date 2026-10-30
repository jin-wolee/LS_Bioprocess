import type { MaterialisedError } from "../../../inject/types.ts";
import { FLAG_NAMES } from "../../../record/architecture.ts";
import type { RecordedDataset } from "../../../record/types.ts";
import { requestOfTarget } from "../../../record/validate.ts";
import { runSeed } from "../run_seed.ts";
import { drawnSampleIds, pickSample, sampleTruth } from "./pick.ts";
import { askQuestions, recordContext } from "./questions.ts";
import type { SampleTruth, Verdict } from "./questions.ts";
import { architecturesNamed, labSeed, materialisedOf } from "./seed_setup.ts";
import type { LabData } from "./setup.ts";
import type { RunSpec } from "./spec.ts";

// 2026-10-30 S3e, the lineage view (docs/design/lab_ui.md section 8): one physical sample, one column per chosen record. Each column holds the rows the record stores for the sample as nodes and the
// keys that join them as edges, the analyst's three questions with their verdicts, and the errors the injector realised on the sample in that architecture. Nothing is guessed: a field the record
// does not store is null and an edge whose key is null ends in a gap (`to: null`). The truth column (unit, true draw instant, context at the draw) is the only truth the view carries.

export interface LineageField {
  name: string;
  value: string | number | null;
}
export interface LineageNode {
  id: string;
  table: string;
  key: string;
  fields: LineageField[];
}
export interface LineageEdge {
  from: string;
  /** Null: the key that joins is null in the record (a stub that ends in a gap). */
  to: string | null;
  relation: string;
  basis?: "sampled_at" | "measured_at";
}

/** One record's rows for one sample, with no truth and no verdict: the drill-down of the challenge (section 9) and the base of a lineage column. */
export interface SampleRecord {
  architecture: string;
  flags_on: string[];
  labelling: string;
  nodes: LineageNode[];
  edges: LineageEdge[];
}

export interface LineageColumn extends SampleRecord {
  answers: { question: "unit" | "sampled_at" | "process_context"; answer: unknown; verdict: Verdict }[];
  realised_errors: { type: string; detail: Record<string, string | number> }[];
}

export interface LineageView {
  sample: { sample_id: string; unit_id: string; picked_by: "sc3_rule" | "reader" | "challenge" };
  truth: { unit_id: string; sampled_at: number; context: { feed_epoch: number; batch_phase: string } };
  columns: LineageColumn[];
}

const field = (name: string, value: string | number | null | undefined): LineageField => ({ name, value: value ?? null });

export interface RecordOptions {
  /** The decision variant: the recorded structure carries placeholder pH values (data_model section 7, "Experiment 2"), so the value of a pH result is not shown. */
  hide_ph_values?: boolean;
}

/** The rows of a record for one sample as nodes and edges. */
export const sampleRecordOf = (ds: RecordedDataset, sample_id: string, o: RecordOptions = {}): SampleRecord => {
  const nodes: LineageNode[] = [];
  const edges: LineageEdge[] = [];
  const node = (table: string, key: string, fields: LineageField[]): LineageNode => {
    const n = { id: `${table}:${key}`, table, key, fields };
    nodes.push(n);
    return n;
  };

  const samples = ds.sample.filter((s) => s.sample_id === sample_id).map((s) =>
    node("sample", s.sample_id, [field("sample_id", s.sample_id), field("unit_id", s.unit_id), field("batch_id", s.batch_id), field("sampled_at", s.sampled_at), field("planned_at", s.planned_at), field("operator_id", s.operator_id), field("container", s.container)]));
  const requests = ds.analysis_request.filter((r) => r.request_id === sample_id).map((r) => node("analysis_request", r.request_id, [field("request_id", r.request_id), field("control_id", r.control_id)]));
  const runs = ds.run.filter((r) => r.request_id === sample_id).sort((a, b) => a.attempt - b.attempt || a.visit - b.visit);
  const runNodes = runs.map((r) => node("run", r.run_id, [field("run_id", r.run_id), field("attempt", r.attempt), field("visit", r.visit), field("analyzer_name", r.analyzer_name), field("started_at", r.started_at), field("qc_outcome", r.qc_outcome)]));
  const states = new Map<string, LineageNode>();
  for (const r of runs) {
    if (r.instrument_state_id === null || states.has(r.instrument_state_id)) continue;
    const s = ds.instrument_state.find((x) => x.instrument_state_id === r.instrument_state_id);
    states.set(r.instrument_state_id, node("instrument_state", r.instrument_state_id, [field("instrument_state_id", r.instrument_state_id), field("calibration_ref", s?.calibration_ref), field("reagent_lot", s?.reagent_lot), field("valid_from", s?.valid_from)]));
  }
  const results = ds.result.filter((r) => r.request_id === sample_id);
  const resultNodes = results.map((r) => node("result", r.result_id, [
    field("result_id", r.result_id), field("analyte", r.analyte), field("version", r.version), field("value", o.hide_ph_values && r.analyte === "ph" ? null : r.value),
    field("measured_at", r.measured_at), field("available_at", r.available_at), field("state", r.state),
  ]));
  const ctx = recordContext(ds, sample_id);
  const ctxNode = ctx ? node("process_context", "view", [field("join_basis", ctx.join_basis), field("join_time", ctx.join_time), field("feed_epoch", ctx.feed_epoch), field("batch_phase", ctx.batch_phase)]) : null;

  const sampleNode = samples[0];
  if (sampleNode) {
    if (requests.length === 0) edges.push({ from: sampleNode.id, to: null, relation: "request_id" });
    for (const r of requests) edges.push({ from: sampleNode.id, to: r.id, relation: "request_id" });
    if (ctxNode && ctx) edges.push({ from: sampleNode.id, to: ctxNode.id, relation: "process_context", basis: ctx.join_basis });
    else edges.push({ from: sampleNode.id, to: null, relation: "process_context" });
  }
  for (const r of requests) {
    if (runNodes.length === 0) edges.push({ from: r.id, to: null, relation: "request_id" });
    for (const run of runNodes) edges.push({ from: r.id, to: run.id, relation: "request_id" });
  }
  runNodes.forEach((n, i) => {
    const next = runNodes[i + 1];
    if (next) edges.push({ from: n.id, to: next.id, relation: "rerun_of" });
    const stored = runs[i]?.instrument_state_id ?? null;
    edges.push({ from: n.id, to: stored === null ? null : (states.get(stored)?.id ?? null), relation: "instrument_state_id" });
  });
  results.forEach((r, i) => {
    const resultNode = resultNodes[i] as LineageNode;
    const run = runNodes.find((n) => n.key === r.run_id);
    edges.push(run ? { from: run.id, to: resultNode.id, relation: "measured_in" } : { from: resultNode.id, to: null, relation: "run_id" });
    const earlier = r.supersedes === null ? undefined : resultNodes.find((n) => n.key === r.supersedes);
    if (earlier) edges.push({ from: earlier.id, to: resultNode.id, relation: "superseded_by" });
  });

  ds.audit_event.filter((a) => a.request_id === sample_id).forEach((a) => {
    const audit = node("audit_event", a.audit_id, [field("audit_id", a.audit_id), field("analyte", a.analyte), field("at", a.at), field("old_value", a.old_value), field("new_value", a.new_value), field("old_version", a.old_version), field("new_version", a.new_version)]);
    const concerned = results.findIndex((r) => r.analyte === a.analyte && r.version === a.new_version);
    edges.push({ from: audit.id, to: concerned < 0 ? null : (resultNodes[concerned] as LineageNode).id, relation: "concerns" });
  });
  ds.validation_finding.filter((f) => requestOfTarget(ds, f.target) === sample_id).forEach((f, i) => {
    const finding = node("validation_finding", String(i + 1), [field("rule", f.rule), field("target", f.target), field("action", f.action), field("status", f.status)]);
    const [kind, key] = f.target.split(":", 2);
    const target = kind === "result" ? resultNodes.find((n) => n.key === key) : kind === "sample" ? sampleNode : requests[0];
    edges.push({ from: finding.id, to: target?.id ?? null, relation: "concerns" });
  });

  return { architecture: ds.architecture.id, flags_on: FLAG_NAMES.filter((f) => ds.architecture.flags[f]), labelling: ds.architecture.labelling, nodes, edges };
};

/** One column of the view: the record's rows for the sample, the three answers against truth, and the errors the injector realised on the sample in this architecture. */
export const lineageColumn = (ds: RecordedDataset, truth: SampleTruth, realised: readonly MaterialisedError[], o: RecordOptions = {}): LineageColumn => {
  const { answers } = askQuestions(ds, truth);
  return {
    ...sampleRecordOf(ds, truth.sample_id, o),
    answers: (["unit", "sampled_at", "process_context"] as const).map((question) => ({ question, answer: answers[question].answer, verdict: answers[question].verdict })),
    realised_errors: realised.filter((e) => e.sample_id === truth.sample_id).map(({ type, detail }) => ({ type, detail })),
  };
};

/** The view of one sample over the datasets of the chosen architectures, in the order given. */
export const lineageView = (truth: SampleTruth, picked_by: LineageView["sample"]["picked_by"], datasets: readonly RecordedDataset[], materialised: Readonly<Record<string, readonly MaterialisedError[]>>, o: RecordOptions = {}): LineageView => ({
  sample: { sample_id: truth.sample_id, unit_id: truth.unit_id, picked_by },
  truth: { unit_id: truth.unit_id, sampled_at: truth.sampled_at, context: { feed_epoch: truth.context_at_draw.feed_epoch, batch_phase: truth.context_at_draw.batch_phase } },
  columns: datasets.map((ds) => lineageColumn(ds, truth, materialised[ds.architecture.id] ?? [], o)),
});

export interface LineageRequest {
  data: LabData;
  spec: RunSpec;
  seed: number;
  pick: { rule: "sc3" } | { sample_id: string };
}

export type LineageResult = { ok: true; view: LineageView; sample_ids: string[] } | { ok: false; message: string };

const refuse = (message: string): LineageResult => ({ ok: false, message });

/**
 * The `lineage` request of a checked spec: one seed of the scenario through `runSeed` for the chosen architectures, the pick rule (or the reader's sample) on the truth log, the three
 * questions against each record, and the realised errors from the injector's plain output. The caller has refused a run that is an unrevealed challenge (rule 2 of section 4).
 */
export const runLineage = ({ data, spec, seed, pick }: LineageRequest): LineageResult => {
  if (spec.architectures.length === 0) return refuse("a lineage view needs at least one architecture");
  const rule = "rule" in pick;
  const { run, input } = labSeed(data, spec, seed, architecturesNamed(data, spec.architectures));
  let truth: SampleTruth | null;
  try {
    truth = rule ? pickSample(run) : sampleTruth(run, pick.sample_id);
  } catch (e) {
    // the rule is stated for a run with a feed between a draw and its measurement (SC3); where no sample qualifies it says so, and the reader picks a sample of the run instead
    return refuse(`${(e as Error).message}; pick a sample of this run instead`);
  }
  if (truth === null) return refuse(`the run does not hold the sample ${JSON.stringify((pick as { sample_id: string }).sample_id)}`);
  const out = runSeed(input);
  const datasets = input.architectures.map((a) => out.datasets[a.id] as RecordedDataset);
  return { ok: true, view: lineageView(truth, rule ? "sc3_rule" : "reader", datasets, materialisedOf(input)), sample_ids: drawnSampleIds(run) };
};
