import { parseActions } from "./actions.ts";
import type { PlantRefusal } from "./actions.ts";
import { checkSeed } from "./challenges.ts";
import type { Challenges, Refusal } from "./challenges.ts";
import { lineageOn, runLineage } from "./lineage.ts";
import type { LineageView } from "./lineage.ts";
import { truthOf } from "./plant.ts";
import type { LabData } from "./setup.ts";
import { checkRunSpec } from "./spec.ts";

// 2026-10-30 S3e (docs/design/lab_ui.md section 4): the `lineage` request as the Worker receives it. The spec and the seed are user input and are checked; a run that is an unrevealed challenge is
// refused with `locked` (rule 2), so the lineage screen cannot be used to read the truth of a challenge in progress. The answer is the view and the ids of the run's samples.
//
// P5c (docs/design/plant_ui.md section 6, rule 9): the request takes the operator actions of the plant it was opened from, so that the view of a sample is made from the run the plant shows. With none,
// or an empty list, nothing below the check of the list runs and the answer is what it was. With some, the order is that of `plant_run`: the shape of the list, the lock of a challenge, then the
// bounds of each action against the run (`truthOf`, which also applies them to the scenario), and the view is made over that truth run.

export type LineageAnswer = { ok: true; view: LineageView; sample_ids: string[] } | Refusal | PlantRefusal;

export const answerLineage = (data: LabData, challenges: Challenges, raw: { spec: unknown; seed: unknown; pick: unknown; actions?: unknown }): LineageAnswer => {
  const invalid = (message: string): Refusal => ({ ok: false, code: "invalid_spec", message });
  const spec = checkRunSpec(raw.spec, data);
  if (!spec.ok) return invalid(spec.message);
  const seed = checkSeed(raw.seed);
  if (!seed.ok) return invalid(seed.message);
  const pick = raw.pick as { rule?: unknown; sample_id?: unknown } | null;
  const rule = pick?.rule === "sc3";
  if (!rule && typeof pick?.sample_id !== "string") return invalid('pick must be {"rule":"sc3"} or {"sample_id": "<id>"}');
  const listed = raw.actions === undefined ? null : parseActions(raw.actions);
  if (listed && !listed.ok) return listed;
  if (challenges.locked(spec.spec, seed.seed)) return { ok: false, code: "locked", message: "this run is a challenge that has not been revealed; the lineage view of it opens after the guess or the give-up" };
  const which = rule ? { rule: "sc3" as const } : { sample_id: pick?.sample_id as string };
  if (listed === null || listed.actions.length === 0) {
    const out = runLineage({ data, spec: spec.spec, seed: seed.seed, pick: which });
    return out.ok ? out : invalid(out.message);
  }
  if (spec.spec.architectures.length === 0) return invalid("a lineage view needs at least one architecture");
  const made = truthOf(data, { run: spec.spec, seed: seed.seed, actions: listed.actions });
  if (!made.ok) return made;
  const out = lineageOn(made.truth.run, made.truth.input, which);
  return out.ok ? out : invalid(out.message);
};
