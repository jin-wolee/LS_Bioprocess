import { useContext } from "preact/hooks";
import { LangContext, Label, T } from "../ui/T.tsx";
import { FlagCells } from "./FlagList.tsx";
import type { FlagMatrix } from "./flags_board.ts";
import type { PlantObject } from "./view.ts";

// The objects list (docs/design/plant_ui.md section 9): a DOM list of every object of interest, so that the plant can be operated without aiming at a 3D object. Each entry is a button that brings
// the camera to the object and, for a reactor, an analyzer or an operator, opens its panel (P5b); without a scene (no WebGL, or the scene still loading) the same list is shown as plain text, so it is
// always the full list of what the floor holds. A sampling board (P6a) brings the camera to the board and opens the form that moves a draw, on its bay. The flags board (P6b) is one object whose button
// brings the camera to it, and under it the matrix has a button for each cell: the keyboard's way to the flag form on that hall and flag.

const KINDS = ["reactor", "analyzer", "staff", "hall", "board", "flags", "lot", "equipment", "confirm"] as const;
// the three kinds of a break-out case (P7c) have a group only when the plan has one of them
const ITEMS: readonly string[] = ["lot", "equipment", "confirm"];

export function ObjectsList({ objects, onLook, matrix, onCell }: { objects: readonly PlantObject[]; onLook: ((key: string) => void) | null; matrix: FlagMatrix | null; onCell: ((hall: number, flag: string) => void) | null }) {
  const lang = useContext(LangContext);
  return (
    <section id="plant-objects" class="plant-objects" aria-labelledby="plant-objects-heading">
      <T as="h2" k="plant.objects.heading" id="plant-objects-heading" />
      <T as="p" k="plant.objects.lead" />
      {KINDS.filter((kind) => !ITEMS.includes(kind) || objects.some((o) => o.kind === kind)).map((kind) => (
        <div key={kind} class="plant-object-group">
          <T as="h3" k={`plant.kind.${kind}`} />
          <ul class="plant-object-list" data-object-list={kind}>
            {objects
              .filter((o) => o.kind === kind)
              .map((o) => (
                <li key={o.key}>
                  {onLook ? (
                    <button type="button" data-object-kind={o.kind} data-object-key={o.key} onClick={() => onLook(o.key)}>
                      <T k="plant.objects.look" parts={{ name: <Label>{o.id}</Label> }} />
                    </button>
                  ) : (
                    <span data-object-kind={o.kind} data-object-key={o.key}>
                      <Label>{o.id}</Label>
                    </span>
                  )}
                </li>
              ))}
          </ul>
          {kind === "flags" && matrix && onCell && <FlagCells matrix={matrix} onCell={onCell} lang={lang} />}
        </div>
      ))}
    </section>
  );
}
