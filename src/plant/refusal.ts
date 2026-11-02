import type { Key } from "../i18n/index.ts";
import type { ErrorCode, RefusalReason } from "../protocol.ts";

// The sentence for a refusal (docs/design/plant_ui.md section 5.6, "As built in P6a"): one text for each reason of the table and for `locked`, and one for any other error of the Worker. The sentence
// says which rule was met; the Worker's own message, with the bound that was broken, is shown beside it verbatim.

export const REFUSAL_KEYS = [
  "plant.refusal.past", "plant.refusal.unknown_target", "plant.refusal.outside_window", "plant.refusal.closed_loop", "plant.refusal.limit", "plant.refusal.locked", "plant.refusal.other",
] as const satisfies readonly Key[];

const REASONS: readonly RefusalReason[] = ["past", "unknown_target", "outside_window", "closed_loop", "limit"];

export const refusalKey = (problem: { code: ErrorCode; reason?: RefusalReason }): (typeof REFUSAL_KEYS)[number] => {
  if (problem.code === "locked") return "plant.refusal.locked";
  if (problem.code === "refused" && problem.reason !== undefined && REASONS.includes(problem.reason)) return `plant.refusal.${problem.reason}`;
  return "plant.refusal.other";
};
