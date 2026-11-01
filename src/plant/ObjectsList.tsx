import { Label, T } from "../ui/T.tsx";
import type { PlantObject } from "./view.ts";

// The objects list (docs/design/plant_ui.md section 9): a DOM list of every object of interest, so that the plant can be operated without aiming at a 3D object. Each entry is a button that brings
// the camera to the object; without a scene (no WebGL, or the scene still loading) the same list is shown as plain text, so it is always the full list of what the floor holds.

const KINDS = ["reactor", "analyzer", "hall"] as const;

export function ObjectsList({ objects, onLook }: { objects: readonly PlantObject[]; onLook: ((key: string) => void) | null }) {
  return (
    <section id="plant-objects" class="plant-objects" aria-labelledby="plant-objects-heading">
      <T as="h2" k="plant.objects.heading" id="plant-objects-heading" />
      <T as="p" k="plant.objects.lead" />
      {KINDS.map((kind) => (
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
        </div>
      ))}
    </section>
  );
}
