import { hasKey } from "../i18n/index.ts";
import type { Reveal } from "../protocol.ts";
import { ErrorTypeName } from "./Figure.tsx";
import { LineageColumns, LineageTruth } from "./LineageView.tsx";
import { formatValue } from "./lineage_layout.ts";
import type { ReadyInfo } from "./state.ts";
import { Label, T } from "./T.tsx";

// The reveal (lab_ui.md section 9, "What the reveal shows"): the planted error, the score of the one guess (none after a give-up), the same planted error in A, B and C and the shown ablation
// with the reading of the flag table for the flag that decides it, for the decision variant the decisions made on the wrong input, and the lineage of the planted sample. It exists only after
// the guess or the give-up. No running score, no ranking and no effect size.

const cell = (v: string | number | null): string => (v === null ? "–" : String(formatValue(v)));

/** The kind of cause a `background` score names: a structural error type of the injector, or a value that SC8 biases by construction. */
function Background({ type }: { type: string }) {
  const key = `reveal.background.${type}`;
  return hasKey(key) ? <T k={key} /> : <ErrorTypeName type={type} />;
}

function Score({ score }: { score: Reveal["score"] }) {
  if (score === null) return <T as="p" k="reveal.score.none" data-score="none" />;
  return score.result === "background" ? (
    <T as="p" k="reveal.score.background" data-score="background" parts={{ type: <Background type={score.background_type ?? ""} /> }} />
  ) : (
    <T as="p" k={`reveal.score.${score.result}`} data-score={score.result} />
  );
}

export function RevealView({ reveal, ready, onNew }: { reveal: Reveal; ready: ReadyInfo; onNew: () => void }) {
  return (
    <section class="reveal" data-reveal aria-labelledby="reveal-heading">
      <T as="h2" k="reveal.heading" id="reveal-heading" />
      <T as="p" k="reveal.lead" />

      <T as="h3" k="reveal.planted.heading" />
      <dl class="facts" data-planted-type={reveal.planted.type}>
        <T as="dt" k="reveal.planted.type" />
        <dd>
          <ErrorTypeName type={reveal.planted.type} />
        </dd>
        <T as="dt" k="reveal.planted.affected" />
        <dd data-affected>
          {reveal.planted.affected.map((id) => (
            <span key={id}>
              <Label>{id}</Label>{" "}
            </span>
          ))}
        </dd>
        <T as="dt" k="reveal.planted.detail" />
        <dd>
          {Object.entries(reveal.planted.detail).map(([name, value]) => (
            <span key={name}>
              <code>{name}</code> <Label>{value}</Label>{" "}
            </span>
          ))}
        </dd>
      </dl>

      <T as="h3" k="reveal.score.heading" />
      <Score score={reveal.score} />
      <T as="p" k="reveal.score.note" />

      <T as="h3" k="reveal.arch.heading" />
      <T as="p" k="reveal.arch.lead" />
      <ul class="rv-archs">
        {reveal.per_architecture.map((p) => (
          <li key={p.architecture} class="rv-arch" data-outcome-architecture={p.architecture} data-outcome={p.outcome} data-evidence={p.evidence.join("+")}>
            <h4>
              <Label>{p.architecture}</Label>
            </h4>
            {p.outcome === "detected" ? (
              <T k="reveal.outcome.detected" parts={{ rules: <Label>{p.evidence.join(", ")}</Label> }} />
            ) : (
              <T k={`reveal.outcome.${p.outcome}`} />
            )}
            {hasKey(p.reading) && (
              <p class="rv-reading" data-reading={p.reading}>
                <T k={p.reading} />
              </p>
            )}
            {p.decision_same !== undefined && <T as="p" k={p.decision_same ? "reveal.decision.same" : "reveal.decision.changed"} data-decision-same={String(p.decision_same)} />}
          </li>
        ))}
      </ul>

      {reveal.decisions && (
        <section class="rv-decisions" data-reveal-decisions aria-labelledby="rv-decisions-heading">
          <T as="h3" k="reveal.decisions.heading" id="rv-decisions-heading" />
          <T as="p" k="reveal.decisions.lead" />
          {reveal.decisions.rows.length === 0 ? (
            <T as="p" k="reveal.decisions.none" />
          ) : (
            <ul class="rv-rows">
              {reveal.decisions.rows.map((r) => (
                <li key={r.decision_id} data-decision={r.decision_id}>
                  <h4>
                    <Label>{r.decision_id}</Label>
                  </h4>
                  <dl class="facts">
                    <T as="dt" k="reveal.decisions.read_as" />
                    <dd>
                      <Label>{r.read_as}</Label>
                    </dd>
                    <T as="dt" k="reveal.decisions.from" />
                    <dd>
                      <Label>{r.from_sample}</Label>
                    </dd>
                    <T as="dt" k="reveal.decisions.value" />
                    <dd>
                      <Label>{cell(r.value)}</Label>
                    </dd>
                    <T as="dt" k="reveal.decisions.record" />
                    <dd>
                      <Label>{cell(r.record.container)}</Label> <Label>{cell(r.record.hold_s)}</Label>
                    </dd>
                    <T as="dt" k="reveal.decisions.truth" />
                    <dd>
                      <Label>{r.truth.container}</Label> <Label>{r.truth.hold_s}</Label>
                    </dd>
                  </dl>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <T as="h3" k="reveal.lineage.heading" />
      <LineageTruth view={reveal.lineage} />
      <LineageColumns view={reveal.lineage} ready={ready} />
      <p>
        <button id="challenge-new" type="button" class="primary" onClick={onNew}>
          <T k="challenge.new" />
        </button>
      </p>
    </section>
  );
}
