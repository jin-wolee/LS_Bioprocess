import { beforeAll, describe, expect, it } from "vitest";
import type { ExperimentReport } from "../../engine/src/generated/experiment_report.schema";
import { readyOf } from "../../engine/src/experiments/assembly/lab/ready.ts";
import { labData } from "../../engine/tests/support/lab_data.ts";
import { readJson } from "../../engine/tests/support/paths.ts";
import type { Response, ResultFooter } from "../protocol.ts";
import { LAB_DATA } from "../worker/data.ts";
import { createWorker } from "../worker/worker.ts";
import { fromQuery, runRequest } from "./form.ts";
import { ONE_FLAG, QUESTIONS, answerOf, oneFlagCancel, oneFlagLink, oneFlagRequest } from "./one_flag.ts";
import { initial, reduce } from "./state.ts";
import type { ReadyInfo, State } from "./state.ts";

// A3 (docs/design/lab_ui.md section 26): the card on Home asks the Worker for exactly one run and reads three questions off its report. The run spec is typed here by hand from the brief (the
// seeds from the experiment's file, not from the code under test); the rows are read from the report as they are (identity, so no number is computed on the page); the order of the records is the
// run spec's whatever the values; the card's run has a state of its own, so no message about it reaches Results and none about Results reaches it. The real Worker and the real reducer run once.

type Report = ExperimentReport;
const data = labData();
const READY = readyOf(data) as unknown as ReadyInfo;
const SEEDS = (readJson<{ seeds: number[] }>("data", "scenarios", "experiments", "experiment1.json").seeds).slice(0, 20);
const ORDER = ["c_context", "c_context_minus_two_clocks"];
const ID = 7;

describe("the run spec of the card", () => {
  it("Given the lab's own ready When the card asks Then the request is exactly: the scenario of the feed in the gap, C and C without two_clocks in that order, the first 20 seeds, nothing else", () => {
    expect(oneFlagRequest(READY, ID)).toStrictEqual({ type: "run", id: ID, spec: { schema_version: "1", scenario: "sc03_feed_in_gap", settings: {}, architectures: ORDER, seeds: SEEDS } });
    expect(SEEDS).toHaveLength(20);
    expect(ONE_FLAG).toStrictEqual({ scenario: "sc03_feed_in_gap", preset: "c_context", ablation: "c_context_minus_two_clocks" });
  });

  it("Given the data of the public build (the bundle the Worker ships, no local flag) Then the same request is possible: the scenario and both records are in its ready", () => {
    const publicReady = readyOf(LAB_DATA as never) as unknown as ReadyInfo;
    expect(oneFlagRequest(publicReady, ID)).toStrictEqual(oneFlagRequest(READY, ID));
  });

  it("Given a build that offers no such ablation or no such scenario Then the card has no request and no link, and does not guess one", () => {
    expect(oneFlagRequest({ ...READY, presets: READY.presets.filter((p) => p.id !== ORDER[1]) }, ID)).toBeNull();
    expect(oneFlagLink({ ...READY, presets: READY.presets.filter((p) => p.id !== ORDER[1]) })).toBeNull();
    expect(oneFlagRequest({ ...READY, scenarios: READY.scenarios.filter((s) => s.id !== "sc03_feed_in_gap") }, ID)).toBeNull();
  });

  it("Given the link of the card Then it opens Setup with the settings of this run filled, and that form makes the very request the card makes", () => {
    const link = oneFlagLink(READY) as string;
    expect(link.startsWith("#/setup?")).toBe(true);
    const query = new URLSearchParams(link.slice("#/setup?".length));
    expect(query.get("scenario")).toBe("sc03_feed_in_gap");
    expect(query.get("arch")).toBe(ORDER.join(","));
    expect(query.get("seeds")).toBe(SEEDS.join(","));
    expect(runRequest(fromQuery(link.slice("#/setup?".length), READY).form, READY, ID)).toStrictEqual(oneFlagRequest(READY, ID));
  });
});

describe("the three questions", () => {
  it("Given the table of questions Then it names the metrics of the brief, in this order, and no `exact_reconstruction`", () => {
    expect(QUESTIONS.map((q) => q.id)).toEqual(["mismatch", "detection", "cost"]);
    expect(QUESTIONS.flatMap((q) => ("metrics" in q ? q.metrics : []))).toEqual(["alignment_error.context_mismatch", "hold_limit.rejected", "availability.available"]);
    expect(QUESTIONS.find((q) => q.id === "detection")).toMatchObject({ type: "feed_in_gap" });
    expect(JSON.stringify(QUESTIONS)).not.toContain("exact_reconstruction");
  });
});

describe("the answer, through the real Worker and the real reducer (20 seeds, once)", () => {
  let state: State;
  let report: Report;
  let posted: Response[];

  beforeAll(async () => {
    posted = [];
    const w = createWorker((m) => posted.push(structuredClone(m)), { data, now: () => performance.now(), fetchReference: async () => undefined });
    state = reduce({ ...initial, ready: READY }, { type: "one_flag_started", id: ID });
    await w.onMessage(oneFlagRequest(READY, ID));
    for (const m of posted) state = reduce(state, m);
    report = state.oneFlag.result?.report as Report;
  }, 180_000);

  it("Given the run Then the card holds the report and its footer, and nothing of Results or Home was touched", () => {
    expect(state.oneFlag.running).toBeNull();
    expect(state.oneFlag.progress).toBeNull();
    expect(state.oneFlag.problem).toBeNull();
    expect(state.oneFlag.result?.footer).toMatchObject({ kind: "simulation_result", scenario: "sc03_feed_in_gap", seeds: SEEDS, architectures: ORDER });
    expect(report.architectures.map((b) => [b.id, b.role, b.ablated_flag, b.n_seeds])).toEqual([["c_context", "preset", null, 20], ["c_context_minus_two_clocks", "ablation", "two_clocks", 20]]);
    expect(report.meets_min_seeds).toBe(true);
    expect(state.results).toBeNull();
    expect(state.home).toBeNull();
    expect(state.problem).toBeNull();
    expect(state.running).toBeNull();
    expect(posted.filter((m) => m.type === "progress")).toHaveLength(20);
  });

  it("Given the answer Then each question has the records in the order of the run spec and its rows are the report's own rows (identical objects: no number is computed on the page)", () => {
    const answers = answerOf(report, ORDER);
    expect(answers.map((a) => a.id)).toEqual(["mismatch", "detection", "cost"]);
    const rowOf = (id: string, metric: string) => report.architectures.find((b) => b.id === id)?.rows.find((r) => r.metric === metric);
    for (const a of answers) expect(a.columns.map((c) => c.block.id), a.id).toEqual(ORDER);
    for (const id of ORDER) {
      const at = (q: string) => answers.find((a) => a.id === q)?.columns.find((c) => c.block.id === id);
      expect(at("mismatch")?.rows[0]).toBe(rowOf(id, "alignment_error.context_mismatch"));
      expect(at("cost")?.rows[0]).toBe(rowOf(id, "hold_limit.rejected"));
      expect(at("cost")?.rows[1]).toBe(rowOf(id, "availability.available"));
      const group = at("detection")?.group;
      expect(group?.type).toBe("feed_in_gap");
      for (const field of ["recall", "precision", "false_alarm", "realised"] as const) expect(group?.[field]).toBe(rowOf(id, `detection.by_type.feed_in_gap.${field}`));
      expect(at("detection")?.rows).toEqual([]);
    }
  });

  it("Given the record without the draw time Then the hold-time rule and the detection of the feed in the gap are `not_evaluable` with the engine's reason, never a zero (VR-010 needs both times)", () => {
    const ablation = answerOf(report, ORDER).map((a) => a.columns[1]);
    expect(ablation[0]?.rows[0]?.status).toBe("reported");
    expect(ablation[1]?.group?.recall?.status).toBe("not_evaluable");
    expect(ablation[1]?.group?.recall?.median).toBeNull();
    expect(ablation[1]?.group?.recall?.reason).toContain("two_clocks off");
    expect(ablation[2]?.rows[0]?.status).toBe("not_evaluable");
    expect(ablation[2]?.rows[0]?.median).toBeNull();
  });

  it("Given a report whose blocks come in the other order, or whose values are swapped either way Then the records still stand in the order of the run spec", () => {
    const variants: Report[] = [];
    const reversed = structuredClone(report);
    reversed.architectures.reverse();
    variants.push(reversed);
    for (const high of ORDER) {
      const v = structuredClone(report);
      for (const b of v.architectures) for (const r of b.rows) if (r.status === "reported") { const x = b.id === high ? 1 : 0; r.median = x; r.lo = x; r.hi = x; }
      variants.push(v);
    }
    for (const v of variants) for (const a of answerOf(v, ORDER)) expect(a.columns.map((c) => c.block.id), a.id).toEqual(ORDER);
    expect(answerOf(reversed, [...ORDER].reverse())[0]?.columns.map((c) => c.block.id), "the order given is the order kept").toEqual([...ORDER].reverse());
  });

  it("Given a report with no row of a metric Then the column says so with a null and invents no figure", () => {
    const thin = structuredClone(report);
    for (const b of thin.architectures) b.rows = b.rows.filter((r) => r.metric !== "hold_limit.rejected");
    expect(answerOf(thin, ORDER).find((a) => a.id === "cost")?.columns.map((c) => c.rows)).toEqual([[null, expect.anything()], [null, expect.anything()]]);
  });
});

describe("the state of the card is its own", () => {
  const request = oneFlagRequest(READY, ID);
  const footer: ResultFooter = { kind: "simulation_result", scenario: "sc03_feed_in_gap", seeds: [1], engine_version: "9.9.9", architectures: ORDER, inputs: [], check: "identical" };
  const started = reduce({ ...initial, ready: READY }, { type: "one_flag_started", id: ID });

  it("Given a run in flight Then the id is kept, and the card's progress is its own", () => {
    expect(request?.id).toBe(ID);
    expect(started.oneFlag).toMatchObject({ running: ID, progress: null, result: null, problem: null });
    const next = reduce(started, { type: "progress", id: ID, done: 3, total: 20 });
    expect(next.oneFlag.progress).toEqual({ id: ID, done: 3, total: 20 });
    expect(next.progress).toBeNull();
  });

  it("Given a result, a progress or an error for another id (Results' own run) Then it is Results' and the card is untouched", () => {
    const withResults = reduce(started, { type: "run_started", id: 9 });
    expect(withResults.oneFlag).toEqual(started.oneFlag);
    const progress = reduce(withResults, { type: "progress", id: 9, done: 1, total: 2 });
    expect(progress.progress).toEqual({ id: 9, done: 1, total: 2 });
    expect(progress.oneFlag).toEqual(started.oneFlag);
    const failed = reduce(progress, { type: "error", id: 9, code: "engine_error", message: "x" });
    expect(failed.problem?.code).toBe("engine_error");
    expect(failed.oneFlag).toEqual(started.oneFlag);
    expect(failed.running).toBeNull();
  });

  it("Given an error or a result of the card's id Then it is the card's and Results, Home and the shared problem are untouched", () => {
    const failed = reduce(started, { type: "error", id: ID, code: "cancelled", message: "the run was cancelled after 1 of 20 seeds" });
    expect(failed.oneFlag).toMatchObject({ running: null, progress: null, result: null, problem: { id: ID, code: "cancelled" } });
    expect(failed.problem).toBeNull();
    const answered = reduce({ ...started, results: { id: 3, footer } }, { type: "result", id: ID, report: {} as Report, footer });
    expect(answered.oneFlag.result?.id).toBe(ID);
    expect(answered.results?.id).toBe(3);
    expect(answered.home).toBeNull();
  });

  it("Given a run of Setup after the card's answer Then the answer stays; and a new card run clears it", () => {
    const answered = reduce(started, { type: "result", id: ID, report: {} as Report, footer });
    expect(reduce(answered, { type: "run_started", id: 12 }).oneFlag.result?.id).toBe(ID);
    expect(reduce(answered, { type: "one_flag_started", id: 13 }).oneFlag).toMatchObject({ running: 13, result: null, problem: null });
  });

  it("Given the Worker itself fails Then the card stops with the Worker's problem", () => {
    expect(reduce(started, { type: "worker_error", message: "boom" }).oneFlag).toMatchObject({ running: null, progress: null, problem: { id: null, code: "worker", message: "boom" } });
    expect(reduce(initial, { type: "worker_error", message: "boom" }).oneFlag.problem).toBeNull();
  });
});

describe("Cancel stops the card's run", () => {
  it("Given a run in flight Then Cancel is a cancel of the card's id, and with none in flight there is nothing to cancel", () => {
    const started = reduce({ ...initial, ready: READY }, { type: "one_flag_started", id: ID });
    expect(oneFlagCancel(started.oneFlag)).toStrictEqual({ type: "cancel", id: ID });
    expect(oneFlagCancel(initial.oneFlag)).toBeNull();
  });

  it("Given the run in the real Worker and a cancel asked at once Then it ends between two seeds in a cancelled problem and no result", async () => {
    const posted: Response[] = [];
    const w = createWorker((m) => posted.push(structuredClone(m)), { data, now: () => performance.now(), fetchReference: async () => undefined });
    let state = reduce({ ...initial, ready: READY }, { type: "one_flag_started", id: ID });
    const answered = w.onMessage(oneFlagRequest(READY, ID));
    await w.onMessage(oneFlagCancel(state.oneFlag));
    await answered;
    for (const m of posted) state = reduce(state, m);
    expect(state.oneFlag.running).toBeNull();
    expect(state.oneFlag.result).toBeNull();
    expect(state.oneFlag.problem?.code).toBe("cancelled");
    const done = /after (\d+) of 20 seeds/.exec(state.oneFlag.problem?.message ?? "");
    expect(done).not.toBeNull();
    expect(Number(done?.[1])).toBeLessThan(20);
    expect(state.problem).toBeNull();
  }, 60_000);
});
