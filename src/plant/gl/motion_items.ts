import { BoxGeometry, CylinderGeometry, MeshBasicMaterial, MeshStandardMaterial, OctahedronGeometry } from "three";
import type { BufferGeometry, Group, Material } from "three";
import type { ScenePlan } from "../../protocol.ts";
import { CRATE, PLINTH, SHELF_TUBE, STATION, vesselShape } from "../dims.ts";
import type { Tape } from "../items_at.ts";
import type { ItemsState } from "../items_at.ts";
import type { Layout } from "../layout.ts";
import { STORE } from "../layout_store.ts";
import type { Labels } from "./labels.ts";
import { makePool } from "./pool.ts";

// The break-out items that follow the clock (docs/design/plant_ui.md sections 3.2 and 4.3, "As built in P7c"), drawn from one call of `itemsAt` for each new clock reading: the gantry from a lot or an
// equipment item to a vessel at an addition or a use (thinning to nothing), the tape of the lens hall on units, lots and equipment items, and the confirming tubes on the shelf with a flat square plate on
// top and a stamp for each reported test. Shape carries the meaning and colour repeats it: a held item has one band and a quarantined one two; a stamp that reads detected is a diamond and one that reads
// not detected a disc, each also written in words on the label of its tube. A pool is a fixed capacity written again for each new reading, as in motion_vessels.ts.

const LINK = { height: 2.6, width: 0.09, lot: 0x2e9e8f, equipment: 0x6b4fa0 } as const;
const TAPE = { color: 0xf2c94c, thick: 0.1, pad: 0.05 } as const;
const STAMP = { size: 0.07, thick: 0.03, step: 0.13, lift: 0.1, out: 0.08 } as const;

export interface ItemsMotion {
  update(state: ItemsState): void;
  /** The words of the two outcomes in the language of the page, for the labels of the tubes. */
  setWords(words: { detected: string; not_detected: string }): void;
}

export const buildItemsMotion = (layout: Layout, plan: ScenePlan, group: Group, labels: Labels, disposables: (BufferGeometry | Material)[]): ItemsMotion => {
  const geometry = <G extends BufferGeometry>(g: G): G => {
    disposables.push(g);
    return g;
  };
  const basic = (color: number): MeshBasicMaterial => {
    const m = new MeshBasicMaterial({ color });
    disposables.push(m);
    return m;
  };
  const standard = (color: number): MeshStandardMaterial => {
    const m = new MeshStandardMaterial({ color, roughness: 0.4 });
    disposables.push(m);
    return m;
  };
  const uses = [...(plan.lots ?? []), ...(plan.equipment ?? [])].reduce((n, x) => n + x.uses.length, 0);
  const things = plan.units.length + (plan.lots?.length ?? 0) + (plan.equipment?.length ?? 0);
  const slots = layout.shelf?.slots.length ?? 0;
  const box = geometry(new BoxGeometry(1, 1, 1));
  const ring = geometry(new CylinderGeometry(1, 1, 1, 20));
  const across = makePool(box, basic(0xffffff), uses, { colored: true });
  const stubs = makePool(box, basic(0xffffff), 2 * uses, { colored: true });
  const bandBoxes = makePool(box, basic(TAPE.color), 2 * things);
  const bandRings = makePool(ring, basic(TAPE.color), 2 * things);
  const bodies = makePool(geometry(new CylinderGeometry(SHELF_TUBE.radius, SHELF_TUBE.radius, SHELF_TUBE.height, 10)), standard(0xeaf2f7), slots, { cast: true });
  const plates = makePool(geometry(new BoxGeometry(0.24, 0.02, 0.24)), basic(0x2f6fb0), slots);
  const diamonds = makePool(geometry(new OctahedronGeometry(1)), basic(0xd9372b), 3 * slots);
  const discs = makePool(geometry(new CylinderGeometry(1, 1, 1, 14).rotateX(Math.PI / 2)), basic(0x2e9e5b), 3 * slots);
  const pools = [across, stubs, bandBoxes, bandRings, bodies, plates, diamonds, discs];
  for (const p of pools) group.add(p.mesh);

  const tubeLabels = labels.tubes(slots);

  const top = {
    lot: (i: number): number => { const c = layout.rack?.crates[i]; return c ? STORE.rackBoard + c.tier * STORE.tier + CRATE.h : 0; },
    equipment: (): number => STATION.top + STATION.tankHeight,
  };
  const where = (kind: "lot" | "equipment", i: number): { x: number; z: number } | null => {
    if (kind === "lot") return layout.rack?.crates[i] ?? null;
    const s = layout.stations[i];
    return s ? { x: s.x + s.w / 2, z: s.z + s.d / 2 } : null;
  };

  const put = (state: ItemsState): void => {
    for (const l of state.links) {
      const from = where(l.kind, l.item);
      const v = layout.vessels[l.unit];
      if (!from || !v) continue;
      const w = LINK.width * (1 - l.progress);
      if (w < 0.005) continue;
      const color = LINK[l.kind];
      const fromTop = l.kind === "lot" ? top.lot(l.item) : top.equipment();
      const { height } = vesselShape((layout.bays[v.bay] as { profile: string }).profile);
      const toTop = PLINTH + height;
      stubs.put(from.x, (fromTop + LINK.height) / 2, from.z, w, LINK.height - fromTop, w, 0, color);
      stubs.put(v.x, (toTop + LINK.height) / 2, v.z, w, LINK.height - toTop, w, 0, color);
      across.put((from.x + v.x) / 2, LINK.height, (from.z + v.z) / 2, Math.hypot(v.x - from.x, v.z - from.z), w, w, Math.atan2(-(v.z - from.z), v.x - from.x), color);
    }
  };

  /** One band about the middle of an object held, two about its lower and upper parts when it is quarantined. */
  const taped = (tape: Tape | null, base: number, height: number, band: (y: number) => void): void => {
    if (tape === "held") band(base + height * 0.5);
    else if (tape === "quarantined") {
      band(base + height * 0.3);
      band(base + height * 0.7);
    }
  };

  const tape = (state: ItemsState): void => {
    for (const [i, v] of layout.vessels.entries()) {
      const { radius, height } = vesselShape((layout.bays[v.bay] as { profile: string }).profile);
      const r = radius + TAPE.pad;
      taped(state.tape.units[i] ?? null, PLINTH, height, (y) => bandRings.put(v.x, y, v.z, r, TAPE.thick, r));
    }
    for (const c of layout.rack?.crates ?? []) {
      const base = STORE.rackBoard + c.tier * STORE.tier;
      const seed = plan.lots?.[c.index]?.kind === "seed";
      const w = CRATE.w + 2 * TAPE.pad;
      taped(state.tape.lots[c.index] ?? null, base, CRATE.h, (y) => (seed ? bandRings.put(c.x, y, c.z, CRATE.w / 2 + TAPE.pad, TAPE.thick, CRATE.w / 2 + TAPE.pad) : bandBoxes.put(c.x, y, c.z, w, TAPE.thick, w)));
    }
    for (const s of layout.stations) {
      const r = STATION.tankRadius + TAPE.pad;
      taped(state.tape.equipment[s.index] ?? null, STATION.top, STATION.tankHeight, (y) => bandRings.put(s.x + s.w / 2, y, s.z + s.d / 2, r, TAPE.thick, r));
    }
  };

  const shelf = (state: ItemsState): void => {
    const tubes = new Map(state.shelf.map((t) => [t.slot, t]));
    for (let k = 0; k < slots; k++) {
      const slot = layout.shelf?.slots[k];
      const tube = tubes.get(k);
      if (!slot || !tube) {
        tubeLabels.set(k, null);
        continue;
      }
      const base = STORE.shelfBoard + slot.board * STORE.shelfStep;
      bodies.put(slot.x, base + SHELF_TUBE.height / 2, slot.z);
      plates.put(slot.x, base + SHELF_TUBE.height + 0.05, slot.z);
      for (const s of tube.stamps) {
        const at = [slot.x + (s.k - 1) * STAMP.step, base + STAMP.lift, slot.z + STORE.shelfDepth / 2 + STAMP.out] as const;
        if (s.outcome === "detected") diamonds.put(at[0], at[1], at[2], STAMP.size, STAMP.size, STAMP.size);
        else discs.put(at[0], at[1], at[2], STAMP.size, STAMP.size, STAMP.thick);
      }
      tubeLabels.set(k, { x: slot.x, y: base + SHELF_TUBE.height + SHELF_TUBE.cue + 0.3, z: slot.z }, { id: plan.samples[tube.sample]?.id ?? "", stamps: tube.stamps });
    }
  };

  return {
    setWords: (words) => tubeLabels.setWords(words),
    update(state) {
      for (const p of pools) p.begin();
      put(state);
      tape(state);
      shelf(state);
      for (const p of pools) p.end();
    },
  };
};
