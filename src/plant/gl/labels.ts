import { Vector3 } from "three";
import type { PerspectiveCamera } from "three";
import { BOARD, PLINTH, boardPoint } from "../dims.ts";
import { boardId } from "../board.ts";
import type { Layout } from "../layout.ts";
import type { ScenePlan } from "../../protocol.ts";
import { STAFF_HEAD } from "./motion_staff.ts";

// Text in the scene is ids only (docs/design/plant_ui.md section 1), drawn as DOM overlays that follow their object, never as canvas text: no font file ships, and the page's own fonts and
// languages apply. A label is a marked element (`data-label`: an identifier, invariant 3) moved by a transform each frame the camera has moved.

export interface Labels {
  /** Moves each label to where its object is on the screen; hides one behind the camera or too far away. */
  update(camera: PerspectiveCamera, width: number, height: number): void;
  /** The sign of each record hall: the architecture id and, once its record has arrived, the flags it has on (ids, language-neutral; a dash for none); the lens hall carries a mark (a disc drawn by the style sheet from `data-lens`, not a glyph), the others are dimmed. */
  halls(records: readonly { architecture: string; flags_on: readonly string[] }[], lens: string): void;
  /** The rows on the sign of each board (P6a), in the order of the bays: the first few as `U03 12:50` and how many more there are. Written when the board changes, not every frame. */
  boards(boards: readonly { rows: readonly string[]; more: number }[]): void;
  /** Where the figures of the staff are (in the order of the plan's `staff`; an operator who is off duty has x and z that are NaN): their id tags follow them. */
  follow(places: readonly { x: number; z: number }[]): void;
  /** The labels of the truth overlay (P5b): one element over each place given, which the caller fills; null removes them. Returns the elements, in the order of the places. */
  overlay(places: readonly { x: number; y: number; z: number }[] | null): HTMLElement[];
  dispose(): void;
}

/** The labels of the plant: the range of unit ids over each bay, the id of each analyzer, the architecture of each record hall, and the id of each operator, which follows the figure. */
export const buildLabels = (host: HTMLElement, layout: Layout, plan: ScenePlan): Labels => {
  const layer = document.createElement("div");
  layer.className = "plant-labels";
  layer.setAttribute("aria-hidden", "true");
  host.appendChild(layer);

  const items: { el: HTMLElement; at: Vector3; on: boolean }[] = [];
  const add = (text: string, kind: string, x: number, y: number, z: number, on = true): (typeof items)[number] => {
    const el = document.createElement("span");
    el.className = `plant-label plant-label-${kind}`;
    el.setAttribute("data-label", "");
    el.textContent = text;
    layer.appendChild(el);
    const item = { el, at: new Vector3(x, y, z), on };
    items.push(item);
    return item;
  };
  for (const b of layout.bays) {
    const own = plan.units.filter((u) => u.bay === b.index + 1);
    const first = own[0];
    const last = own[own.length - 1];
    if (first && last) add(first === last ? first.id : `${first.id} – ${last.id}`, "bay", b.footprint.x + b.footprint.w / 2, 2.4, b.footprint.z);
  }
  for (const a of layout.analyzers) add((plan.analyzers[a.index] as { id: string }).id, "analyzer", a.x, 2.7, a.z);
  // a hall sign has two parts: the id (always) and the flags on (when the record has arrived and the camera is near); the lens hall wears a mark in front of its id
  const signs = layout.halls.map((h) => {
    const item = add("", "hall", h.footprint.x + h.footprint.w / 2, h.footprint.h + 0.35, h.footprint.z + 0.2);
    const id = document.createElement("span");
    id.className = "plant-hall-id";
    id.textContent = h.architecture;
    const flags = document.createElement("span");
    flags.className = "plant-hall-flags";
    item.el.append(id, flags);
    return { architecture: h.architecture, item, id, flags };
  });

  // the sign of a sampling board has two parts: its id (always) and its first rows (when the camera is near)
  const boardSigns = layout.bays.map((b, i) => {
    const at = boardPoint(b.footprint);
    const item = add("", "board", at.x, PLINTH + BOARD.bottom + BOARD.h + 0.12, at.z);
    const id = document.createElement("span");
    id.className = "plant-board-id";
    id.textContent = boardId(i);
    const rows = document.createElement("span");
    rows.className = "plant-board-lines";
    item.el.append(id, rows);
    return rows;
  });

  const staff = plan.staff.map((s) => add(s.id, "staff", 0, STAFF_HEAD, 0, false));
  // the labels of the truth overlay: made when the overlay is switched on, removed when it is switched off
  let absences: { el: HTMLElement; at: Vector3; on: boolean }[] = [];

  const v = new Vector3();
  const place = (camera: PerspectiveCamera, width: number, height: number, { el, at, on }: { el: HTMLElement; at: Vector3; on: boolean }): void => {
    v.copy(at).project(camera);
    const distance = camera.position.distanceTo(at);
    const far = distance > 45;
    const near = distance < 16 ? "1" : "0";
    if (el.dataset.near !== near) el.dataset.near = near;
    const hidden = !on || v.z > 1 || far || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1;
    el.style.visibility = hidden ? "hidden" : "visible";
    if (!hidden) el.style.transform = `translate(${((v.x * 0.5 + 0.5) * width).toFixed(1)}px, ${((-v.y * 0.5 + 0.5) * height).toFixed(1)}px) translate(-50%, -100%)`;
  };
  return {
    overlay(places) {
      for (const a of absences) a.el.remove();
      absences = (places ?? []).map((p) => {
        const el = document.createElement("span");
        el.className = "plant-label plant-label-absence";
        layer.appendChild(el);
        return { el, at: new Vector3(p.x, p.y, p.z), on: true };
      });
      return absences.map((a) => a.el);
    },
    halls(records, lens) {
      for (const sign of signs) {
        const record = records.find((r) => r.architecture === sign.architecture);
        sign.flags.textContent = record ? (record.flags_on.length === 0 ? "–" : record.flags_on.join(" · ")) : "";
        sign.item.el.dataset.lens = sign.architecture === lens ? "1" : "0";
      }
    },
    boards(boards) {
      for (const [i, rows] of boardSigns.entries()) {
        const b = boards[i];
        const lines = b ? [...b.rows, ...(b.more > 0 ? [`+${b.more}`] : [])] : [];
        rows.replaceChildren(...lines.map((line) => Object.assign(document.createElement("span"), { textContent: line })));
      }
    },
    follow(places) {
      for (const [i, item] of staff.entries()) {
        const p = places[i];
        item.on = p !== undefined && !Number.isNaN(p.x);
        if (item.on && p) item.at.set(p.x, STAFF_HEAD, p.z);
      }
    },
    update(camera, width, height) {
      for (const item of items) place(camera, width, height, item);
      for (const item of absences) place(camera, width, height, item);
    },
    dispose() {
      layer.remove();
    },
  };
};
