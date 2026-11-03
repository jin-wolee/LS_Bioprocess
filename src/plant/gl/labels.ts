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
  /** Labels that stay where they are put (the names and halls of the flags board, P6b): one element for each, known to the style sheet by its kind (`plant-label-<kind>`). */
  fixed(items: readonly { text: string; kind: string; x: number; y: number; z: number }[]): void;
  /** Where the figures of the staff are (in the order of the plan's `staff`; an operator who is off duty has x and z that are NaN): their id tags follow them. */
  follow(places: readonly { x: number; z: number }[]): void;
  /** The labels of the truth overlay (P5b): one element over each place given, which the caller fills; null removes them. Returns the elements, in the order of the places. */
  overlay(places: readonly { x: number; y: number; z: number }[] | null): HTMLElement[];
  /** Labels whose content and place change with the clock (P7c): `count` elements the caller fills; `set(at)` puts one at a place, `set(null)` hides it. */
  items(count: number, kind: string): { el: HTMLElement; set(at: { x: number; y: number; z: number } | null): void }[];
  /** The label of each slot of the confirmation shelf (P7c): the id of the tube and a line for each reported test, `test` and the outcome in words (a stamp is read by its shape and by its text); written again only when its content changed. */
  tubes(count: number): TubeLabels;
  dispose(): void;
}

/** The labels of the tubes of the confirmation shelf: `set(slot, at, tube)` shows the label of a slot over a place with the tube's id and stamps, `set(slot, null)` hides it; `setWords` gives the two outcomes in the page's language. */
export interface TubeLabels {
  set(slot: number, at: { x: number; y: number; z: number } | null, tube?: { id: string; stamps: readonly { test: string; outcome: "detected" | "not_detected" }[] }): void;
  setWords(words: { detected: string; not_detected: string }): void;
}

/** The labels of the plant: the range of unit ids over each bay, the id of each analyzer, the architecture of each record hall, and the id of each operator, which follows the figure. */
export const buildLabels = (host: HTMLElement, layout: Layout, plan: ScenePlan): Labels => {
  const layer = document.createElement("div");
  layer.className = "plant-labels";
  layer.setAttribute("aria-hidden", "true");
  host.appendChild(layer);

  // `clamp`: a label that grows upward from its place (the sign of a hall, with the flags it has on) is kept inside the layer instead of being cut at the top of the view (P8a); `h` is its height, measured when it changes
  type Item = { el: HTMLElement; at: Vector3; on: boolean; clamp?: boolean; h?: number };
  const items: Item[] = [];
  const add = (text: string, kind: string, x: number, y: number, z: number, on = true): Item => {
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
    item.clamp = true;
    return { architecture: h.architecture, item, id, flags };
  });

  // the sign of a sampling board has two parts: its id (always) and its first rows (when the camera is near)
  const boardSigns = layout.bays.map((b, i) => {
    const at = boardPoint(b.footprint);
    // the sign stands on the face of the board, its foot on the lower edge of the plate, and grows up over it (P8a)
    const item = add("", "board", at.x, PLINTH + BOARD.bottom + 0.04, at.z + BOARD.thick);
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
  let absences: Item[] = [];

  const v = new Vector3();
  const place = (camera: PerspectiveCamera, width: number, height: number, item: Item): void => {
    const { el, at, on } = item;
    v.copy(at).project(camera);
    const distance = camera.position.distanceTo(at);
    const far = distance > 45;
    const near = distance < 16 ? "1" : "0";
    if (el.dataset.near !== near) {
      el.dataset.near = near;
      delete item.h;
    }
    const hidden = !on || v.z > 1 || far || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1;
    el.style.visibility = hidden ? "hidden" : "visible";
    if (hidden) return;
    let y = (-v.y * 0.5 + 0.5) * height;
    if (item.clamp) y = Math.max(y, (item.h ??= el.offsetHeight) + 4);
    el.style.transform = `translate(${((v.x * 0.5 + 0.5) * width).toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
  };
  return {
    tubes(count) {
      let words = { detected: "detected", not_detected: "not detected" };
      const slots = Array.from({ length: count }, () => add("", "tube", 0, 0, 0, false));
      const written: (string | null)[] = [];
      return {
        setWords(next) {
          words = next;
          written.length = 0;
        },
        set(slot, at, tube) {
          const item = slots[slot];
          if (!item) return;
          item.on = at !== null;
          if (at) item.at.set(at.x, at.y, at.z);
          const key = tube ? JSON.stringify([tube.id, tube.stamps, words]) : null;
          if (written[slot] === key) return;
          written[slot] = key;
          const id = Object.assign(document.createElement("span"), { className: "plant-tube-id", textContent: tube?.id ?? "" });
          const lines = (tube?.stamps ?? []).map((s) => {
            const line = document.createElement("span");
            line.className = "plant-tube-stamp";
            line.dataset.stampOutcome = s.outcome;
            const test = Object.assign(document.createElement("span"), { textContent: s.test });
            test.setAttribute("data-label", "");
            line.append(test, ` · ${words[s.outcome]}`);
            return line;
          });
          item.el.replaceChildren(id, ...lines);
        },
      };
    },
    items(count, kind) {
      return Array.from({ length: count }, () => {
        const item = add("", kind, 0, 0, 0, false);
        return {
          el: item.el,
          set(at) {
            item.on = at !== null;
            if (at) item.at.set(at.x, at.y, at.z);
          },
        };
      });
    },
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
        delete sign.item.h;
      }
    },
    fixed(list) {
      for (const i of list) {
        const { el } = add(i.text, i.kind, i.x, i.y, i.z);
        // the id of a hall over a column of the flags board stands up, reading from the cells upward (P8a), so that the ids of neighbouring columns do not run into one another, a derived hall's long id included; the text of the label stays the id
        if (i.kind === "flaghall") el.replaceChildren(Object.assign(document.createElement("span"), { className: "plant-flaghall-text", textContent: i.text }));
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
