import type { ExperimentReport } from "../../engine/src/generated/experiment_report.schema";
import type { Key } from "../i18n/index.ts";
import type { CheckState } from "../protocol.ts";
import { ErrorBlock } from "./ErrorBlock.tsx";
import { Figure, MetricName } from "./Figure.tsx";
import { FlagName } from "./Flags.tsx";
import { Ref } from "./Ref.tsx";
import { ResultBlock } from "./ResultBlock.tsx";
import { Detection, Interval } from "./Results.tsx";
import { RunStatus } from "./RunStatus.tsx";
import { holdParts } from "./hold_parts.tsx";
import { QUESTIONS, answerOf, oneFlagForm, oneFlagLink } from "./one_flag.ts";
import type { Answer, Column, QuestionId } from "./one_flag.ts";
import { axisMax } from "./results_view.ts";
import { displayedCheck } from "./state.ts";
import type { ReadyInfo, ResultInfo, State } from "./state.ts";
import { Label, T } from "./T.tsx";

// The card "What one stored timestamp changes" on Home (docs/design/lab_ui.md section 26; A3): a title, one sentence and a Run button that asks the Worker for one run on the reader's click only; while
// it runs a progress and a Cancel; then the answer, three questions with the two records side by side in the order of the run spec, every figure through the component and the labels of Results and
// all of it inside one "Simulation result" block. No text here orders the records or states a result; no number is computed here.

type Block = ExperimentReport["architectures"][number];

const TITLE: Record<QuestionId, Key> = { mismatch: "oneflag.q.mismatch", detection: "oneflag.q.detection", cost: "oneflag.q.cost" };
const NOTE: Record<QuestionId, Key> = { mismatch: "oneflag.q.mismatch.note", detection: "oneflag.q.detection.note", cost: "oneflag.cost.note" };

/** The head of a record: its id, what kind of record it is and, for the one with a flag off, the flag. */
function ColumnHead({ block, id }: { block: Block; id: string }) {
  return (
    <h4 id={id} class="flag-col-head">
      <Label>{block.id}</Label> <T k={block.role === "ablation" ? "results.arch.ablation" : "results.arch.preset"} class="chip" />
      {block.ablated_flag && (
        <>
          {" "}
          <FlagName flag={block.ablated_flag} />
        </>
      )}
    </h4>
  );
}

/** The rows asked for, each through `Figure` as Results shows it; a row the report lacks says so and is never a zero. */
function Rows({ column, metrics, blocks }: { column: Column; metrics: readonly string[]; blocks: Block[] }) {
  return (
    <div class="figures">
      {metrics.map((metric, i) => {
        const row = column.rows[i];
        return row ? (
          <Figure key={metric} name={<MetricName path={metric} />} row={row} max={axisMax(blocks, metric)} label={`${column.block.id}, ${metric}`} />
        ) : (
          <div key={metric} class="figure" data-metric={metric} data-status="missing">
            <div class="figure-name">
              <MetricName path={metric} />
            </div>
            <div class="figure-value">
              <T k="results.fig.none" class="status" />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** One question: its title and note, then the records side by side in the order given (the order of the run spec). */
export function OneFlagQuestion({ answer, blocks, ready }: { answer: Answer; blocks: Block[]; ready: ReadyInfo }) {
  const question = QUESTIONS.find((q) => q.id === answer.id);
  const metrics = question && "metrics" in question ? question.metrics : [];
  const cost = answer.id === "cost";
  return (
    <section class="flag-q" data-question={answer.id} aria-labelledby={`flag-q-${answer.id}`}>
      <T as="h3" k={TITLE[answer.id]} id={`flag-q-${answer.id}`} />
      <T as="p" k={NOTE[answer.id]} {...(cost ? { class: "notice", "data-note": "cost" } : { class: "flag-note" })} />
      {cost && <T as="p" k="results.hold_limit.lead" parts={holdParts(ready.evaluation)} />}
      <div class="flag-pair">
        {answer.columns.map((column) => (
          <div key={column.block.id} class="flag-col" data-architecture={column.block.id} role="group" aria-labelledby={`flag-${answer.id}-${column.block.id}`}>
            <ColumnHead block={column.block} id={`flag-${answer.id}-${column.block.id}`} />
            {cost && column.rows[0]?.status === "not_evaluable" && <T as="p" k="results.hold_limit.cannot" class="notice" data-note="hold-limit-cannot" />}
            {column.group ? (
              <Detection group={column.group} blocks={blocks} name={column.block.id} />
            ) : (
              <Rows column={column} metrics={metrics} blocks={blocks} />
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

/** The answer: one result block (scenario, seeds, engine, records, the browser check), the line that says what the range is, the three questions, and the link that opens Setup with this run's settings. */
export function OneFlagAnswer({ result, ready, check }: { result: ResultInfo; ready: ReadyInfo; check: CheckState }) {
  const report = result.report as ExperimentReport;
  const minimum = ready.evaluation.find((e) => e.name === "min_seeds");
  const link = oneFlagLink(ready);
  return (
    <div class="one-flag-answer" data-one-flag-answer>
      <ResultBlock footer={result.footer} check={check}>
        {!report.meets_min_seeds && (
          <T
            as="p"
            k="results.meets.warn"
            class="notice"
            data-note="min-seeds"
            parts={{ min: <Ref ids={[minimum?.ref ?? "A103"]}>{minimum ? `${minimum.value} ${minimum.unit}` : report.min_seeds}</Ref> }}
          />
        )}
        <Interval />
        {answerOf(report, result.footer.architectures).map((answer) => (
          <OneFlagQuestion key={answer.id} answer={answer} blocks={report.architectures} ready={ready} />
        ))}
      </ResultBlock>
      {link && (
        <p>
          <a id="one-flag-setup" href={link}>
            <T k="oneflag.link" />
          </a>
        </p>
      )}
    </div>
  );
}

export function OneFlag({ state, onRun, onCancel }: { state: State; onRun: () => void; onCancel: () => void }) {
  const { ready, oneFlag } = state;
  const offered = ready !== null && oneFlagForm(ready) !== null;
  return (
    <section id="one-flag" class="one-flag" aria-labelledby="one-flag-heading">
      <T as="h2" k="oneflag.heading" id="one-flag-heading" />
      <T as="p" k="oneflag.lead" />
      <p>
        <button id="one-flag-run" type="button" class="primary" disabled={!offered || oneFlag.running !== null} onClick={onRun}>
          <T k="setup.run.button" />
        </button>
      </p>
      {oneFlag.running !== null && <RunStatus progress={oneFlag.progress} onCancel={onCancel} />}
      {oneFlag.problem && <ErrorBlock problem={oneFlag.problem} />}
      {ready && oneFlag.result?.report && <OneFlagAnswer result={oneFlag.result} ready={ready} check={displayedCheck(oneFlag.result.footer.check, state.check.state)} />}
    </section>
  );
}
