import type { Problem } from "./state.ts";
import { T } from "./T.tsx";

/** A problem reported by the Worker. The sentence that introduces it is translated; the message itself is the engine's English text, shown verbatim in a lang="en" block (lab_ui.md section 4, rule 4). */
export function ErrorBlock({ problem }: { problem: Problem }) {
  return (
    <div class="problem" role="alert" data-problem={problem.code}>
      <T as="h3" k="error.heading" />
      <T as="p" k={`error.${problem.code}`} />
      <pre lang="en" class="engine-message" data-label>
        {problem.message}
      </pre>
    </div>
  );
}
