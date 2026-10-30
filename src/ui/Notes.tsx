import { FlagTable } from "./Flags.tsx";
import type { ReadyInfo } from "./state.ts";
import { Label, T } from "./T.tsx";

// Notes (lab_ui.md section 3): what the numbers are and are not. Scope and non-goals (spec section 10), the grades and the provisional chip, the dialect sentence of ADR-0014 rule R3, the
// versions, the reach of the browser check, and the flag table of ADR-0005 as dictionary text. Static text: no number appears here except through a label.

const SCOPE = ["notes.scope.synthetic", "notes.scope.predict", "notes.scope.claims", "notes.scope.score", "notes.scope.server"] as const;
const GRADES = ["grade.S", "grade.P", "grade.D", "grade.A"] as const;

export function Notes({ ready }: { ready: ReadyInfo | null }) {
  return (
    <>
      <section aria-labelledby="notes-heading">
        <T as="h1" k="notes.heading" id="notes-heading" />
      </section>

      <section id="scope" aria-labelledby="scope-heading">
        <T as="h2" k="notes.scope.heading" id="scope-heading" />
        <ul>
          {SCOPE.map((k) => (
            <T key={k} as="li" k={k} />
          ))}
        </ul>
      </section>

      <section id="grades" aria-labelledby="grades-heading">
        <T as="h2" k="notes.grades.heading" id="grades-heading" />
        <T as="p" k="notes.grades.lead" />
        <ul class="grade-legend">
          {GRADES.map((k) => (
            <li key={k}>
              <T k={k} class="grade" />
            </li>
          ))}
          <li>
            <T k="grade.provisional" class="chip chip-provisional" />
          </li>
        </ul>
        <T as="p" k="notes.grades.provisional" />
        <T as="p" k="notes.grades.assumed" />
      </section>

      <section id="dialects" aria-labelledby="dialects-heading">
        <T as="h2" k="notes.dialect.heading" id="dialects-heading" />
        <p>
          <T k="notes.dialect.lead" /> <span class="dialect"><T k="dialect.sentence" /></span>.
        </p>
      </section>

      <section id="versions" aria-labelledby="versions-heading">
        <T as="h2" k="notes.versions.heading" id="versions-heading" />
        <dl class="facts">
          <T as="dt" k="notes.versions.engine" />
          <dd>{ready ? <Label>{ready.engine_version}</Label> : <T k="app.loading" />}</dd>
          <T as="dt" k="notes.versions.schema" />
          <dd>{ready ? <Label>{ready.schema_version}</Label> : <T k="app.loading" />}</dd>
        </dl>
        <T as="p" k="notes.versions.same" />
      </section>

      <section id="check-reach" aria-labelledby="check-reach-heading">
        <T as="h2" k="notes.check.heading" id="check-reach-heading" />
        <T as="p" k="notes.check.reach" />
        <T as="p" k="notes.check.other" />
      </section>

      <section id="flag-table" aria-labelledby="flag-table-heading">
        <T as="h2" k="notes.flags.heading" id="flag-table-heading" />
        <T as="p" k="notes.flags.lead" />
        {ready && <FlagTable ready={ready} />}
      </section>
    </>
  );
}
