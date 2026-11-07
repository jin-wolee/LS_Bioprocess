import { BREAKOUT_PUBLIC } from "./generated/breakout_public.ts";
import fullView from "./generated/ledger_view.json";
import publicView from "./generated/ledger_view_public.json";

// Grade, range and sources of the ledger ids the lab names, written from the ledgers by scripts/lab_ledger.py (docs/design/lab_ui.md section 6). The page never reads a ledger itself.
// A build that refuses the Break-out screen (src/breakout_offer.ts) bundles none of its files and so reads the public view, which holds no id that only those files name; a build that offers
// the screen reads the full one (section 20, item 12).

export type Grade = "S" | "P" | "D" | "A";

interface AssumptionView {
  grade: Grade;
  range_grade: Grade;
  range: unknown;
  unit: string;
  sources: string[];
  provisional: boolean;
}

interface View {
  assumptions: Record<string, AssumptionView>;
  sources: Record<string, { verification: string }>;
}

/**
 * The view of this build. The condition is the rule of `offerOf` written as src/worker/data.ts writes it, so that a bundler folds it and drops the JSON file the build does not read; it is
 * evaluated at each call, so that a test can stub VITE_LAB_LOCAL.
 */
const viewOf = (): View => (import.meta.env.VITE_LAB_LOCAL === "1" || BREAKOUT_PUBLIC ? fullView : publicView) as View;

const RANK: Record<Grade, number> = { S: 0, P: 1, D: 2, A: 3 };

/** A figure is provisional when any source it follows to is below `main-reread` (invariant 3); an A### is followed to its sources, an S### is its own source. */
export const isProvisional = (id: string): boolean => (id.startsWith("S") ? viewOf().sources[id]?.verification !== "main-reread" : (viewOf().assumptions[id]?.provisional ?? false));

/** The weakest grade among the A### ids (the grade of a bundle is the weakest of its parts); none when only S### ids are given. */
export const gradeOf = (ids: readonly string[]): Grade | null => {
  const { assumptions } = viewOf();
  const grades = ids.flatMap((id) => (assumptions[id] ? [assumptions[id].grade] : []));
  return grades.length === 0 ? null : grades.reduce((worst, g) => (RANK[g] > RANK[worst] ? g : worst));
};

export const knownId = (id: string): boolean => id in viewOf().assumptions || id in viewOf().sources;

/** The numeric range the ledger gives an id ([low, high]), or null when the range is a word (fixed, bundle, n/a) or the id is not in the view. */
export const rangeOf = (id: string): [number, number] | null => {
  const range = viewOf().assumptions[id]?.range;
  return Array.isArray(range) && range.length === 2 && range.every((v) => typeof v === "number") ? [range[0] as number, range[1] as number] : null;
};
