import type { BreakoutRow, BreakoutWalkItem, Request } from "../protocol.ts";
import { seedOf } from "./lineage_form.ts";
import type { ReadyInfo } from "./state.ts";

// The pure parts of the Break-out screen (docs/design/lab_ui.md sections 3 and 20; spec section 8 and 11.6): the form and its request, how a metric row is read and how the rows of an
// architecture are grouped. Nothing here orders the architectures or combines the metrics into a score; recall is grouped with precision and the false-alarm rate of its direction.

export const KINDS = ["batch", "material_lot", "equipment", "result"] as const;
export type Kind = (typeof KINDS)[number];

export interface BreakoutForm {
  case: string;
  seed: string;
  archs: string[];
}

/** The first case, the first seed of the list, A, B and C and C with each of the flags that decide what direction 3 can read off (the ablations that show the difference). */
export const defaultBreakoutForm = (ready: ReadyInfo): BreakoutForm => {
  const offer = ready.breakout;
  const needed: string[] = offer ? [offer.needs.lots, offer.needs.equipment] : [];
  return {
    case: offer?.cases[0]?.id ?? "",
    seed: String(offer?.seed_list[0] ?? ""),
    archs: ready.presets.filter((p) => p.role === "preset" || (p.ablated_flag !== null && needed.includes(p.ablated_flag))).map((p) => p.id),
  };
};

/** The architectures ticked, in the order `ready` lists them (the order in which they were ticked says nothing). */
export const selectedArchitectures = (form: BreakoutForm, ready: ReadyInfo): string[] => ready.presets.map((p) => p.id).filter((id) => form.archs.includes(id));

/** The `breakout` request of a form, or null while the form cannot make one. */
export const breakoutRequest = (form: BreakoutForm, ready: ReadyInfo, id: number): Request | null => {
  const seed = seedOf(form.seed);
  const architectures = selectedArchitectures(form, ready);
  if (ready.breakout === null || seed === null || architectures.length === 0 || !ready.breakout.cases.some((c) => c.id === form.case)) return null;
  return { type: "breakout", id, case: form.case, architectures, seed };
};

export type Cell = { kind: "not_reachable" } | { kind: "undefined"; num: number | null; den: number | null } | { kind: "share"; num: number; den: number; value: number } | { kind: "time"; seconds: number };

/**
 * How a row is read. A direction 3 row of a record that cannot read direction 3 is not reachable, whatever its other fields say: the walk-back could not look, which is not an empty set found
 * and not a recall of 0. A zero denominator is undefined, never 0 and never 1.
 */
export const cellOf = (row: BreakoutRow): Cell => {
  if (row.status === "not_reachable") return { kind: "not_reachable" };
  if (row.value === null) return { kind: "undefined", num: row.num, den: row.den };
  if (row.num === null || row.den === null) return { kind: "time", seconds: row.value };
  return { kind: "share", num: row.num, den: row.den, value: row.value };
};

export interface Containment {
  kind: Kind;
  contained: BreakoutRow;
  median: BreakoutRow;
  p90: BreakoutRow;
}
export interface Identification {
  direction: 1 | 3;
  recall: BreakoutRow;
  precision: BreakoutRow;
  false_alarm: BreakoutRow;
}
export interface MetricGroups {
  containment: Containment[];
  identification: Identification[];
  released: BreakoutRow;
  retro: BreakoutRow;
}

/** The 20 rows of an architecture in the groups the screen shows. A row the report lacks is a defect of the report and is named, because a screen that shows recall alone breaks rule 3 of spec section 8. */
export const groupMetrics = (rows: readonly BreakoutRow[]): MetricGroups => {
  const need = (metric: string): BreakoutRow => rows.find((r) => r.metric === metric) ?? ((): never => { throw new Error(`the report lacks the row ${metric}`); })();
  return {
    containment: KINDS.map((kind) => ({ kind, contained: need(`containment.${kind}.contained`), median: need(`containment.${kind}.median_s`), p90: need(`containment.${kind}.p90_s`) })),
    identification: ([1, 3] as const).map((direction) => ({
      direction,
      recall: need(`identification.direction_${direction}.recall`),
      precision: need(`identification.direction_${direction}.precision`),
      false_alarm: need(`identification.direction_${direction}.false_alarm`),
    })),
    released: need("released_before_containment"),
    retro: need("retro_flag_completeness"),
  };
};

/** Seconds as hours for the eye, at most two decimals. */
export const hoursText = (seconds: number): string => String(Number((seconds / 3600).toFixed(2)));

/** The items of a walk-back counted by kind, in the order of KINDS; a kind with none is absent (an empty set is stated by the screen, not by a row of zeros). */
export const countsByKind = (items: readonly BreakoutWalkItem[]): { kind: string; count: number }[] =>
  [...new Set([...KINDS, ...items.map((i) => i.kind)])].flatMap((kind) => {
    const count = items.filter((i) => i.kind === kind).length;
    return count > 0 ? [{ kind, count }] : [];
  });
