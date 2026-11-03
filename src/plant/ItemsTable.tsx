import { Label, T } from "../ui/T.tsx";
import type { ScenePlan } from "../protocol.ts";
import { Time } from "./PanelParts.tsx";
import { confirmOf, equipmentOf, lotOf } from "./panels_items.ts";
import type { Tape } from "./items_at.ts";

// The break-out items as tables of words at the clock instant (docs/design/plant_ui.md section 9, "As built in P7c"), for the text alternative: the lots and the equipment items with their uses so far and the
// tape of the lens record, and the confirming samples with their draw and the results the lab has reported. It is the whole of the break-out scene when WebGL is missing; the tape is said in words here, as
// the shape of the band says it in the scene.

const TapeWords = ({ tape }: { tape: Tape | null }) => <T k={`plant.tape.${tape ?? "none"}` as const} />;

export function ItemsTable({ plan, at, lens }: { plan: ScenePlan; at: number; lens: string }) {
  const lots = (plan.lots ?? []).map((_, i) => lotOf(plan, i, at, lens));
  const equipment = (plan.equipment ?? []).map((_, i) => equipmentOf(plan, i, at, lens));
  const confirming = plan.samples.flatMap((s, i) => (s.kind === "confirm" && !s.skipped ? [confirmOf(plan, i, at)] : []));
  return (
    <>
      <div class="plant-table-wrap">
        <table class="plant-table" data-plant-table="items">
          <T as="caption" k="plant.table.items" />
          <thead>
            <tr>
              <T as="th" k="plant.col.item" />
              <T as="th" k="plant.col.kind" />
              <T as="th" k="plant.col.used" />
              <T as="th" k="plant.col.tape" />
            </tr>
          </thead>
          <tbody>
            {[...lots, ...equipment].map((p) => (
              <tr key={`${p.kind}:${p.id}`} data-object-row={`${p.kind}:${p.id}`}>
                <td><Label>{p.id}</Label></td>
                <td>{p.kind === "lot" ? <T k={`plant.lot.kind.${p.lot_kind}` as const} /> : <T k="plant.kind.equipment.one" />}</td>
                <td data-cell="used"><Label>{p.used}</Label></td>
                <td data-cell="tape"><TapeWords tape={p.tape} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div class="plant-table-wrap">
        <table class="plant-table" data-plant-table="confirms">
          <T as="caption" k="plant.table.confirms" />
          <thead>
            <tr>
              <T as="th" k="plant.col.sample" />
              <T as="th" k="plant.col.unit" />
              <T as="th" k="plant.col.drawn" />
              <T as="th" k="plant.col.results" />
            </tr>
          </thead>
          <tbody>
            {confirming.map((p) => (
              <tr key={p.id} data-object-row={`confirm:${p.id}`}>
                <td><Label>{p.id}</Label></td>
                <td><Label>{p.unit}</Label></td>
                <td><Time t={p.drawn_s} /></td>
                <td data-cell="results">
                  {p.tests.map((x) => (
                    <div key={x.test} data-test-outcome={x.outcome ?? "pending"}>
                      {x.outcome === null ? (
                        <T k="plant.panel.test.pending" parts={{ test: <Label>{x.test}</Label> }} />
                      ) : (
                        <T k="plant.panel.test" parts={{ test: <Label>{x.test}</Label>, outcome: <T k={`plant.confirm.${x.outcome}` as const} />, clock: <Time t={x.result_s} /> }} />
                      )}
                    </div>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
