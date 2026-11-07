import type { ExperimentReport } from "../../engine/src/generated/experiment_report.schema";
import { ErrorBlock } from "./ErrorBlock.tsx";
import { FlagLegend, FlagName } from "./Flags.tsx";
import { ErrorTypeName, Figure, MetricName } from "./Figure.tsx";
import { FooterInputs, ResultBlock } from "./ResultBlock.tsx";
import { Ref } from "./Ref.tsx";
import { holdParts } from "./hold_parts.tsx";
import { RunStatus } from "./RunStatus.tsx";
import { Utilisation } from "./Utilisation.tsx";
import { axisMax, groupRows, showsLabelErrorNote } from "./results_view.ts";
import type { DetectionGroup, ReportRow } from "./results_view.ts";
import { HOME_ID, displayedCheck } from "./state.ts";
import type { ReadyInfo, State } from "./state.ts";
import { Label, T } from "./T.tsx";

// Results (lab_ui.md section 3): per architecture the metrics of spec section 8 as the median over the seeds with the percentile range, the seed count, the denominator and the status of each
// row, a range bar per metric, recall always beside precision and the false-alarm rate. No composite score, no rank column and no text that orders the architectures; the report's own
// `ranks` are data the engine keeps and this screen never reads.

type Block = ExperimentReport["architectures"][number];

const DETECTION_FIELDS = ["recall", "precision", "false_alarm", "realised"] as const;

export function Detection({ group, blocks, name }: { group: DetectionGroup; blocks: Block[]; name: string }) {
  return (
    <div class="detect-type" data-error-type={group.type}>
      <h4>
        <ErrorTypeName type={group.type} />
      </h4>
      <div class="figures">
        {DETECTION_FIELDS.map((field) => {
          const row = group[field];
          return row ? <Figure key={field} name={<T k={`detect.${field}`} />} row={row} max={axisMax(blocks, row.metric)} label={`${name}, ${group.type}, ${field}`} /> : null;
        })}
      </div>
    </div>
  );
}

export function Architecture({ block, blocks, ready }: { block: Block; blocks: Block[]; ready: ReadyInfo }) {
  const rows = groupRows(block.rows);
  const flags = ready.presets.find((p) => p.id === block.id)?.flags ?? {};
  const figures = (list: ReportRow[]) => (
    <div class="figures">
      {list.map((row) => (
        <Figure key={row.metric} name={<MetricName path={row.metric} />} row={row} max={axisMax(blocks, row.metric)} label={`${block.id}, ${row.metric}`} />
      ))}
    </div>
  );
  return (
    <section class="arch" data-architecture={block.id} aria-labelledby={`arch-${block.id}`}>
      <h2 id={`arch-${block.id}`}>
        <Label>{block.id}</Label> <T k={block.role === "ablation" ? "results.arch.ablation" : "results.arch.preset"} class="chip" />
        {block.ablated_flag && (
          <>
            {" "}
            <FlagName flag={block.ablated_flag} />
          </>
        )}
      </h2>
      <T as="h3" k="results.arch.flags" />
      <FlagLegend ready={ready} architecture={block.id} />
      <T as="h3" k="results.group.timing" />
      {figures(rows.timing)}
      <T as="h3" k="results.group.record" />
      {figures(rows.record)}
      {rows.hold_limit.length > 0 && (
        <section class="hold-limit" data-hold-limit aria-labelledby={`hold-${block.id}`}>
          <T as="h3" k="results.group.hold_limit" id={`hold-${block.id}`} />
          <T as="p" k="results.hold_limit.lead" parts={holdParts(ready.evaluation)} />
          {rows.hold_limit.every((row) => row.status === "not_evaluable") && <T as="p" k="results.hold_limit.cannot" class="notice" data-note="hold-limit-cannot" />}
          {figures(rows.hold_limit)}
        </section>
      )}
      <T as="h3" k="results.group.detection" />
      <T as="p" k="results.detection.lead" />
      {showsLabelErrorNote(flags) && (
        <T
          as="p"
          k="results.note.label_error"
          class="notice"
          data-note="label-error"
          parts={{ flag: <code><Label>system_issued_id</Label></code>, dup: <Label>VR-008b</Label>, double: <Label>VR-009</Label>, type: <code><Label>duplicate_replay</Label></code> }}
        />
      )}
      {rows.detection.map((group) => (
        <Detection key={group.type} group={group} blocks={blocks} name={block.id} />
      ))}
    </section>
  );
}

/** What lo and hi of every range are, in the language of the page (P8a: the engine's own text is English data and is not printed). */
export function Interval() {
  return (
    <p class="interval">
      <T k="results.interval.label" />: <T k="results.interval.text" />
    </p>
  );
}

export function Report({ state, ready }: { state: State; ready: ReadyInfo }) {
  const result = state.results;
  if (!result?.report) return null;
  const { report, footer } = result;
  const minimum = ready.evaluation.find((e) => e.name === "min_seeds");
  return (
    <ResultBlock footer={footer} check={displayedCheck(footer.check, state.check.state)} report>
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
      <FooterInputs footer={footer} />
      {report.architectures.map((block) => (
        <Architecture key={block.id} block={block} blocks={report.architectures} ready={ready} />
      ))}
      <Utilisation report={report} view={result.utilisation} ready={ready} />
    </ResultBlock>
  );
}

export function Results({ state, ready, onCancel }: { state: State; ready: ReadyInfo; onCancel: () => void }) {
  const problem = state.problem && state.problem.id !== HOME_ID && state.problem.code !== "worker" ? state.problem : null;
  return (
    <>
      <section aria-labelledby="results-heading">
        <T as="h1" k="results.heading" id="results-heading" />
        <T as="p" k="results.lead" />
      </section>
      {state.running !== null && <RunStatus progress={state.progress} onCancel={onCancel} />}
      {problem && <ErrorBlock problem={problem} />}
      {state.results ? (
        <Report state={state} ready={ready} />
      ) : (
        state.running === null &&
        !problem && (
          <p class="empty">
            <T k="results.empty" /> <a href="#/setup" id="to-setup"><T k="results.empty.link" /></a>
          </p>
        )
      )}
    </>
  );
}
