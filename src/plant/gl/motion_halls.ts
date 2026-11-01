import { DynamicDrawUsage, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, PlaneGeometry, ShaderMaterial } from "three";
import type { BufferGeometry, Group, Material } from "three";
import { lookOf } from "../card_look.ts";
import type { HallView } from "../halls_at.ts";
import { SHELF, cardBox } from "../hall_shelves.ts";
import type { Layout } from "../layout.ts";

// The cards on the shelves of the record halls (docs/design/plant_ui.md sections 3.3 and 4.3), drawn from one call of `hallsAt` whenever the record has written something: ONE instanced mesh for all of
// them, one instance for each card, whatever their count (one draw call). The shader draws the card from four numbers (card_look.ts): the paper, the four slots (a solid square where the record stores
// the field, a hollow dashed one where it does not), the green bar of a card that is knowable, the pennants of the findings raised along its top edge, and the sheets of the versions behind it. Shape
// carries the meaning and colour only repeats it; a card is never marked wrong. The hall that is not the lens is dimmed, and the light follows the floor's (the cards are dim at night).
//
// Why a shader and not a pool for each part: in the software renderer of the headless QA an instance costs about 16 ms of frame time for each thousand, and a card made of seven instances took
// the frame from 17 to 50 ms (docs/progress.md, P5a). The geometry of the card (its box, the slots on its face) is hall_shelves.ts; the lengths below are the same ones, in metres.

const VERTEX = `
attribute vec3 iPos;
attribute vec2 iSize;
attribute vec4 iLook;
attribute float iDim;
varying vec2 vLocal;
varying vec2 vSize;
varying vec4 vLook;
varying float vDim;
void main() {
  // the quad covers the card and no more than it needs of what sticks out of it, since every pixel of it runs the fragment shader: the sheets of the versions peek out to the right and up, the pennants stand
  // above and a little to each side; from the foot centre of the card, in metres
  float ps = min(0.4 * iSize.x, 0.02);
  float padX = iLook.w > 0.5 ? 2.7 * ps : 0.0;
  float padY = iLook.w > 0.5 ? 2.5 * ps : 0.0;
  vec2 lo = vec2(-0.5 * iSize.x - padX, 0.0);
  vec2 hi = vec2(0.5 * iSize.x + 0.14 * iSize.x * iLook.z + padX, iSize.y + max(padY, 0.035 * iSize.y * iLook.z));
  vec2 local = mix(lo, hi, position.xy + 0.5);
  vLocal = local;
  vSize = iSize;
  vLook = iLook;
  vDim = iDim;
  gl_Position = projectionMatrix * viewMatrix * vec4(iPos.x + local.x, iPos.y + local.y, iPos.z, 1.0);
}`;

const f = (x: number): string => x.toFixed(4);

const FRAGMENT = `
uniform float uLight;
varying vec2 vLocal;
varying vec2 vSize;
varying vec4 vLook;
varying float vDim;
const vec3 PAPER = vec3(0.957, 0.969, 0.976);
const vec3 SHEET = vec3(0.702, 0.753, 0.792);
const vec3 SOLID = vec3(0.122, 0.435, 0.471);
const vec3 DASH = vec3(0.173, 0.290, 0.361);
const vec3 GREEN = vec3(0.180, 0.620, 0.357);
const vec3 AMBER = vec3(0.851, 0.635, 0.227);
void main() {
  vec2 p = vLocal;
  float w = vSize.x;
  float h = vSize.y;
  int stored = int(vLook.x + 0.5);
  int stack = int(vLook.z + 0.5);
  int pennants = int(vLook.w + 0.5);
  vec3 col = vec3(0.0);
  bool on = false;
  // the versions behind the card, peeking out to the upper right
  for (int k = 4; k >= 1; k--) {
    if (k <= stack) {
      vec2 c = vec2(0.14 * w * float(k), 0.5 * h + 0.035 * h * float(k));
      if (abs(p.x - c.x) <= 0.5 * w && abs(p.y - c.y) <= 0.5 * h) { col = SHEET; on = true; }
    }
  }
  if (abs(p.x) <= 0.5 * w && p.y >= 0.0 && p.y <= h) {
    col = PAPER;
    on = true;
    // the knowable bar at the foot
    if (vLook.y > 0.5 && abs(p.x) <= 0.4 * w && p.y >= ${f(0.2 * SHELF.bar)} * h + 0.002 * h && p.y <= ${f(0.8 * SHELF.bar)} * h + 0.002 * h) col = GREEN;
    // the four slots, the unit at the top
    float s = ${f(SHELF.slot)} * h;
    float side = min(s, 0.8 * w);
    for (int k = 0; k < 4; k++) {
      vec2 d = abs(p - vec2(0.0, h - ${f(SHELF.gap)} * h - 0.5 * s - float(k) * (s + ${f(SHELF.gap)} * h)));
      if (d.x <= 0.5 * side && d.y <= 0.5 * side) {
        if (((stored >> k) & 1) == 1) col = SOLID;
        else if (d.x > 0.5 * side - 0.16 * side || d.y > 0.5 * side - 0.16 * side) {
          // not stored: a hollow square drawn with a dashed line (the position along the edge it is on picks a dash or a gap)
          float along = d.x > d.y ? p.x : p.y;
          if (fract(along / (0.28 * side) + 0.5) < 0.55) col = DASH;
        }
      }
    }
  }
  // a pennant for each finding raised: a triangle on the top edge, apex up
  float ps = min(0.4 * w, 0.02);
  for (int i = 0; i < 4; i++) {
    if (i < pennants) {
      vec2 q = p - vec2((float(i) - 0.5 * float(pennants - 1)) * 1.2 * ps, h + 1.4 * ps);
      if (q.y >= -0.5 * ps && q.y <= ps && abs(q.x) <= 0.866 * ps * (ps - q.y) / (1.5 * ps)) { col = AMBER; on = true; }
    }
  }
  if (!on) discard;
  gl_FragColor = vec4(col * vDim * uLight, 1.0);
}`;

export interface HallDrawing {
  /** The cards of the halls at one instant of the run (`hallsAt`), with the hall the lens reads; the other halls are dimmed. */
  draw(halls: readonly HallView[], lens: string): void;
  /** The light of the floor, 1 inside the staffed window and less outside it. */
  light(daylight: number): void;
}

const DIM = 0.55; // the share of its brightness a card keeps when its hall is not the lens
const NIGHT = 0.5; // the share of its brightness a card keeps in the dim of the night

export const buildHallMotion = (layout: Layout, capacity: number, group: Group, disposables: (BufferGeometry | Material)[]): HallDrawing => {
  const quad = new PlaneGeometry(1, 1);
  const geometry = new InstancedBufferGeometry();
  geometry.index = quad.index;
  geometry.setAttribute("position", quad.getAttribute("position"));
  const attribute = (name: string, size: number): InstancedBufferAttribute => {
    const a = new InstancedBufferAttribute(new Float32Array(Math.max(1, capacity) * size), size).setUsage(DynamicDrawUsage);
    geometry.setAttribute(name, a);
    return a;
  };
  const pos = attribute("iPos", 3);
  const size = attribute("iSize", 2);
  const look = attribute("iLook", 4);
  const dim = attribute("iDim", 1);
  geometry.instanceCount = 0;
  const uLight = { value: 1 };
  const material = new ShaderMaterial({ vertexShader: VERTEX, fragmentShader: FRAGMENT, uniforms: { uLight } });
  disposables.push(quad, geometry, material);
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  group.add(mesh);

  return {
    draw(halls, lens) {
      let n = 0;
      for (const view of halls) {
        const hall = layout.halls.find((h) => h.architecture === view.architecture);
        if (!hall) continue;
        for (const c of view.cards) {
          if (n >= capacity) break;
          const box = cardBox(hall.footprint, view.total, c.place);
          const l = lookOf(c);
          pos.setXYZ(n, box.x, box.y, box.z);
          size.setXY(n, box.w, box.h);
          look.setXYZW(n, l.stored, l.knowable, l.stack, l.pennants);
          dim.setX(n, view.architecture === lens ? 1 : DIM);
          n++;
        }
      }
      geometry.instanceCount = n;
      for (const a of [pos, size, look, dim]) a.needsUpdate = true;
    },
    light(daylight) {
      uLight.value = NIGHT + (1 - NIGHT) * daylight;
    },
  };
};
