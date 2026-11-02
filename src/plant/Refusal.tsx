import { Label, T } from "../ui/T.tsx";
import type { ActRefusal } from "./plant_state.ts";
import { refusalKey } from "./refusal.ts";

// A refusal at the form that sent the action (docs/design/plant_ui.md section 5.6, "As built in P6a"): the sentence for the reason in the page's language, the Worker's own message beside it verbatim in a
// `lang="en"` element, and the place of the action in the list that was sent. The block is announced when it appears. A causality check that came back false is said the same way, with the name of the check.

export function Refusal({ refusal }: { refusal: ActRefusal }) {
  const problem = refusal.kind === "error" ? refusal.problem : null;
  return (
    <div class="plant-refusal warn" role="alert" data-plant-refusal={problem ? (problem.reason ?? problem.code) : "causality"}>
      <T as="strong" k="plant.refusal.heading" />
      {refusal.kind === "causality" && <T as="p" k="plant.refusal.causality" parts={{ check: <Label>{refusal.check}</Label> }} />}
      {problem && (
        <>
          <T as="p" k={refusalKey(problem)} />
          <p>
            <T k="plant.refusal.engine" />{" "}
            <code>
              <Label engine>{problem.message}</Label>
            </code>
          </p>
          {problem.index !== undefined && <T as="p" k="plant.refusal.index" parts={{ number: <Label>{problem.index + 1}</Label> }} />}
        </>
      )}
    </div>
  );
}
