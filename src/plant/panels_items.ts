import type { ScenePlan } from "../protocol.ts";
import { tapeOf } from "./items_at.ts";
import type { Tape } from "./items_at.ts";

// The panels of the break-out items (docs/design/plant_ui.md section 3.2, "As built in P7c"): a lot, an equipment item and a confirming sample, and what the panel of a reactor adds in a case. Like
// `panelOf` (panels.ts) these are pure functions of the plan, the clock instant and the hall the lens reads: a count is a count of the plan's rows with an instant not later than `t`, an outcome the lab has
// not reported yet is null, and the tape is the lens hall's own decision. Nothing here is a metric and nothing is truth.

/** How many of the newest rows a panel lists: the count says the rest. */
export const NEWEST = 5;

type Sample = ScenePlan["samples"][number];

export interface UseRow {
  unit: string;
  t: number;
}

export interface LotPanel {
  kind: "lot";
  id: string;
  lot_kind: "seed" | "medium";
  used: number;
  /** The newest uses so far, newest first. */
  uses: UseRow[];
  /** The tape the lens record put on it at the instant. */
  tape: Tape | null;
}

export interface EquipmentPanel {
  kind: "equipment";
  id: string;
  used: number;
  uses: UseRow[];
  tape: Tape | null;
}

export interface ConfirmPanel {
  kind: "confirm";
  id: string;
  unit: string;
  operator: string | null;
  /** The draw, once it has happened; the tests are not ordered before it. */
  drawn_s: number | null;
  /** The tests of the sample; the outcome and its instant once the lab has reported, else null. */
  tests: { test: string; result_s: number | null; outcome: "detected" | "not_detected" | null }[];
}

/** What a reactor panel adds in a case: the beacon and tag items and the stop, as of the instant, and the tape on the reactor. */
export interface ReactorItems {
  marks: { kind: "signal" | "deviation" | "stopped"; item: string | null; t: number }[];
  tape: Tape | null;
}

const KINDS = { signal_observed: "signal", deviation_opened: "deviation", unit_stopped: "stopped" } as const;

const usesOf = (plan: ScenePlan, uses: readonly { unit: number; t: number }[], t: number): { used: number; uses: UseRow[] } => {
  const so_far = uses.filter((u) => u.t <= t).sort((a, b) => b.t - a.t || a.unit - b.unit);
  return { used: so_far.length, uses: so_far.slice(0, NEWEST).map((u) => ({ unit: (plan.units[u.unit] as ScenePlan["units"][number]).id, t: u.t })) };
};

const holdsOf = (plan: ScenePlan, lens: string): NonNullable<ScenePlan["records"][number]["holds"]> => plan.records.find((r) => r.architecture === lens)?.holds ?? [];

export const lotOf = (plan: ScenePlan, index: number, t: number, lens: string): LotPanel => {
  const lot = (plan.lots ?? [])[index] as NonNullable<ScenePlan["lots"]>[number];
  return { kind: "lot", id: lot.id, lot_kind: lot.kind, ...usesOf(plan, lot.uses, t), tape: tapeOf(holdsOf(plan, lens), "lot", index, t) };
};

export const equipmentOf = (plan: ScenePlan, index: number, t: number, lens: string): EquipmentPanel => {
  const item = (plan.equipment ?? [])[index] as NonNullable<ScenePlan["equipment"]>[number];
  return { kind: "equipment", id: item.id, ...usesOf(plan, item.uses, t), tape: tapeOf(holdsOf(plan, lens), "equipment", index, t) };
};

export const confirmOf = (plan: ScenePlan, index: number, t: number): ConfirmPanel => {
  const s = plan.samples[index] as Sample;
  const drawn = s.drawn_s !== null && s.drawn_s <= t;
  const tests = (plan.confirms ?? []).filter((c) => c.sample === index).map((c) => (c.result_s <= t ? { test: c.test, result_s: c.result_s, outcome: c.outcome } : { test: c.test, result_s: null, outcome: null }));
  return {
    kind: "confirm", id: s.id, unit: (plan.units[s.unit] as ScenePlan["units"][number]).id, operator: s.operator === null ? null : (plan.staff[s.operator] as ScenePlan["staff"][number]).id,
    drawn_s: drawn ? s.drawn_s : null, tests: drawn ? tests : [],
  };
};

/** The items a reactor panel adds in a case, or null for a plan that is not one. */
export const reactorItemsOf = (plan: ScenePlan, unit: number, t: number, lens: string): ReactorItems | null => {
  if (plan.lots === undefined) return null;
  const marks = plan.marks
    .flatMap((m) => (m.unit === unit && m.t <= t && m.kind in KINDS ? [{ kind: KINDS[m.kind as keyof typeof KINDS], item: m.item, t: m.t }] : []))
    .sort((a, b) => a.t - b.t);
  return { marks, tape: tapeOf(holdsOf(plan, lens), "unit", unit, t) };
};
