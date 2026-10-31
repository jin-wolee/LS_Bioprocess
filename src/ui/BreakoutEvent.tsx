import { hasKey } from "../i18n/index.ts";
import type { Key } from "../i18n/index.ts";
import type { BreakoutObserved, BreakoutResult } from "../protocol.ts";
import { hoursText } from "./breakout_view.ts";
import { Ref } from "./Ref.tsx";
import { Label, T } from "./T.tsx";

// The scripted event, the inputs printed with it, the topology and what the plant showed (lab_ui.md sections 3 and 20; spec 11.7, 11.8.12 C40). Every input carries its ledger id (<Ref>); the
// words of the report (what an input is) are engine strings and are shown verbatim in a lang="en" element. All of it is an output, so the screen puts it inside a result block.

const word = (prefix: string, value: string) => (hasKey(`${prefix}.${value}`) ? <T k={`${prefix}.${value}` as Key} /> : <Label>{value}</Label>);

export function EventFacts({ result }: { result: BreakoutResult }) {
  const e = result.event;
  return (
    <section data-breakout-event class="bo-event">
      <T as="h3" k="breakout.event.heading" />
      <T as="p" k="breakout.event.note" />
      <dl class="facts">
        <T as="dt" k="breakout.event.type" />
        <dd data-event-type={e.type}>{word("breakout.type", e.type)}</dd>
        <T as="dt" k="breakout.event.origin" />
        <dd data-origin-kind={e.origin_kind}>{word("breakout.origin", e.origin_kind)}</dd>
        <T as="dt" k="breakout.event.origin.id" />
        <dd>
          <Label>{e.origin_id}</Label>
        </dd>
        <T as="dt" k="breakout.event.contaminated_at" />
        <dd>
          {e.contaminated_at ? (
            <Ref ids={[e.contaminated_at.ref]}>
              {e.contaminated_at.value} {e.contaminated_at.unit}
            </Ref>
          ) : (
            <T k="breakout.event.contaminated_at.none" />
          )}
        </dd>
        <T as="dt" k="breakout.event.horizon" />
        <dd>
          <Ref ids={[e.horizon_ref]}>{e.horizon_days} d</Ref>
        </dd>
      </dl>
    </section>
  );
}

export function Inputs({ result }: { result: BreakoutResult }) {
  return (
    <section class="inputs-printed" data-breakout-inputs>
      <T as="h3" k="breakout.inputs.heading" />
      <T as="p" k="breakout.inputs.lead" />
      <ul class="inputs">
        {result.inputs.map((i) => (
          <li key={i.name} data-input={i.name} data-source={i.source}>
            <code class="input-name">
              <Label>{i.name}</Label>
            </code>
            <Ref ids={[i.ref]}>
              {i.value} {i.unit}
            </Ref>
            <span class="figure-meta">{word("breakout.source", i.source)}</span>
            <span class="figure-meta">
              <Label engine>{i.what}</Label>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function Topology({ result }: { result: BreakoutResult }) {
  const t = result.topology;
  const uses = (list: { unit_id: string; at_h: number }[]) =>
    list.length === 0 ? (
      <T k="breakout.none" />
    ) : (
      list.map((u, n) => (
        <span key={`${u.unit_id}-${n}`}>
          {n > 0 && "; "}
          <T k="breakout.topology.use" parts={{ unit: <Label>{u.unit_id}</Label>, at: <Label>{u.at_h}</Label> }} />
        </span>
      ))
    );
  return (
    <section data-breakout-topology>
      <T as="h3" k="breakout.topology.heading" />
      <p>
        <Ref ids={[t.ref]}>
          <T k="breakout.topology.lead" />
        </Ref>
      </p>
      <T as="h4" k="breakout.topology.lots" />
      <ul class="bo-list">
        {t.lots.map((l) => (
          <li key={l.lot_id} data-lot={l.lot_id}>
            <Label>{l.lot_id}</Label> (<Label>{l.kind}</Label>), <T k="breakout.topology.prepared" parts={{ at: <Label>{l.prepared_at_h}</Label> }} />: {uses(l.uses)}
          </li>
        ))}
      </ul>
      <T as="h4" k="breakout.topology.equipment" />
      {t.equipment.length === 0 ? (
        <T as="p" k="breakout.none" />
      ) : (
        <ul class="bo-list">
          {t.equipment.map((q) => (
            <li key={q.equipment_id} data-equipment={q.equipment_id}>
              <Label>{q.equipment_id}</Label> (<Label>{q.name}</Label>): {uses(q.uses)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const detailOf = (e: BreakoutObserved): string => {
  switch (e.type) {
    case "signal_observed":
      return `${e.unit_id} · ${e.signal} ${e.limit}`;
    case "deviation_opened":
      return `${e.deviation_id} · ${e.unit_id}`;
    case "unit_stopped":
      return e.unit_id;
    case "confirm_sample_drawn":
      return `${e.sample_id} · ${e.tests.join(", ")}`;
    case "confirm_result":
      return `${e.sample_id} · ${e.test} · ${e.outcome}`;
  }
};

export function Observed({ result }: { result: BreakoutResult }) {
  return (
    <section data-breakout-observed>
      <T as="h3" k="breakout.observed.heading" />
      <T as="p" k="breakout.observed.lead" />
      <div class="rt-wrap" tabIndex={0}>
        <table class="rt-table" data-events="observed">
          <thead>
            <tr>
              <T as="th" k="breakout.col.time" />
              <T as="th" k="breakout.col.event" />
              <T as="th" k="breakout.col.detail" />
            </tr>
          </thead>
          <tbody>
            {result.observed.map((e, n) => (
              <tr key={`${e.type}-${n}`} data-event={e.type}>
                <td>
                  <Label>{hoursText(e.t)}</Label>
                </td>
                <td>
                  <T k={`breakout.ev.${e.type}` as Key} />
                </td>
                <td>
                  <Label>{detailOf(e)}</Label>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
