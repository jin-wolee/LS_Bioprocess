import { CheckScope } from "./CheckPanel.tsx";
import { FlagTable } from "./Flags.tsx";
import { Ref } from "./Ref.tsx";
import { holdParts } from "./hold_parts.tsx";
import type { ReadyInfo } from "./state.ts";
import { Label, T } from "./T.tsx";

// Notes (lab_ui.md section 3): what the numbers are and are not. Scope and non-goals (spec section 10), the grades and the provisional chip, the dialect sentence of ADR-0014 rule R3, the
// versions, the reach of the browser check, and the flag table of ADR-0005 as dictionary text. Static text: no number appears here except through a label.

const SCOPE = ["notes.scope.synthetic", "notes.scope.predict", "notes.scope.claims", "notes.scope.score", "notes.scope.server"] as const;
const GRADES = ["grade.S", "grade.P", "grade.D", "grade.A"] as const;
const READING = ["notes.reading.construct", "notes.reading.spread"] as const;

export function Notes({ ready }: { ready: ReadyInfo | null }) {
  const minimum = ready?.evaluation.find((e) => e.name === "min_seeds");
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

      <section id="reading" aria-labelledby="reading-heading">
        <T as="h2" k="notes.reading.heading" id="reading-heading" />
        {READING.map((k) => (
          <T key={k} as="p" k={k} />
        ))}
        <T as="p" k="notes.reading.seeds" parts={{ min: <Ref ids={[minimum?.ref ?? "A103"]}>{minimum ? `${minimum.value} ${minimum.unit}` : <Label>A103</Label>}</Ref> }} />
      </section>

      <section id="hold-rule" aria-labelledby="hold-rule-heading">
        <T as="h2" k="notes.hold.heading" id="hold-rule-heading" />
        <T as="p" k="notes.hold.text" parts={holdParts(ready?.evaluation ?? [])} />
      </section>

      <section id="audit-labels" aria-labelledby="audit-labels-heading">
        <T as="h2" k="notes.audit.heading" id="audit-labels-heading" />
        <T as="p" k="notes.audit.trail" />
        <T as="p" k="notes.audit.label" />
      </section>

      <section id="breakout-reading" aria-labelledby="breakout-reading-heading">
        <T as="h2" k="notes.breakout.heading" id="breakout-reading-heading" />
        <T as="p" k="notes.breakout.hold" />
        <T as="p" k="notes.breakout.tests" />
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
        <CheckScope />
        <T as="p" k="notes.check.other" />
      </section>

      <section id="flag-table" aria-labelledby="flag-table-heading">
        <T as="h2" k="notes.flags.heading" id="flag-table-heading" />
        <T as="p" k="notes.flags.lead" />
        {ready && <FlagTable ready={ready} />}
      </section>

      <section id="more-reading" aria-labelledby="more-reading-heading">
        <T as="h2" k="notes.more.heading" id="more-reading-heading" />
        <ul>
          <li><a href="https://github.com/jin-wolee/LS_Bioprocess"><T k="notes.more.repo" /></a></li>
          <li><a href="https://github.com/jin-wolee/LS_Bioprocess/tree/main/docs/design"><T k="notes.more.design" /></a></li>
          <li><a href="https://github.com/jin-wolee/LS_Bioprocess/tree/main/docs/adr"><T k="notes.more.adr" /></a></li>
          <li><a href="https://github.com/jin-wolee/LS_Bioprocess/tree/main/docs/research"><T k="notes.more.research" /></a></li>
        </ul>
      </section>
    </>
  );
}
