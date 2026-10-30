import type { ComponentChildren } from "preact";
import { gradeOf, isProvisional } from "../ledger.ts";
import { T } from "./T.tsx";

/** An input (invariant 3, lab_ui.md section 6): its value and unit as the scenario file gives them, its ledger id, the grade word of that id and, when any source it follows to is
 *  below main-reread, a dashed provisional chip. A grade-A id with no source reads "assumed" and is not provisional. */
export function Ref({ ids, children }: { ids: readonly string[]; children: ComponentChildren }) {
  const grade = gradeOf(ids);
  const provisional = ids.some(isProvisional);
  return (
    <span class="ref" data-ref={ids.join(" ")} {...(grade && { "data-grade": grade })} {...(provisional && { "data-status": "provisional" })}>
      <span class="ref-value">{children}</span>
      <span class="ref-id">{ids.join(" ")}</span>
      {grade && <T k={`grade.${grade}`} class="grade" />}
      {provisional && <T k="grade.provisional" class="chip chip-provisional" />}
    </span>
  );
}
