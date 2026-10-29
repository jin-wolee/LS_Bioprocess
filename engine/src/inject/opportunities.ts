import { createRng } from "../rng.ts";
import type { Rng } from "../rng.ts";
import { DRAWN_TYPES } from "./types.ts";
import type { Opportunity } from "./types.ts";

/**
 * The common error opportunities of one physical sample: one keyed draw per drawn type, key (run_seed, sample_id, "-", 0, "error:<type>").
 * The function has no architecture and no detection input, so the opportunities are the same in every architecture and an added sample
 * never moves another sample's draws.
 */
export const drawOpportunities = (seed: number, sampleId: string, rng: Rng = createRng()): Opportunity[] =>
  DRAWN_TYPES.map((type) => ({ type, u: rng.stream([seed, sampleId, "-", 0, `error:${type}`]).float() }));
