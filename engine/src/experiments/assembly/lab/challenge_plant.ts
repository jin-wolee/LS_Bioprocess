import { prevented } from "../../../inject/catalogue.ts";
import { DRAWN_TYPES } from "../../../inject/types.ts";
import type { DrawnType, ForcedError } from "../../../inject/types.ts";
import type { Architecture } from "../../../record/architecture.ts";
import { createRng } from "../../../rng.ts";
import type { Rng } from "../../../rng.ts";
import type { ScenarioRun } from "../../../run.ts";

// 2026-10-30 S3e, the plant of the sample variant of the challenge (docs/design/lab_ui.md section 9, "How the planted error is drawn"). Two keyed draws, both with the canonical tuple
// (run_seed, id, analyte, attempt, purpose): the type, and one draw per eligible sample. A draw is a function of its own key, so an added sample or a rerun never moves another sample's
// draw (spec section 3, rule 3), and no key carries a label text. This reads the truth events (the assembly may); it returns the injector's forced error and nothing else.

type Events = ScenarioRun["events"];

/** The drawn types of the catalogue that an architecture does not prevent, in catalogue order. The structural types are present by construction and are never the planted one. */
export const offeredTypes = (architecture: Pick<Architecture, "flags">): DrawnType[] => DRAWN_TYPES.filter((type) => !prevented(type, architecture.flags));

/** The type to announce for a run seed: key (seed, "challenge", "-", 0, "challenge:type"), the index floor(u times n) into the offered types. Null when the architecture prevents all of them. */
export const announceType = (seed: number, shown: Pick<Architecture, "flags">, rng: Rng = createRng()): DrawnType | null => {
  const offered = offeredTypes(shown);
  if (offered.length === 0) return null;
  const u = rng.stream([seed, "challenge", "-", 0, "challenge:type"]).float();
  return offered[Math.floor(u * offered.length)] as DrawnType;
};

/**
 * The sample to plant: eligible are the samples that were drawn and have at least one measured result, and for a label error a neighbouring draw whose id the label takes (the next draw,
 * else the previous one: the production content of a label error, inject/inject.ts), for a re-key another unit. One draw per eligible sample, key (seed, sample_id, "-", 0,
 * "challenge:pick"); the smallest u is planted, a tie keeps the smaller id. A re-key names its target unit by one more keyed draw on the planted sample ("challenge:rekey_unit") among
 * the other units in plain order. Null when no sample is eligible.
 */
export const pickSamplePlant = (seed: number, type: DrawnType, events: Events, rng: Rng = createRng()): ForcedError | null => {
  const drawn = events.flatMap((e) => (e.type === "sample_drawn" ? [e] : []));
  const measured = new Set(events.flatMap((e) => (e.type === "result_measured" ? [e.request_id] : [])));
  const units = [...new Set(events.flatMap((e) => (e.type === "inoculation" ? [e.unit_id] : [])).concat(drawn.map((d) => d.unit_id)))].sort();
  let best: { sample_id: string; unit_id: string; as_id: string | undefined; u: number } | null = null;
  const eligible = drawn
    .map((d, i) => ({ sample_id: d.sample_id, unit_id: d.unit_id, as_id: drawn[i + 1]?.sample_id ?? drawn[i - 1]?.sample_id }))
    .filter((c) => measured.has(c.sample_id) && (type !== "label_error" || c.as_id !== undefined) && (type !== "unit_rekey" || units.some((x) => x !== c.unit_id)))
    .sort((a, b) => (a.sample_id < b.sample_id ? -1 : a.sample_id > b.sample_id ? 1 : 0));
  for (const c of eligible) {
    const u = rng.stream([seed, c.sample_id, "-", 0, "challenge:pick"]).float();
    if (best === null || u < best.u) best = { ...c, u };
  }
  if (best === null) return null;
  if (type === "label_error") return { type, sample_id: best.sample_id, detail: { as_id: best.as_id as string } };
  if (type === "unit_rekey") {
    const others = units.filter((x) => x !== best?.unit_id);
    const to_unit = others[Math.floor(rng.stream([seed, best.sample_id, "-", 0, "challenge:rekey_unit"]).float() * others.length)] as string;
    return { type, sample_id: best.sample_id, detail: { to_unit } };
  }
  return { type, sample_id: best.sample_id };
};
