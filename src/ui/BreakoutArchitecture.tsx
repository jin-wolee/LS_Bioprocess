import { hasKey } from "../i18n/index.ts";
import type { Key } from "../i18n/index.ts";
import type { BreakoutArchitecture, BreakoutInvestigationEvent, BreakoutResult, BreakoutWalkItem } from "../protocol.ts";
import { countsByKind, hoursText } from "./breakout_view.ts";
import { Metrics } from "./BreakoutMetrics.tsx";
import { FlagLegend } from "./Flags.tsx";
import type { ReadyInfo } from "./state.ts";
import { Label, T } from "./T.tsx";

// One architecture of the Break-out screen (lab_ui.md sections 3, 11 and 20): its flags and what they let direction 3 read, the walk-back of the first signal with the two directions and their sets,
// the six metrics and what the investigation did. Direction 3 of a record that cannot read it is "not reachable from this record", never an empty set and never a recall of 0.

const kindWord = (kind: string) => (hasKey(`breakout.kind.${kind}`) ? <T k={`breakout.kind.${kind}` as Key} /> : <Label>{kind}</Label>);

function Items({ items, name }: { items: readonly BreakoutWalkItem[]; name: string }) {
  return (
    <>
      <ul class="bo-counts" data-items={name}>
        {countsByKind(items).map((c) => (
          <li key={c.kind} data-kind={c.kind}>
            <T k="breakout.items.count" parts={{ count: <Label>{c.count}</Label>, kind: kindWord(c.kind) }} />
          </li>
        ))}
      </ul>
      {items.length > 0 && (
        <details>
          <T as="summary" k="breakout.items.show" />
          <div class="rt-wrap" tabIndex={0}>
            <table class="rt-table">
              <thead>
                <tr>
                  <T as="th" k="breakout.items.kind" />
                  <T as="th" k="breakout.items.id" />
                  <T as="th" k="breakout.items.path" />
                </tr>
              </thead>
              <tbody>
                {items.map((i, n) => (
                  <tr key={`${i.id}-${n}`}>
                    <td>
                      <Label>{i.kind}</Label>
                    </td>
                    <td>
                      <Label>{i.id}</Label>
                    </td>
                    <td>
                      <Label engine>{i.path}</Label>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </>
  );
}

export function Directions({ arch }: { arch: BreakoutArchitecture }) {
  const d3 = arch.walk.direction_3;
  return (
    <section class="bo-walk">
      <T as="h4" k="breakout.walk.heading" />
      <T as="p" k="breakout.walk.lead" />
      <dl class="facts">
        <T as="dt" k="breakout.walk.onset" />
        <dd>
          <Label>{hoursText(arch.walk.estimated_onset)}</Label>
        </dd>
        <T as="dt" k="breakout.walk.decision" />
        <dd>
          <Label>{hoursText(arch.walk.decision_at)}</Label>
        </dd>
      </dl>
      <div data-direction-set="1" data-count={arch.walk.direction_1.length}>
        <T as="h5" k="breakout.d1" parts={{ n: <Label>1</Label> }} />
        <Items items={arch.walk.direction_1} name="direction_1" />
      </div>
      <div data-direction-set="3" data-d3={d3 === null ? "not_reachable" : "set"} {...(d3 !== null && { "data-count": d3.length })}>
        <T as="h5" k="breakout.d3" parts={{ n: <Label>3</Label> }} />
        {d3 === null ? (
          <T as="p" k="breakout.d3.unreachable" class="warn" data-warn="d3-unreachable" />
        ) : (
          <>
            {d3.length === 0 && <T as="p" k="breakout.d3.empty" />}
            {arch.reach.lots && !arch.reach.equipment && <T as="p" k="breakout.d3.lots_only" />}
            {!arch.reach.lots && arch.reach.equipment && <T as="p" k="breakout.d3.equipment_only" />}
            <Items items={d3} name="direction_3" />
          </>
        )}
      </div>
    </section>
  );
}

const EVENT_TYPES: readonly string[] = ["hold_placed", "hold_quarantined", "hold_released", "hold_rejected", "result_reflagged", "deviation_closed"];

/** What an investigation event is about: the hold, the item it is on, the result a retro-flag made a version of, the deviation. Identifiers, so labels. */
export function EventDetail({ e }: { e: BreakoutInvestigationEvent }) {
  const parts = [e.hold_id, e.target_kind && e.target_id ? `${e.target_kind} ${e.target_id}` : undefined, e.result_id, e.deviation_id].filter((x): x is string => x !== undefined);
  return <Label>{parts.join(" · ")}</Label>;
}

export function Investigation({ arch }: { arch: BreakoutArchitecture }) {
  const reflagged = arch.events.filter((e) => e.type === "result_reflagged").length;
  return (
    <section class="bo-events">
      <T as="h4" k="breakout.events.heading" />
      <T as="p" k="breakout.events.lead" />
      <p data-reflagged={reflagged}>
        <T k="breakout.events.reflagged" parts={{ count: <Label>{reflagged}</Label> }} />
      </p>
      {arch.not_evaluable.map((n) => (
        <p key={n.rule} class="warn" data-warn="not-evaluable">
          <T k="breakout.notevaluable" parts={{ rule: <Label>{n.rule}</Label> }} /> <Label engine>{n.reason}</Label>
        </p>
      ))}
      {arch.events.length === 0 ? (
        <T as="p" k="breakout.events.none" />
      ) : (
        <details>
          <T as="summary" k="breakout.col.event" />
          <div class="rt-wrap" tabIndex={0}>
            <table class="rt-table" data-events={arch.architecture}>
              <thead>
                <tr>
                  <T as="th" k="breakout.col.time" />
                  <T as="th" k="breakout.col.event" />
                  <T as="th" k="breakout.col.detail" />
                </tr>
              </thead>
              <tbody>
                {arch.events.map((e, n) => (
                  <tr key={`${e.type}-${n}`} data-event={e.type}>
                    <td>
                      <Label>{hoursText(e.t)}</Label>
                    </td>
                    <td>{EVENT_TYPES.includes(e.type) ? <T k={`breakout.ev.${e.type}` as Key} /> : <Label>{e.type}</Label>}</td>
                    <td>
                      <EventDetail e={e} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </section>
  );
}

/** One architecture: heading with its role, flags, what direction 3 needs, the walk-back, the metrics and the investigation. */
export function ArchitectureBlock({ arch, result, ready }: { arch: BreakoutArchitecture; result: BreakoutResult; ready: ReadyInfo }) {
  const preset = ready.presets.find((p) => p.id === arch.architecture);
  return (
    <section class="arch" data-breakout-arch={arch.architecture} data-reach={arch.reach.direction3 ? "readable" : "not_reachable"}>
      <h3>
        <Label>{arch.architecture}</Label> <T k={preset?.role === "ablation" ? "results.arch.ablation" : "results.arch.preset"} class="chip chip-role" />
      </h3>
      <T as="h4" k="breakout.arch.legend" />
      <FlagLegend ready={ready} architecture={arch.architecture} list="breakout-column" />
      <p>
        <T
          k="breakout.needs"
          parts={{
            n: <Label>3</Label>,
            lots: (
              <code>
                <Label>{result.needs.lots}</Label>
              </code>
            ),
            equipment: (
              <code>
                <Label>{result.needs.equipment}</Label>
              </code>
            ),
          }}
        />
      </p>
      <ul class="bo-reach">
        <T as="li" k={arch.reach.lots ? "breakout.reach.lots.yes" : "breakout.reach.lots.no"} />
        <T as="li" k={arch.reach.equipment ? "breakout.reach.equipment.yes" : "breakout.reach.equipment.no"} />
      </ul>
      <Directions arch={arch} />
      <T as="h4" k="breakout.metrics.heading" />
      <Metrics rows={arch.rows} />
      <Investigation arch={arch} />
    </section>
  );
}
