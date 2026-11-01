import { Vector3 } from "three";
import type { PerspectiveCamera } from "three";
import type { Layout } from "../layout.ts";
import type { ScenePlan } from "../../protocol.ts";

// Text in the scene is ids only (docs/design/plant_ui.md section 1), drawn as DOM overlays that follow their object, never as canvas text: no font file ships, and the page's own fonts and
// languages apply. A label is a marked element (`data-label`: an identifier, invariant 3) moved by a transform each frame the camera has moved.

export interface Labels {
  /** Moves each label to where its object is on the screen; hides one behind the camera or too far away. */
  update(camera: PerspectiveCamera, width: number, height: number): void;
  dispose(): void;
}

/** The labels of the plant: the range of unit ids over each bay, the id of each analyzer, the architecture of each record hall. */
export const buildLabels = (host: HTMLElement, layout: Layout, plan: ScenePlan): Labels => {
  const layer = document.createElement("div");
  layer.className = "plant-labels";
  layer.setAttribute("aria-hidden", "true");
  host.appendChild(layer);

  const items: { el: HTMLElement; at: Vector3 }[] = [];
  const add = (text: string, kind: string, x: number, y: number, z: number): void => {
    const el = document.createElement("span");
    el.className = `plant-label plant-label-${kind}`;
    el.setAttribute("data-label", "");
    el.textContent = text;
    layer.appendChild(el);
    items.push({ el, at: new Vector3(x, y, z) });
  };
  for (const b of layout.bays) {
    const own = plan.units.filter((u) => u.bay === b.index + 1);
    const first = own[0];
    const last = own[own.length - 1];
    if (first && last) add(first === last ? first.id : `${first.id} – ${last.id}`, "bay", b.footprint.x + b.footprint.w / 2, 2.4, b.footprint.z);
  }
  for (const a of layout.analyzers) add((plan.analyzers[a.index] as { id: string }).id, "analyzer", a.x, 2.7, a.z);
  for (const h of layout.halls) add(h.architecture, "hall", h.footprint.x + h.footprint.w / 2, h.footprint.h + 0.35, h.footprint.z + 0.2);

  const v = new Vector3();
  return {
    update(camera, width, height) {
      for (const { el, at } of items) {
        v.copy(at).project(camera);
        const far = camera.position.distanceTo(at) > 45;
        const hidden = v.z > 1 || far || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1;
        el.style.visibility = hidden ? "hidden" : "visible";
        if (!hidden) el.style.transform = `translate(${((v.x * 0.5 + 0.5) * width).toFixed(1)}px, ${((-v.y * 0.5 + 0.5) * height).toFixed(1)}px) translate(-50%, -100%)`;
      }
    },
    dispose() {
      layer.remove();
    },
  };
};
