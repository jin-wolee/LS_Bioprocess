import { useContext } from "preact/hooks";
import { text } from "../i18n/index.ts";
import { barPositions, fmt } from "./results_view.ts";
import type { ReportRow } from "./results_view.ts";
import { LangContext } from "./T.tsx";

const WIDTH = 100;
const HEIGHT = 14;

/**
 * The range bar of a metric (lab_ui.md section 3): the spread across seeds as a bar, the median as a tick, on the axis the metric has for every architecture shown. It is a drawing of the
 * numbers printed beside it, so it carries a title and the same numbers as text; shape (a bar and a tick) carries the meaning and colour only repeats it. A row with no figure draws only the
 * axis, never a bar.
 */
export function RangeBar({ row, max, name }: { row: ReportRow; max: number; name: string }) {
  const lang = useContext(LangContext);
  const figure = row.status === "reported" && row.median !== null && row.lo !== null && row.hi !== null ? { median: row.median, lo: row.lo, hi: row.hi } : null;
  const at = figure ? barPositions(figure, max, WIDTH) : null;
  const title = figure ? text(lang, "results.bar.title", { metric: name, median: fmt(figure.median), lo: fmt(figure.lo), hi: fmt(figure.hi) }) : text(lang, "results.bar.none", { metric: name });
  return (
    <svg class="range-bar" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width={WIDTH} height={HEIGHT} role="img" aria-label={title} data-bar={figure ? "range" : "none"} preserveAspectRatio="none">
      <title>{title}</title>
      <line class="bar-axis" x1="0" y1={HEIGHT / 2} x2={WIDTH} y2={HEIGHT / 2} />
      {at && <rect class="bar-spread" x={at.lo} y="3" width={Math.max(at.hi - at.lo, 1)} height={HEIGHT - 6} />}
      {at && <line class="bar-median" x1={at.median} y1="0" x2={at.median} y2={HEIGHT} />}
    </svg>
  );
}
