import type { PlanHold, ScenePlan } from "../protocol.ts";
import { slotCount } from "./layout_store.ts";
import { LOOK } from "./scene_look.ts";

// `itemsAt(plan, t, lens)` (docs/design/plant_ui.md section 3.2, "As built in P7c"): what the break-out scene draws besides the floor of `sceneAt` and the halls of `hallsAt`, at the instant `t`, as a
// pure function of the scene plan, the instant and the hall the lens reads. It reads no clock and keeps no state between calls, so seeking and playing backwards need no replay and a screenshot at a fixed
// instant shows the same scene every time; it imports no three.js, so Vitest runs it without WebGL. It holds nothing the plan does not: a lot or an equipment item that is contaminated is an entry like any
// other, and the tape is the decision of the record the lens reads, not a fact about the item.

export type Tape = "held" | "quarantined";
export type TapeKind = "lot" | "equipment" | "unit";

/** A gantry from a lot (an index into `plan.lots`) or an equipment item (into `plan.equipment`) to a vessel, `progress` of the way through `LOOK.link_s` (0 at the use, 1 when it is gone). */
export interface Link {
  kind: "lot" | "equipment";
  item: number;
  unit: number;
  progress: number;
}

/** A stamp on a confirming tube: a test whose result has been reported, `k` its rank among the tests of that sample (so that a stamp never moves when another is added). */
export interface Stamp {
  test: string;
  outcome: "detected" | "not_detected";
  k: number;
}

/** A confirming tube in its slot of the shelf (an index into `plan.samples`), with the stamps it wears. */
export interface ShelfTube {
  sample: number;
  slot: number;
  stamps: Stamp[];
}

export interface ItemsState {
  links: Link[];
  /** The tape of the lens hall, by lot, equipment item and unit, in the order of the plan's lists. */
  tape: { lots: (Tape | null)[]; equipment: (Tape | null)[]; units: (Tape | null)[] };
  shelf: ShelfTube[];
}

/** The tape that the holds put on a thing at `t`: a placed hold is held, a quarantine makes it quarantined, a release takes it off. The holds are in time order (plan_ui.md section 4.1); nothing else is tape. */
export const tapeOf = (holds: readonly PlanHold[], on: TapeKind | "sample", target: number, t: number): Tape | null => {
  let state: Tape | null = null;
  for (const h of holds) {
    if (h.t > t) break;
    if (h.on !== on || h.target !== target) continue;
    if (h.event === "hold_placed") state = "held";
    else if (h.event === "hold_quarantined") state = "quarantined";
    else if (h.event === "hold_released") state = null;
  }
  return state;
};

const tapesAt = (holds: readonly PlanHold[], on: TapeKind, count: number, t: number): (Tape | null)[] => Array.from({ length: count }, (_, i) => tapeOf(holds, on, i, t));

/** The links standing at `t`: every use of a lot, then of an equipment item, in the order of the plan, for `LOOK.link_s` from its instant (half open: gone at the end of the stretch). */
const linksAt = (plan: ScenePlan, t: number): Link[] => {
  const out: Link[] = [];
  for (const [kind, list] of [["lot", plan.lots ?? []], ["equipment", plan.equipment ?? []]] as const) {
    for (const [item, entry] of list.entries()) {
      for (const use of entry.uses) {
        const age = t - use.t;
        if (age >= 0 && age < LOOK.link_s) out.push({ kind, item, unit: use.unit, progress: age / LOOK.link_s });
      }
    }
  }
  return out;
};

/** The slot of each confirming sample that has a tube: its rank among the confirming samples of the plan that were not skipped, in the order of the plan, while the shelf has a slot for it. */
const slotsOf = (plan: ScenePlan): Map<number, number> => {
  const slots = new Map<number, number>();
  const room = slotCount(plan.units.length);
  for (const [i, s] of plan.samples.entries()) if (s.kind === "confirm" && !s.skipped && s.drawn_s !== null && slots.size < room) slots.set(i, slots.size);
  return slots;
};

const shelfAt = (plan: ScenePlan, t: number): ShelfTube[] => {
  const confirms = plan.confirms ?? [];
  const out: ShelfTube[] = [];
  for (const [sample, slot] of slotsOf(plan)) {
    if ((plan.samples[sample] as ScenePlan["samples"][number]).drawn_s as number > t) continue;
    const mine = confirms.filter((c) => c.sample === sample);
    out.push({ sample, slot, stamps: mine.flatMap((c, k) => (c.result_s <= t ? [{ test: c.test, outcome: c.outcome, k }] : [])) });
  }
  return out;
};

export const itemsAt = (plan: ScenePlan, t: number, lens: string): ItemsState => {
  const holds = plan.records.find((r) => r.architecture === lens)?.holds ?? [];
  return {
    links: linksAt(plan, t),
    tape: { lots: tapesAt(holds, "lot", plan.lots?.length ?? 0, t), equipment: tapesAt(holds, "equipment", plan.equipment?.length ?? 0, t), units: tapesAt(holds, "unit", plan.units.length, t) },
    shelf: shelfAt(plan, t),
  };
};

/** The slot of a confirming sample of the plan (an index into `plan.samples`), or null when it has none: it is not a confirming sample, its draw was skipped, or the shelf is full. */
export const slotOfSample = (plan: ScenePlan, sample: number): number | null => slotsOf(plan).get(sample) ?? null;

const count = (list: readonly (Tape | null)[], state: Tape): number => list.filter((x) => x === state).length;

/** What the host writes as `data-plant-items`: the links standing, the tubes on the shelf, the stamps, and the tapes by state and kind. */
export const itemsCounts = (s: ItemsState): { links: number; shelf: number; stamps: number; held: Record<TapeKind, number>; quarantined: Record<TapeKind, number> } => ({
  links: s.links.length,
  shelf: s.shelf.length,
  stamps: s.shelf.reduce((n, x) => n + x.stamps.length, 0),
  held: { lot: count(s.tape.lots, "held"), equipment: count(s.tape.equipment, "held"), unit: count(s.tape.units, "held") },
  quarantined: { lot: count(s.tape.lots, "quarantined"), equipment: count(s.tape.equipment, "quarantined"), unit: count(s.tape.units, "quarantined") },
});
