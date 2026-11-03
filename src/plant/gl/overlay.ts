import { DynamicDrawUsage, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, PlaneGeometry, ShaderMaterial } from "three";
import type { Group, Material } from "three";
import type { ScenePlan } from "../../protocol.ts";
import type { Layout } from "../layout.ts";
import { railsAt, tagBox } from "../placeholders.ts";
import type { RailView } from "../placeholders.ts";
import type { OverlayData } from "../scene_types.ts";
import type { Labels } from "./labels.ts";

// The truth overlay of the scene (docs/design/plant_ui.md section 3.3, "As built in P5b"): the placeholders on the rail on top of each record hall's wall, and the DOM label of each rail. Nothing here is
// built until the reader switches the overlay on and the Worker has answered; `set(null)` removes it all. A placeholder is the outline of a card, dashed and hollow, with a slash through it for a draw the
// volume budget skipped; it stands on the rail in order of the instant the plant produced the row and never moves (`placeholders.ts`). The tags are one instanced mesh (a draw call), the halls that are not
// the lens are dimmed as their cards are, and the label of each rail names the architecture that holds none, how many tags stand on it now, and carries the sentence of the label.

const VERTEX = `
attribute vec3 iPos;
attribute vec2 iSize;
attribute vec2 iLook;
varying vec2 vLocal;
varying vec2 vSize;
varying vec2 vLook;
void main() {
  vec2 local = vec2(position.x * iSize.x, (position.y + 0.5) * iSize.y);
  vLocal = local;
  vSize = iSize;
  vLook = iLook;
  gl_Position = projectionMatrix * viewMatrix * vec4(iPos.x + local.x, iPos.y + local.y, iPos.z, 1.0);
}`;

// the outline of a card: a dashed hollow frame (the position along the edge it is on picks a dash or a gap), and a slash from the lower left to the upper right when the draw was skipped
const FRAGMENT = `
varying vec2 vLocal;
varying vec2 vSize;
varying vec2 vLook;
const vec3 INK = vec3(0.725, 0.255, 0.043);
void main() {
  vec2 p = vLocal;
  float w = vSize.x;
  float h = vSize.y;
  float b = 0.2 * w;
  bool frame = abs(p.x) > 0.5 * w - b || p.y < b || p.y > h - b;
  bool on = false;
  if (frame) {
    float along = (abs(p.x) > 0.5 * w - b) ? p.y : p.x;
    on = fract(along / (0.55 * w) + 0.5) < 0.6;
  }
  if (vLook.x > 0.5) {
    float t = (p.y / h) - (p.x / w + 0.5);
    on = on || abs(t) * w < 0.8 * b;
  }
  if (!on) discard;
  gl_FragColor = vec4(INK * vLook.y, 1.0);
}`;

export interface Overlay {
  /** The answer of the Worker for the halls, or null: the switch is off, and nothing of the overlay stays in the scene. */
  set(data: OverlayData | null): void;
  /** The hall the record panel reads: the other rails are dimmed. */
  setLens(architecture: string): void;
  /** Draws the rails for the clock reading `t` when the tags present changed. */
  update(t: number): void;
}

const DIM = 0.55;

/** A text with {placeholders} filled by nodes: the pieces of the template in order, each name replaced by the node given for it (an identifier or a count is a label, invariant 3). */
export const fill = (template: string, nodes: Readonly<Record<string, Node>>): Node[] =>
  template.split(/(\{\w+\})/).map((piece) => {
    const name = /^\{(\w+)\}$/.exec(piece)?.[1];
    return name !== undefined && nodes[name] ? nodes[name] : document.createTextNode(piece);
  });

export const label = (text: string): HTMLElement => {
  const el = document.createElement("span");
  el.setAttribute("data-label", "");
  el.textContent = text;
  return el;
};

/** How many of a sorted list are at most `t`. */
const countAtMost = (list: readonly number[], t: number): number => {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((list[mid] as number) <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
};

interface Attributes {
  pos: InstancedBufferAttribute;
  size: InstancedBufferAttribute;
  look: InstancedBufferAttribute;
}

export const buildOverlay = (host: HTMLElement, layout: Layout, plan: ScenePlan, group: Group, labels: Labels, initialLens: string): Overlay => {
  let lens = initialLens;
  let data: OverlayData | null = null;
  let mesh: Mesh | null = null;
  let attributes: Attributes | null = null;
  let captions: HTMLElement[] = [];
  /** For each rail, the sorted instants of its tags in the whole run: the tags present at `t` are the first of them. */
  let instants: number[][] = [];
  let seen: string | null = null;

  const clear = (): void => {
    if (mesh) {
      group.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as Material).dispose();
    }
    mesh = null;
    attributes = null;
    labels.overlay(null);
    captions = [];
    instants = [];
    seen = null;
    delete host.dataset.plantAbsences;
  };

  const build = (d: OverlayData): void => {
    clear();
    const whole = railsAt(plan, d.halls, Number.POSITIVE_INFINITY);
    instants = whole.map((r) => r.shown.map((tag) => (plan.samples[tag.sample] as ScenePlan["samples"][number]).drawn_s as number));
    const capacity = Math.max(1, whole.reduce((n, r) => n + r.total, 0));
    const quad = new PlaneGeometry(1, 1);
    const geometry = new InstancedBufferGeometry();
    geometry.index = quad.index;
    geometry.setAttribute("position", quad.getAttribute("position"));
    const attribute = (name: string, size: number): InstancedBufferAttribute => {
      const a = new InstancedBufferAttribute(new Float32Array(capacity * size), size).setUsage(DynamicDrawUsage);
      geometry.setAttribute(name, a);
      return a;
    };
    attributes = { pos: attribute("iPos", 3), size: attribute("iSize", 2), look: attribute("iLook", 2) };
    geometry.instanceCount = 0;
    quad.dispose();
    mesh = new Mesh(geometry, new ShaderMaterial({ vertexShader: VERTEX, fragmentShader: FRAGMENT }));
    mesh.frustumCulled = false;
    group.add(mesh);
    // the label of each rail, over the middle of the wall
    captions = labels.overlay(
      whole.map((r) => {
        const f = (layout.halls.find((h) => h.architecture === r.architecture) ?? (layout.halls[0] as Layout["halls"][number])).footprint;
        return { x: f.x + f.w / 2, y: f.h + 0.6, z: f.z + f.d - 0.12 };
      }),
    );
  };

  const draw = (t: number): void => {
    if (!mesh || !attributes || !data) return;
    const rails: RailView[] = railsAt(plan, data.halls, t);
    let n = 0;
    for (const rail of rails) {
      const hall = layout.halls.find((h) => h.architecture === rail.architecture);
      if (!hall) continue;
      for (const tag of rail.shown) {
        const b = tagBox(hall.footprint, rail.total, tag.place);
        attributes.pos.setXYZ(n, b.x, b.y, b.z);
        attributes.size.setXY(n, b.w, b.h);
        attributes.look.setXY(n, tag.why === "skipped" ? 1 : 0, rail.architecture === lens ? 1 : DIM);
        n++;
      }
    }
    (mesh.geometry as InstancedBufferGeometry).instanceCount = n;
    for (const a of Object.values(attributes)) a.needsUpdate = true;
    for (const [i, rail] of rails.entries()) {
      const el = captions[i];
      if (!el) continue;
      const own = document.createElement("small");
      own.className = "plant-overlay-label";
      own.textContent = data.captions.label;
      el.replaceChildren(...fill(data.captions.absence, { architecture: label(rail.architecture), count: label(String(rail.shown.length)) }), document.createElement("br"), own);
      el.setAttribute("data-overlay", "");
      el.dataset.overlayHall = rail.architecture;
      el.dataset.lens = rail.architecture === lens ? "1" : "0";
      el.hidden = rail.total === 0;
    }
    const shown = JSON.stringify(Object.fromEntries(rails.map((r) => [r.architecture, r.shown.length])));
    if (host.dataset.plantAbsences !== shown) host.dataset.plantAbsences = shown;
  };

  return {
    set(next) {
      data = next;
      if (next === null) clear();
      else build(next);
    },
    setLens(architecture) {
      lens = architecture;
      seen = null;
    },
    update(t) {
      if (!data || !mesh) return;
      // the tags present change only at the instants of the plan's draws: compare the counts, and draw again when one changed (or the answer or the lens did)
      const now = instants.map((list) => countAtMost(list, t)).join(",");
      if (now === seen) return;
      seen = now;
      draw(t);
    },
  };
};
