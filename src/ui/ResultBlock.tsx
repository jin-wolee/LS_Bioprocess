import type { ComponentChildren } from "preact";
import { ActionWords } from "../plant/ActionList.tsx";
import { ClockReading } from "../plant/ActionRefs.tsx";
import type { CheckState, ResultFooter, RunSummary } from "../protocol.ts";
import { Ref } from "./Ref.tsx";
import { instantOf } from "./results_view.ts";
import { Label, T } from "./T.tsx";

/** An output (invariant 3, lab_ui.md section 6): the label "Simulation result", then the scenario id, the seeds, the engine version, the architectures and the browser-check state it was
 *  shown under, then the counts or, for a full run, what the screen puts inside. Outputs have no ledger id of their own. A result is never worded as a fact. */
export function ResultBlock({ footer, summary, check, report = false, children }: { footer: ResultFooter; summary?: RunSummary | undefined; check: CheckState; report?: boolean; children?: ComponentChildren }) {
  return (
    <div class="result" data-result {...(report && { "data-report": "" })} data-check-state={check}>
      <T as="p" k="result.label" class="result-label" />
      <dl class="facts">
        <T as="dt" k="result.scenario" />
        <dd>
          <Label>{footer.scenario}</Label>
        </dd>
        <T as="dt" k="result.seeds" />
        <dd>
          <Label>{footer.seeds.join(", ")}</Label>
        </dd>
        <T as="dt" k="result.engine" />
        <dd>
          <Label>{footer.engine_version}</Label>
        </dd>
        <T as="dt" k="result.architectures" />
        <dd>{footer.architectures.length === 0 ? <T k="result.architectures.none" /> : <Label>{footer.architectures.join(", ")}</Label>}</dd>
        <T as="dt" k="result.check" />
        <dd class={`check-word check-word-${check}`}>
          <T k={`result.check.${check}`} />
        </dd>
      </dl>
      {summary && (
        <table class="counts">
          <thead>
            <tr>
              <T as="th" k="result.events.type" />
              <T as="th" k="result.events.count" />
            </tr>
          </thead>
          <tbody>
            {Object.entries(summary.event_counts).map(([type, count]) => (
              <tr key={type}>
                <th scope="row">
                  <Label>{type}</Label>
                </th>
                <td>{count}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <T as="th" k="result.events.total" />
              <td>{summary.events}</td>
            </tr>
          </tfoot>
        </table>
      )}
      {children}
    </div>
  );
}

/** The inputs printed with a result (lab_ui.md sections 4 and 6): the inputs of the metrics and the settings that were changed, each with its ledger id; then the two profile lists and the
 *  capture path when the spec named them (a list left out means the scenario default for every position). */
export function FooterInputs({ footer }: { footer: ResultFooter }) {
  const list = (key: "results.inputs.bays" | "results.inputs.analyzers", ids: string[] | undefined) => (
    <>
      <T as="dt" k={key} />
      <dd>{ids ? <Label>{ids.join(", ")}</Label> : <T k="results.inputs.default" />}</dd>
    </>
  );
  return (
    <section class="inputs-printed" aria-labelledby="inputs-printed-heading">
      {footer.actions && footer.actions.length > 0 && (
        <div class="results-actions" data-results-actions>
          <T as="h3" k="results.actions.heading" />
          <T as="p" k="results.actions.lead" />
          <ol class="run-actions">
            {footer.actions.map((a, i) => (
              <li key={`${i}${JSON.stringify(a)}`} data-results-action={a.kind}>
                <ActionWords action={a} />
              </li>
            ))}
          </ol>
        </div>
      )}
      <T as="h3" k="results.inputs.heading" id="inputs-printed-heading" />
      <T as="p" k="results.inputs.lead" />
      <ul class="inputs">
        {footer.inputs.map((input) => {
          const at = instantOf(input);
          return (
            <li key={input.name}>
              <code class="input-name">
                <Label>{input.name}</Label>
              </code>
              <Ref ids={[input.ref]}>
                {at === null ? (
                  <>
                    {input.value} {input.unit}
                  </>
                ) : (
                  <ClockReading t={at} />
                )}
              </Ref>
            </li>
          );
        })}
      </ul>
      <dl class="facts">
        {list("results.inputs.bays", footer.bay_profiles)}
        {list("results.inputs.analyzers", footer.analyzer_profiles)}
        <T as="dt" k="results.inputs.capture" />
        <dd>{footer.capture_path ? <Label>{footer.capture_path}</Label> : <T k="setup.capture.default" />}</dd>
      </dl>
    </section>
  );
}
