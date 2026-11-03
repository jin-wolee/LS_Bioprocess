import type { ScenePlan, TruthOverlay } from "../protocol.ts";

// What the truth overlay draws of a break-out case at an instant (docs/design/plant_ui.md section 3.3, "As built in P7c"): a pure function of the plan, the answer of `{ breakout: true }` and the clock
// instant. The origin is the item the scenario names, marked from the instant it became contaminated; a unit the event reached is marked from its onset. It is the simulation's own view, shown only when the
// reader asks for it, under its label; the plan and the halls carry nothing of it.

export type BreakoutTruth = Extract<TruthOverlay, { kind: "breakout" }>;

export interface BreakoutAt {
  /** Where the origin marker stands: a lot of the rack, an equipment station or a vessel; null before the origin was contaminated and for an origin the plan does not hold. */
  origin: { kind: "lot" | "equipment" | "unit"; index: number; id: string } | null;
  /** The units reached by `t`, with the instant each became contaminated (an index into `plan.units`). */
  reached: { unit: number; onset_s: number }[];
}

const HOUR = 3600;

/** The origin of the event as an item of the plan, and the instant it is marked from. */
const originOf = (plan: ScenePlan, event: BreakoutTruth["event"]): { at: NonNullable<BreakoutAt["origin"]>; from: number } | null => {
  const id = event.origin_id;
  const since = event.contaminated_at !== null && event.contaminated_at.unit === "h" ? event.contaminated_at.value * HOUR : 0;
  switch (event.origin_kind) {
    case "seed_lot":
    case "medium_lot": {
      const index = (plan.lots ?? []).findIndex((l) => l.id === id);
      return index < 0 ? null : { at: { kind: "lot", index, id }, from: since };
    }
    case "shared_equipment": {
      const index = (plan.equipment ?? []).findIndex((e) => e.id === id);
      return index < 0 ? null : { at: { kind: "equipment", index, id }, from: since };
    }
    case "unit_equipment": {
      const index = plan.units.findIndex((u) => u.id === id);
      return index < 0 ? null : { at: { kind: "unit", index, id }, from: since };
    }
    case "sampling": {
      // the origin is a draw: the vessel it was drawn from, from the instant of the draw
      const s = plan.samples.find((x) => x.id === id);
      return s === undefined || s.drawn_s === null ? null : { at: { kind: "unit", index: s.unit, id: (plan.units[s.unit] as ScenePlan["units"][number]).id }, from: s.drawn_s };
    }
    default:
      return null;
  }
};

export const breakoutAt = (plan: ScenePlan, answer: BreakoutTruth, t: number): BreakoutAt => {
  const origin = originOf(plan, answer.event);
  return {
    origin: origin !== null && origin.from <= t ? origin.at : null,
    reached: answer.affected.filter((a) => a.onset_s <= t),
  };
};
