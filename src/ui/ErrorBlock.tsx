import { refusalKey } from "../plant/refusal.ts";
import type { Problem } from "./state.ts";
import { Label, T } from "./T.tsx";

/** A problem reported by the Worker. The sentence that introduces it is translated; the message itself is the engine's English text, shown verbatim in a lang="en" block (lab_ui.md section 4,
 *  rule 4). A cancel is not a fault of the engine: it has a heading of its own. A refused action (P6b) has the sentence of its reason (plant_ui.md section 5.6) and its place in the list that was sent. */
export function ErrorBlock({ problem }: { problem: Problem }) {
  return (
    <div class="problem" role="alert" data-problem={problem.code}>
      <T as="h3" k={problem.code === "cancelled" ? "error.heading.cancelled" : problem.code === "refused" ? "error.heading.refused" : "error.heading"} />
      <T as="p" k={problem.code === "refused" ? refusalKey(problem) : `error.${problem.code}`} />
      <pre lang="en" class="engine-message" data-label>
        {problem.message}
      </pre>
      {problem.code === "worker" && <T as="p" k="error.worker.recovery" />}
      {problem.code === "refused" && problem.index !== undefined && <T as="p" k="plant.refusal.index" parts={{ number: <Label>{problem.index + 1}</Label> }} />}
    </div>
  );
}
