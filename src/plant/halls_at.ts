import type { PlanCard, PlanSlot, ScenePlan } from "../protocol.ts";

// `hallsAt(plan, t)` (docs/design/plant_ui.md sections 3.3 and 4.3): the cards on the shelves of every record hall at the instant `t`, as a pure function of the scene plan and of `t`, beside
// `sceneAt`. It reads no clock, keeps no state between calls and imports no three.js, so seeking and playing backwards need no replay, a screenshot at a fixed `t` shows the same shelves every
// time, and Vitest runs it without WebGL. What it caches (the order of the cards of a hall) is derived from the plan alone and kept per list of cards.
//
// It shows what the architecture stored and nothing else: a card for each sample the record holds a row of, from the instant it holds it (`shown_s`); the slots as the plan states them (stored or
// not stored); a card is knowable from `available_s`, which an architecture that stores no availability does not have; a pennant for each finding the record has raised by then; a stack behind the
// card for each version written by then beyond the one in front. A card is never marked wrong and no absence is drawn: a row the record lacks has no card.

type Record_ = ScenePlan["records"][number];

export interface CardView {
  /** The index into the plan's `samples`. */
  sample: number;
  /** The place on the hall's shelves: the rank of the card by (shown_s, then sample) among all the cards of the hall, 0 for the first. Fixed for the run. */
  place: number;
  /** The plan's own slots of the card (shared, not copied: a reader must not change them). */
  slots: readonly PlanSlot[];
  /** The record says the result is available: `available_s <= t`. Never true where the architecture stores no availability. */
  knowable: boolean;
  /** The rule ids of the findings raised by `t`, sorted. */
  pennants: string[];
  /** The versions behind the card at `t`: the versions written by then, less the one in front; 0 where the record overwrites in place or has written one. */
  stack: number;
}

export interface HallView {
  architecture: string;
  flags_on: string[];
  /** The cards the hall holds in the whole run: the shelves are laid out for this many, so that a card never moves when another arrives. */
  total: number;
  /** The cards present at `t`, in the order of their place. */
  cards: CardView[];
  shown: number;
  knowable: number;
}

const orders = new WeakMap<readonly PlanCard[], PlanCard[]>();

/** The cards of a hall by place: by `shown_s`, then by sample. */
const orderOf = (cards: readonly PlanCard[]): PlanCard[] => {
  const cached = orders.get(cards);
  if (cached) return cached;
  const made = [...cards].sort((a, b) => a.shown_s - b.shown_s || a.sample - b.sample);
  orders.set(cards, made);
  return made;
};

/** How many of a sorted list have a key at most `t`. */
const countAtMost = <T>(list: readonly T[], key: (x: T) => number, t: number): number => {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (key(list[mid] as T) <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
};

const viewOf = (card: PlanCard, place: number, t: number): CardView => ({
  sample: card.sample,
  place,
  slots: card.slots,
  knowable: card.available_s !== null && card.available_s <= t,
  pennants: card.findings.filter((f) => f.raised_s <= t).map((f) => f.rule).sort(),
  stack: Math.max(0, card.version_s.filter((s) => s <= t).length - 1),
});

export const hallsAt = (plan: ScenePlan, t: number): HallView[] =>
  plan.records.map((r: Record_): HallView => {
    const order = orderOf(r.cards);
    // the cards are in the order of their place, which is the order of `shown_s`: the ones present are the first of them
    const cards = order.slice(0, countAtMost(order, (c) => c.shown_s, t)).map((c, place) => viewOf(c, place, t));
    return { architecture: r.architecture, flags_on: [...r.flags_on], total: r.cards.length, cards, shown: cards.length, knowable: cards.filter((c) => c.knowable).length };
  });

const changes = new WeakMap<ScenePlan["records"], number[]>();

/** The instants at which something on a shelf changes, in order and without repeats: a card is shown, a version is written, a finding is raised, a card turns knowable. */
const changesOf = (records: ScenePlan["records"]): number[] => {
  const cached = changes.get(records);
  if (cached) return cached;
  const all = records.flatMap((r) => r.cards.flatMap((c) => [c.shown_s, ...(c.available_s === null ? [] : [c.available_s]), ...c.version_s, ...c.findings.map((f) => f.raised_s)]));
  const made = [...new Set(all)].sort((a, b) => a - b);
  changes.set(records, made);
  return made;
};

/**
 * How many of the instants at which a shelf changes are not later than `t`. `hallsAt` is the same for two instants with the same epoch, so a frame of the scene that stays inside one epoch draws
 * the shelves it drew before (a cheap number to compare, where `hallsAt` builds an object for every card).
 */
export const hallsEpoch = (plan: ScenePlan, t: number): number => countAtMost(changesOf(plan.records), (x) => x, t);
