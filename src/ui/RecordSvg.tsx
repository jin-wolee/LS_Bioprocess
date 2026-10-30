import { useContext } from "preact/hooks";
import { text } from "../i18n/index.ts";
import type { Key, Lang } from "../i18n/index.ts";
import type { LineageColumn, LineageView, SampleRecord } from "../protocol.ts";
import { BOX_W, BOX_X, COL_W, formatValue, layoutRecord } from "./lineage_layout.ts";
import { LangContext } from "./T.tsx";

// One lineage column drawn as SVG by the page (lab_ui.md section 8; ADR-0018: no chart library). The rows a record stores for one sample are boxes, the keys that join them are lines, an
// edge whose key is null is a stub that ends in a gap, and the three questions run along the bottom with their verdicts. Shape and text carry the meaning; colour only repeats it (ADR-0011):
// solid outline = correct; heavy outline with a cross = wrong, the truth written beside it; dashed hollow outline = a field the record does not store.

type Question = LineageColumn["answers"][number];
const QUESTION_KEY = { unit: "lineage.q.unit", sampled_at: "lineage.q.sampled_at", process_context: "lineage.q.process_context" } as const satisfies Record<Question["question"], Key>;
const ANSWER_H = 52;
const ANSWER_GAP = 10;

const contextText = (lang: Lang, c: { feed_epoch: number; batch_phase: string }): string => text(lang, "lineage.context.value", { epoch: String(c.feed_epoch), phase: c.batch_phase });

/** An answer or a truth as the text the picture shows; null is a field the record does not store. */
const shown = (lang: Lang, question: Question["question"], value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (question === "process_context") return contextText(lang, value as { feed_epoch: number; batch_phase: string });
  return String(formatValue(value as string | number));
};

const truthOf = (lang: Lang, question: Question["question"], truth: LineageView["truth"]): string =>
  question === "unit" ? truth.unit_id : question === "sampled_at" ? String(truth.sampled_at) : contextText(lang, truth.context);

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function Answer({ a, y, truth, architecture, lang }: { a: Question; y: number; truth: LineageView["truth"]; architecture: string; lang: Lang }) {
  const answer = shown(lang, a.question, a.answer);
  const word = text(lang, `lineage.verdict.${a.verdict}`);
  const body = a.verdict === "unanswerable" ? text(lang, "lineage.null") : a.verdict === "wrong" ? text(lang, "lineage.verdict.wrong.truth", { truth: truthOf(lang, a.question, truth) }) : word;
  return (
    <g class={`lg-answer v-${a.verdict}`} data-answer={JSON.stringify(a.answer)} data-question={a.question} data-verdict={a.verdict} data-architecture={architecture} transform={`translate(${BOX_X} ${y})`}>
      <title>{text(lang, "lineage.svg.answer", { question: text(lang, QUESTION_KEY[a.question]) })}</title>
      <rect class="lg-answer-box" width={BOX_W} height={ANSWER_H} rx="6" />
      <text class="lg-muted" x="8" y="16" data-i18n={QUESTION_KEY[a.question]}>{clip(text(lang, QUESTION_KEY[a.question]), 46)}</text>
      <text class="lg-value" x="8" y="33">{a.verdict === "unanswerable" ? "" : clip(answer ?? "", 40)}</text>
      <text class={`lg-verdict lg-verdict-${a.verdict}`} x="8" y="47" data-i18n={a.verdict === "wrong" ? "lineage.verdict.wrong.truth" : a.verdict === "unanswerable" ? "lineage.null" : `lineage.verdict.${a.verdict}`}>{clip(body, 46)}</text>
      {a.verdict === "wrong" && <path class="lg-cross" d={`M${BOX_W - 28} 10 l16 16 M${BOX_W - 12} 10 l-16 16`} />}
    </g>
  );
}

export function RecordSvg({ column, sample, truth }: { column: SampleRecord & Partial<Pick<LineageColumn, "answers">>; sample: string; truth?: LineageView["truth"] }) {
  const lang = useContext(LangContext);
  const laid = layoutRecord(column);
  const answers = column.answers ?? [];
  const top = laid.height + 30;
  const height = answers.length > 0 && truth ? top + answers.length * (ANSWER_H + ANSWER_GAP) : laid.height + 4;
  return (
    <svg class="lg-svg" viewBox={`0 0 ${COL_W} ${Math.max(height, 20)}`} role="img" data-lineage-column={column.architecture} data-sample={sample} aria-labelledby={`lg-t-${column.architecture}`}>
      <title id={`lg-t-${column.architecture}`}>{text(lang, "lineage.svg.title", { architecture: column.architecture })}</title>
      <defs>
        <marker id="lg-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
          <path class="lg-arrow" d="M0 0 L8 4 L0 8 z" />
        </marker>
      </defs>
      {laid.edges.map((e, i) => (
        <path key={i} class={`lg-edge${e.dashed ? " lg-edge-dashed" : ""}`} data-relation={e.relation} data-from={e.from} data-to={e.to} marker-end="url(#lg-arrow)" d={`M${BOX_X} ${e.y1} H${e.laneX} V${e.y2} H${BOX_X - 1}`} />
      ))}
      {laid.boxes.map((b) => (
        <g key={b.id} class={`lg-node lg-node-${b.table}`} data-node={b.id} data-table={b.table} transform={`translate(${b.x} ${b.y})`}>
          <title>{`${b.table} ${b.key}`}</title>
          {b.incoming !== "" && <text class="lg-muted lg-incoming" x="0" y="-7">{clip(b.incoming, 46)}</text>}
          <rect class="lg-box" width={b.w} height={b.h} rx="5" />
          <text class="lg-head" x="8" y="15">{clip(`${b.table} · ${b.key}`, 42)}</text>
          {b.lines.map((l, i) => (
            <g key={l.name} data-field={l.name} {...(l.value === null && { "data-null": "" })} transform={`translate(0 ${28 + i * 15})`}>
              <text class="lg-muted" x="8" y="0">{l.name}</text>
              {l.value === null ? (
                <text class="lg-null" x="132" y="0" data-i18n="lineage.null">{text(lang, "lineage.null")}</text>
              ) : (
                <text class="lg-value" x="132" y="0">{clip(l.value, 24)}</text>
              )}
            </g>
          ))}
          {b.stubs.map((relation, i) => {
            const y = 28 + (b.lines.length + i) * 15;
            return (
              <g key={relation} class="lg-stub" data-stub={relation}>
                <path class="lg-stub-line" d={`M0 ${y - 4} h-16`} />
                <circle class="lg-stub-gap" cx="-20" cy={y - 4} r="3" />
                <text class="lg-null" x="8" y={y} data-i18n="lineage.stub">{clip(`${relation}: ${text(lang, "lineage.stub")}`, 46)}</text>
              </g>
            );
          })}
        </g>
      ))}
      {truth && answers.map((a, i) => <Answer key={a.question} a={a} y={top + i * (ANSWER_H + ANSWER_GAP)} truth={truth} architecture={column.architecture} lang={lang} />)}
    </svg>
  );
}
