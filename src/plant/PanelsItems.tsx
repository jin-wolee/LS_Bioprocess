import { Fragment } from "preact";
import { Label, T } from "../ui/T.tsx";
import type { Drill } from "./drill.ts";
import { DrillLink, DrillLinks } from "./DrillLinks.tsx";
import type { Tape } from "./items_at.ts";
import { Row, Time } from "./PanelParts.tsx";
import type { ConfirmPanel, EquipmentPanel, LotPanel, ReactorItems, UseRow } from "./panels_items.ts";

// The panels of the break-out items (docs/design/plant_ui.md section 3.2, "As built in P7c"): a lot, an equipment item and a confirming sample, each with the link to the Break-out screen on the scene's case,
// and what the panel of a reactor adds in a case. The content is `panels_items.ts`; every figure here is a label and every time a clock reading, and the tape is said in words as well as drawn.

const TapeWords = ({ tape }: { tape: Tape | null }) => <T k={`plant.tape.${tape ?? "none"}` as const} />;

function Uses({ used, uses }: { used: number; uses: UseRow[] }) {
  return (
    <>
      <Row name="plant.panel.used" field="used"><Label>{used}</Label></Row>
      <T as="dt" k="plant.panel.uses" />
      <dd data-panel-field="uses">
        {uses.length === 0 ? (
          <T k="plant.panel.uses.none" />
        ) : (
          <ul class="plant-object-list" data-panel-list="uses">
            {uses.map((u) => (
              <li key={`${u.unit}-${u.t}`}>
                <T k="plant.panel.use" parts={{ unit: <Label>{u.unit}</Label>, clock: <Time t={u.t} /> }} />
              </li>
            ))}
          </ul>
        )}
      </dd>
    </>
  );
}

function Tests({ tests }: { tests: ConfirmPanel["tests"] }) {
  return (
    <>
      <T as="dt" k="plant.panel.tests" />
      <dd data-panel-field="tests">
        {tests.length === 0 ? (
          <T k="plant.panel.tests.none" />
        ) : (
          <ul class="plant-object-list" data-panel-list="tests">
            {tests.map((x) => (
              <li key={x.test} data-test-outcome={x.outcome ?? "pending"}>
                {x.outcome === null ? (
                  <T k="plant.panel.test.pending" parts={{ test: <Label>{x.test}</Label> }} />
                ) : (
                  <T k="plant.panel.test" parts={{ test: <Label>{x.test}</Label>, outcome: <T k={`plant.confirm.${x.outcome}` as const} />, clock: <Time t={x.result_s} /> }} />
                )}
              </li>
            ))}
          </ul>
        )}
      </dd>
    </>
  );
}

const BreakoutLink = ({ drill }: { drill: Drill }) =>
  drill.breakout && (
    <DrillLinks>
      <DrillLink name="breakout" href={drill.breakout()} k="plant.drill.breakout" />
    </DrillLinks>
  );

/** The panel of a lot, an equipment item or a confirming sample. */
export function ItemPanel({ p, drill }: { p: LotPanel | EquipmentPanel | ConfirmPanel; drill: Drill }) {
  return (
    <>
      <dl class="plant-facts">
        {p.kind === "lot" && <Row name="plant.panel.kind" field="kind"><T k={`plant.lot.kind.${p.lot_kind}` as const} /></Row>}
        {p.kind !== "confirm" && (
          <Fragment>
            <Uses used={p.used} uses={p.uses} />
            <Row name="plant.panel.tape" field="tape"><TapeWords tape={p.tape} /></Row>
          </Fragment>
        )}
        {p.kind === "confirm" && (
          <Fragment>
            <Row name="plant.panel.unit"><Label>{p.unit}</Label></Row>
            <Row name="plant.panel.operator" field="operator">{p.operator === null ? <T k="plant.panel.none" /> : <Label>{p.operator}</Label>}</Row>
            <Row name="plant.panel.drawn_at" field="drawn"><Time t={p.drawn_s} /></Row>
            <Tests tests={p.tests} />
          </Fragment>
        )}
      </dl>
      <BreakoutLink drill={drill} />
    </>
  );
}

/** What the panel of a reactor adds in a case, in place of the links to Lineage: the beacon, the tag and the stop with their items, the tape on the reactor, and the link to Break-out. */
export function ReactorCase({ items, drill }: { items: ReactorItems | null; drill: Drill }) {
  if (items === null) return null;
  return (
    <>
      <T as="h3" k="plant.panel.signals" />
      {items.marks.length === 0 ? (
        <T as="p" k="plant.panel.signals.none" data-note="signals" />
      ) : (
        <ul class="plant-object-list" data-panel-list="signals">
          {items.marks.map((m) => (
            <li key={`${m.kind}-${m.t}`} data-mark={m.kind}>
              {m.kind === "stopped" ? (
                <T k="plant.panel.stopped" parts={{ clock: <Time t={m.t} /> }} />
              ) : (
                <T k={m.kind === "signal" ? "plant.panel.signal" : "plant.panel.deviation"} parts={{ item: <Label>{m.item ?? ""}</Label>, clock: <Time t={m.t} /> }} />
              )}
            </li>
          ))}
        </ul>
      )}
      <dl class="plant-facts">
        <Row name="plant.panel.tape" field="tape"><TapeWords tape={items.tape} /></Row>
      </dl>
      <BreakoutLink drill={drill} />
    </>
  );
}
