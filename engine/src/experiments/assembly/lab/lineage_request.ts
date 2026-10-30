import { checkSeed } from "./challenges.ts";
import type { Challenges, Refusal } from "./challenges.ts";
import { runLineage } from "./lineage.ts";
import type { LineageView } from "./lineage.ts";
import type { LabData } from "./setup.ts";
import { checkRunSpec } from "./spec.ts";

// 2026-10-30 S3e (docs/design/lab_ui.md section 4): the `lineage` request as the Worker receives it. The spec and the seed are user input and are checked; a run that is an unrevealed challenge is
// refused with `locked` (rule 2), so the lineage screen cannot be used to read the truth of a challenge in progress. The answer is the view and the ids of the run's samples.

export type LineageAnswer = { ok: true; view: LineageView; sample_ids: string[] } | Refusal;

export const answerLineage = (data: LabData, challenges: Challenges, raw: { spec: unknown; seed: unknown; pick: unknown }): LineageAnswer => {
  const invalid = (message: string): Refusal => ({ ok: false, code: "invalid_spec", message });
  const spec = checkRunSpec(raw.spec, data);
  if (!spec.ok) return invalid(spec.message);
  const seed = checkSeed(raw.seed);
  if (!seed.ok) return invalid(seed.message);
  const pick = raw.pick as { rule?: unknown; sample_id?: unknown } | null;
  const rule = pick?.rule === "sc3";
  if (!rule && typeof pick?.sample_id !== "string") return invalid('pick must be {"rule":"sc3"} or {"sample_id": "<id>"}');
  if (challenges.locked(spec.spec, seed.seed)) return { ok: false, code: "locked", message: "this run is a challenge that has not been revealed; the lineage view of it opens after the guess or the give-up" };
  const out = runLineage({ data, spec: spec.spec, seed: seed.seed, pick: rule ? { rule: "sc3" } : { sample_id: pick?.sample_id as string } });
  return out.ok ? out : invalid(out.message);
};
