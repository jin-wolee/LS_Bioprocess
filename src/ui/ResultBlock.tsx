import type { CheckState, ResultFooter, RunSummary } from "../protocol.ts";
import { Label, T } from "./T.tsx";

/** An output (invariant 3, lab_ui.md section 6): the label "Simulation result", then the scenario id, the seeds, the engine version, the architectures and the browser-check state it was
 *  shown under, then the counts. Outputs have no ledger id of their own. A result is never worded as a fact. */
export function ResultBlock({ footer, summary, check }: { footer: ResultFooter; summary?: RunSummary | undefined; check: CheckState }) {
  return (
    <div class="result" data-result data-check-state={check}>
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
    </div>
  );
}
