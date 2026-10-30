import type { ForcedError } from "../../../inject/types.ts";
import { createRng } from "../../../rng.ts";
import type { Rng } from "../../../rng.ts";
import { decisionTruth, neighbourOf } from "./decisions.ts";
import type { DecisionLoop } from "./decisions.ts";

// 2026-10-30 S3d (docs/design/lab_ui.md section 9, "How the planted error reaches a decision"): which sample the decision variant plants. Eligible: a sample whose pH row a decision of the shown
// architecture reads (the action is readjust or skip) in the unplanted loop of the seed, and which has a neighbouring draw whose id the label takes. One keyed draw per eligible sample,
// key (run_seed, sample_id, "-", 0, "challenge:pick_decision"); the eligible sample with the smallest u is planted. A draw is a function of its own sample's key, so an added sample or a
// rerun never moves another sample's draw (spec section 3, rule 3), and no key carries a label text.

export interface PlantCandidate {
  sample_id: string;
  /** The id the label reads: the neighbour's. */
  as_id: string;
}

/** Truth side, in order of sample id. Takes the unplanted loop. */
export const eligibleSamples = (unplanted: DecisionLoop): PlantCandidate[] => {
  const read = new Set<string>();
  for (const d of unplanted.decisions) {
    if (d.action === "none") continue;
    const from = decisionTruth(unplanted, d.decision_id)?.from_sample;
    if (from !== undefined) read.add(from);
  }
  return [...read]
    .sort()
    .flatMap((sample_id) => {
      const as_id = neighbourOf(unplanted, sample_id);
      return as_id === null ? [] : [{ sample_id, as_id }];
    });
};

/** The forced label error of the decision variant, or null when no decision of the unplanted loop reads a plantable sample. */
export const pickDecisionPlant = (seed: number, unplanted: DecisionLoop, rng: Rng = createRng()): ForcedError | null => {
  let best: (PlantCandidate & { u: number }) | null = null;
  for (const c of eligibleSamples(unplanted)) {
    const u = rng.stream([seed, c.sample_id, "-", 0, "challenge:pick_decision"]).float();
    // the candidates are in order of sample id, so a tie keeps the smaller id
    if (best === null || u < best.u) best = { ...c, u };
  }
  return best === null ? null : { type: "label_error", sample_id: best.sample_id, detail: { as_id: best.as_id } };
};
