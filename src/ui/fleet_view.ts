import type { FleetProblem } from "../protocol.ts";
import { fleetKey } from "./form.ts";
import type { Form } from "./form.ts";
import type { FleetState } from "./state.ts";

// What Setup says about the analyzer list (U2; docs/design/lab_ui.md section 4, rule 6, and section 3). The verdict is the engine's own (`fleet_checked`: the problems of `fleetProblems`, engine/src/fleet.ts); the
// page words it and decides about Run, and holds no rule of its own about which lists are allowed. Pure functions, no DOM.

/** One sentence of the message: analyzers by their place in the list (positions, shown as labels: they are not figures), and the analytes or the group they clash on. */
export type FleetNote =
  | { kind: "clash"; a: number; b: number; analytes: string[] }
  | { kind: "group"; a: number; b: number; group: string }
  | { kind: "unmeasured"; analytes: string[] };

/**
 * The problems as sentences, in the order the engine meets them. Every analyte that the same two analyzers share is one sentence (a pair of profiles that overlap on six analytes is one problem, not six);
 * the analytes that nobody measures are one sentence.
 */
export const fleetNotes = (problems: readonly FleetProblem[]): FleetNote[] => {
  const notes: FleetNote[] = [];
  for (const p of problems) {
    if (p.kind === "shared_group") {
      notes.push({ kind: "group", a: p.first.analyzer, b: p.second.analyzer, group: p.group });
    } else if (p.kind === "shared_analyte") {
      const same = notes.find((n): n is Extract<FleetNote, { kind: "clash" }> => n.kind === "clash" && n.a === p.first.analyzer && n.b === p.second.analyzer);
      if (same) same.analytes.push(p.analyte);
      else notes.push({ kind: "clash", a: p.first.analyzer, b: p.second.analyzer, analytes: [p.analyte] });
    } else {
      const open = notes.find((n): n is Extract<FleetNote, { kind: "unmeasured" }> => n.kind === "unmeasured");
      if (open) open.analytes.push(p.analyte);
      else notes.push({ kind: "unmeasured", analytes: [p.analyte] });
    }
  }
  return notes;
};

export interface FleetView {
  /** The problems to say: those of the newest answer, kept on screen while the next check is on its way so that the message does not blink. */
  problems: FleetProblem[];
  /** Run is off: a problem stands, or the check has not answered for the picks in front of the reader. Nothing is said for a check that is only on its way. */
  blocked: boolean;
}

/** The verdict as Setup uses it: `blocked` unless the newest answer is about this very scenario and these picks and finds nothing. */
export const fleetView = (form: Pick<Form, "scenario" | "analyzers">, fleet: FleetState): FleetView => {
  const verdict = fleet.verdict;
  return { problems: verdict?.problems ?? [], blocked: verdict === null || verdict.key !== fleetKey(form) || verdict.problems.length > 0 };
};
