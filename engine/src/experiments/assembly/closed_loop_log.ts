import { recordedContext } from "../arms/closed_loop.ts";
import type { Decision } from "../arms/closed_loop.ts";
import type { RecordedDataset } from "../../record/types.ts";

// 2026-10-30 S3d (lab_ui.md sections 5 and 9): the decision log of an arm, asked for by the lab and by nothing else. One entry per readjustment slot: the instant, what the arm did and
// the row it read as the record holds it (the id the row is filed under, its time, its value in this arm's world, and the container and hold time `recordedContext` gives that id, each
// null where the record holds none). It is plain data and holds no truth: which sample a row came from is found by the lab function that holds the shared lab run (lab/decisions.ts).

export interface LoggedRow {
  /** The record's own id of the row; the truth side finds the sample the row stands for through it. */
  result_id: string;
  /** The id the row is filed under in the record (`request_id`), which a label error makes the neighbour's. */
  filed_under: string;
  measured_at: number;
  /** The offline value in this arm's world (the arm's own substitution, as `decideReadjust` read it). */
  value: number;
  container: string | null;
  hold_s: number | null;
  /** The review state of the row (`released` or null for a row the decision could read). */
  state: string | null;
}

export interface LoggedDecision {
  /** `<unit_id>@<t>`: one decision per reactor and readjustment slot. */
  decision_id: string;
  unit_id: string;
  /** The readjustment tick, in seconds of the scenario. */
  t: number;
  action: "readjust" | "skip" | "none";
  /** readjust: the value the probe is set to read. */
  onto: number | null;
  /** skip: why. */
  reason: "known_bias" | null;
  /** The row the decision looked at; null for `none` (no new available pH row at the tick). */
  read: LoggedRow | null;
}

/**
 * The entry of one decision. `ds` is the dataset the decision was taken on (the arm's rows with the arm's values). The row is found from the decision's id and `measured_at`; two rows
 * that share both are copies of one another and carry one value, and the first by `result_id` is the one `decideReadjust` takes.
 */
export const loggedDecision = (unit_id: string, t: number, d: Decision, ds: RecordedDataset): LoggedDecision => {
  const head = { decision_id: `${unit_id}@${t}`, unit_id, t };
  if (d.action === "none") return { ...head, action: "none", onto: null, reason: null, read: null };
  const row = ds.result
    .filter((r) => r.analyte === "ph" && r.request_id === d.sample_id && r.measured_at === d.measured_at)
    .sort((a, b) => (a.result_id < b.result_id ? -1 : 1))[0];
  if (!row) throw new Error(`closed loop: the decision ${head.decision_id} read a row of ${d.sample_id} measured at ${d.measured_at}, which the arm's rows do not hold`);
  const context = recordedContext(ds, d.sample_id);
  return {
    ...head, action: d.action, onto: d.action === "readjust" ? d.onto : null, reason: d.action === "skip" ? d.reason : null,
    read: { result_id: row.result_id, filed_under: row.request_id, measured_at: row.measured_at, value: row.value, container: context.container, hold_s: context.hold_time_s, state: row.state },
  };
};
