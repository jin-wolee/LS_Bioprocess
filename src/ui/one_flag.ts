import type { ExperimentReport } from "../../engine/src/generated/experiment_report.schema";
import type { Request } from "../protocol.ts";
import { defaultForm, runRequest, toQuery } from "./form.ts";
import type { Form } from "./form.ts";
import { groupRows } from "./results_view.ts";
import type { DetectionGroup, ReportRow } from "./results_view.ts";
import { hashOf } from "./route.ts";
import type { OneFlagState } from "./one_flag_state.ts";
import type { ReadyInfo } from "./state.ts";

// The card "What one stored timestamp changes" on Home (docs/design/lab_ui.md section 26; A3). Pure functions, no DOM: the one run the card asks the Worker for, the link that opens Setup with the
// same settings, and the rows of the report that answer the three questions. Nothing here computes a number or orders anything: a row is taken from the report as it is, and the records stand in the
// order of the run spec.

/** The run: the scenario where a feed lands between a draw and its measurement, C, and C with exactly one flag off (ADR-0005). The seeds are the first of the list (A103), as Setup's default. */
export const ONE_FLAG = { scenario: "sc03_feed_in_gap", preset: "c_context", ablation: "c_context_minus_two_clocks" } as const;

/** The form of Setup that makes this run, or null where the build does not offer the scenario or one of the two records (it does not guess another). */
export const oneFlagForm = (ready: ReadyInfo): Form | null => {
  const offered =
    ready.scenarios.some((s) => s.id === ONE_FLAG.scenario) &&
    ready.presets.some((p) => p.id === ONE_FLAG.preset && p.role === "preset") &&
    ready.presets.some((p) => p.id === ONE_FLAG.ablation && p.role === "ablation");
  return offered ? { ...defaultForm(ready, ONE_FLAG.scenario), archs: [ONE_FLAG.preset], ablation: ONE_FLAG.ablation } : null;
};

/** The `run` request of the card: the request Setup would make for that form (lab_ui.md section 4), so the card can ask for nothing that Setup could not. */
export const oneFlagRequest = (ready: ReadyInfo, id: number): Extract<Request, { type: "run" }> | null => {
  const form = oneFlagForm(ready);
  return form ? runRequest(form, ready, id) : null;
};

/** The link that opens Setup with the settings of this run filled in. It fills the form and does not run (lab_ui.md section 21, item 2). */
export const oneFlagLink = (ready: ReadyInfo): string | null => {
  const form = oneFlagForm(ready);
  return form ? hashOf("setup", toQuery(form, ready)) : null;
};

/** The cancel of the run in flight, or null when none is. The Worker reads it between two seeds. */
export const oneFlagCancel = (state: OneFlagState): Extract<Request, { type: "cancel" }> | null => (state.running === null ? null : { type: "cancel", id: state.running });

export type QuestionId = "mismatch" | "detection" | "cost";

/** The three questions, in this order, with the rows of the report that answer each (`exact_reconstruction` is left out on purpose: the design says why). The detection question reads the group of an
 *  error type, recall beside precision and the false-alarm rate (spec section 8, rule 3). */
export const QUESTIONS = [
  { id: "mismatch", metrics: ["alignment_error.context_mismatch"] },
  { id: "detection", type: "feed_in_gap" },
  { id: "cost", metrics: ["hold_limit.rejected", "availability.available"] },
] as const satisfies readonly ({ id: QuestionId; metrics: readonly string[] } | { id: QuestionId; type: string })[];

type Block = ExperimentReport["architectures"][number];

/** One record under one question: its block of the report, the rows asked for (a row the report lacks is null, said in words and never shown as a zero) or, for the detection question, the group. */
export interface Column {
  block: Block;
  rows: (ReportRow | null)[];
  group: DetectionGroup | null;
}

export interface Answer {
  id: QuestionId;
  columns: Column[];
}

/** The answer to each question for the records named, in the order named (the order of the run spec, never an order of values). A record the report does not hold is left out. */
export const answerOf = (report: ExperimentReport, order: readonly string[]): Answer[] => {
  const blocks = order.flatMap((id) => report.architectures.filter((b) => b.id === id));
  return QUESTIONS.map((q) => ({
    id: q.id,
    columns: blocks.map((block): Column =>
      "metrics" in q
        ? { block, rows: q.metrics.map((metric) => block.rows.find((r) => r.metric === metric) ?? null), group: null }
        : { block, rows: [], group: groupRows(block.rows).detection.find((g) => g.type === q.type) ?? null },
    ),
  }));
};
