import type { ComponentChildren } from "preact";
import { hasKey } from "../i18n/index.ts";
import { RangeBar } from "./RangeBar.tsx";
import { fmt } from "./results_view.ts";
import type { ReportRow } from "./results_view.ts";
import { Label, T } from "./T.tsx";

/** The name of a metric: its translated label, or the path the engine gave it until the dictionary has an entry (the engine adds a metric; the dictionary follows). */
export function MetricName({ path }: { path: string }) {
  const key = `metric.${path}`;
  return hasKey(key) ? <T k={key} /> : <Label>{path}</Label>;
}

/** The name of an error type: a dictionary key (`error.<type>`), or the type as the engine names it. */
export function ErrorTypeName({ type }: { type: string }) {
  const key = `error.${type}`;
  return hasKey(key) ? <T k={key} /> : <Label>{type}</Label>;
}

/**
 * One figure of a report (lab_ui.md section 3): the median with the percentile range across seeds, the seeds that define it, its denominator, its status with the reason in words, and a
 * range bar. A row with no number says why instead (`status`), never a zero. All of it is an output, so the screen puts it inside a result block (invariant 3).
 */
export function Figure({ name, row, max, label }: { name: ComponentChildren; row: ReportRow; max: number; label: string }) {
  return (
    <div class="figure" data-metric={row.metric} data-status={row.status}>
      <div class="figure-name">{name}</div>
      {row.status === "reported" && row.median !== null && row.lo !== null && row.hi !== null ? (
        <div class="figure-value">
          <T k="results.fig.median" />{" "}<strong><Label>{fmt(row.median)}</Label></strong>, <T k="results.fig.range" />{" "}<Label>{fmt(row.lo)}</Label>–<Label>{fmt(row.hi)}</Label>
        </div>
      ) : (
        <div class="figure-value">
          <T as="strong" k={`status.${row.status}`} class="status" />
          {row.reason && (
            <>
              {" "}
              <T k="results.fig.reason" />: <Label engine>{row.reason}</Label>
            </>
          )}
        </div>
      )}
      <RangeBar row={row} max={max} name={label} />
      <div class="figure-meta">
        <T k="results.fig.seeds" />: <T k="results.fig.seeds.of" parts={{ defined: <Label>{row.n_defined}</Label>, total: <Label>{row.n_seeds}</Label> }} />
        {row.denominator && (
          <>
            {" · "}
            <T k="results.fig.denominator" />: <Label engine>{row.denominator}</Label>
            {row.den && (
              <>
                {" "}
                <T k="results.fig.denominator.count" parts={{ count: <Label>{fmt(row.den.median)}</Label> }} />
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
