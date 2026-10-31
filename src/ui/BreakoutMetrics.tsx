import { hasKey } from "../i18n/index.ts";
import type { Key } from "../i18n/index.ts";
import type { BreakoutRow } from "../protocol.ts";
import { cellOf, groupMetrics, hoursText } from "./breakout_view.ts";
import { fmt } from "./results_view.ts";
import { Label, T } from "./T.tsx";

// The six extension metrics of one architecture for one seed (lab_ui.md sections 3 and 20; spec section 8 and 11.6, rule S10 of 11.8.2). Each figure is a count over its denominator in words; a
// row that is not reachable says so and carries no number; recall always comes with precision and the false-alarm rate of its direction; nothing is combined and nothing is ordered. All of it is
// an output, so the screen puts it inside a result block (invariant 3).

/** One figure: the count over the denominator and its value, a time in hours, or the status in words. The denominator and the reason are the report's own words (engine strings). */
export function MetricCell({ row }: { row: BreakoutRow }) {
  const cell = cellOf(row);
  return (
    <div class="bo-cell" data-metric={row.metric} data-status={row.status} data-cell={cell.kind} {...(cell.kind === "share" && { "data-num": cell.num, "data-den": cell.den })} {...(cell.kind === "undefined" && cell.den !== null && { "data-num": cell.num ?? 0, "data-den": cell.den })}>
      {cell.kind === "share" && (
        <T k="breakout.cell.share" parts={{ num: <Label>{cell.num}</Label>, den: <Label>{cell.den}</Label>, value: <Label>{fmt(cell.value)}</Label> }} />
      )}
      {cell.kind === "time" && <T k="breakout.cell.time" parts={{ hours: <Label>{hoursText(cell.seconds)}</Label> }} />}
      {(cell.kind === "undefined" || cell.kind === "not_reachable") && <T as="strong" k={`status.${row.status}`} class="status" />}
      {cell.kind === "undefined" && cell.den !== null && (
        <>
          {" "}
          <T k="breakout.cell.counts" parts={{ num: <Label>{cell.num ?? 0}</Label>, den: <Label>{cell.den}</Label> }} />
        </>
      )}
      {row.denominator && (cell.kind === "share" || (cell.kind === "undefined" && cell.den !== null)) && (
        <div class="figure-meta">
          <T k="breakout.metrics.denominator" />: <Label engine>{row.denominator}</Label>
        </div>
      )}
      {row.reason && cell.kind !== "time" && (
        <div class="figure-meta">
          <T k="breakout.metrics.reason" />: <Label engine>{row.reason}</Label>
        </div>
      )}
    </div>
  );
}

const kindKey = (kind: string): Key | null => (hasKey(`breakout.kind.${kind}`) ? (`breakout.kind.${kind}` as Key) : null);

/** The rows of one architecture, in the groups of the screen: containment by kind, identification by direction (recall, precision and false alarm together), released, retro-flag. */
export function Metrics({ rows }: { rows: readonly BreakoutRow[] }) {
  const g = groupMetrics(rows);
  return (
    <section class="bo-metrics">
      <T as="h5" k="breakout.metrics.containment" />
      <div class="bo-grid">
        {g.containment.map((c) => (
          <div key={c.kind} class="figure" data-containment={c.kind}>
            <div class="figure-name">{kindKey(c.kind) ? <T k={kindKey(c.kind) as Key} /> : <Label>{c.kind}</Label>}</div>
            <div>
              <T k="breakout.metrics.held" />: <MetricCell row={c.contained} />
            </div>
            <div>
              <T k="breakout.metrics.median" />: <MetricCell row={c.median} />
            </div>
            <div>
              <T k="breakout.metrics.p90" />: <MetricCell row={c.p90} />
            </div>
          </div>
        ))}
      </div>
      <T as="h5" k="breakout.metrics.identification" />
      <div class="bo-grid">
        {g.identification.map((i) => (
          <div key={i.direction} class="figure" data-direction={i.direction}>
            <div class="figure-name">
              <T k="breakout.metrics.direction" /> <Label>{i.direction}</Label>
            </div>
            <div>
              <T k="detect.recall" />: <MetricCell row={i.recall} />
            </div>
            <div>
              <T k="detect.precision" />: <MetricCell row={i.precision} />
            </div>
            <div>
              <T k="detect.false_alarm" />: <MetricCell row={i.false_alarm} />
            </div>
          </div>
        ))}
      </div>
      <div class="bo-grid">
        <div class="figure" data-group="released">
          <div class="figure-name">
            <T k="breakout.metrics.released" />
          </div>
          <MetricCell row={g.released} />
        </div>
        <div class="figure" data-group="retro">
          <div class="figure-name">
            <T k="breakout.metrics.retro" />
          </div>
          <MetricCell row={g.retro} />
        </div>
      </div>
    </section>
  );
}
