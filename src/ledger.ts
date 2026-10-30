import view from "./generated/ledger_view.json";

// Grade, range and sources of the ledger ids the lab names, written from the ledgers by scripts/lab_ledger.py (docs/design/lab_ui.md section 6). The page never reads a ledger itself.

export type Grade = "S" | "P" | "D" | "A";

interface AssumptionView {
  grade: Grade;
  range: unknown;
  unit: string;
  sources: string[];
  provisional: boolean;
}

const assumptions = view.assumptions as Record<string, AssumptionView>;
const sources = view.sources as Record<string, { verification: string }>;

const RANK: Record<Grade, number> = { S: 0, P: 1, D: 2, A: 3 };

/** A figure is provisional when any source it follows to is below `main-reread` (invariant 3); an A### is followed to its sources, an S### is its own source. */
export const isProvisional = (id: string): boolean => (id.startsWith("S") ? sources[id]?.verification !== "main-reread" : (assumptions[id]?.provisional ?? false));

/** The weakest grade among the A### ids (the grade of a bundle is the weakest of its parts); none when only S### ids are given. */
export const gradeOf = (ids: readonly string[]): Grade | null => {
  const grades = ids.flatMap((id) => (assumptions[id] ? [assumptions[id].grade] : []));
  return grades.length === 0 ? null : grades.reduce((worst, g) => (RANK[g] > RANK[worst] ? g : worst));
};

export const knownId = (id: string): boolean => id in assumptions || id in sources;
