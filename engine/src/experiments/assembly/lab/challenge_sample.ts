import { DRAWN_TYPES, ERROR_TYPES } from "../../../inject/types.ts";
import type { ForcedError, MaterialisedError } from "../../../inject/types.ts";
import type { Architecture } from "../../../record/architecture.ts";
import type { RecordedDataset } from "../../../record/types.ts";
import type { ScenarioRun } from "../../../run.ts";
import { runSeed } from "../run_seed.ts";
import type { SeedInput } from "../run_seed.ts";
import { announceType, pickSamplePlant } from "./challenge_plant.ts";
import type { RecordView, Reveal, Score } from "./challenge_types.ts";
import { lineageView, sampleRecordOf } from "./lineage.ts";
import type { SampleRecord } from "./lineage.ts";
import { affectedOf, outcomeOf } from "./outcome.ts";
import { sampleTruth } from "./pick.ts";
import { recordViewOf } from "./record_view.ts";
import { architecturesNamed, comparedWith, labSeed, materialisedOf } from "./seed_setup.ts";
import type { LabData } from "./setup.ts";
import type { RunSpec } from "./spec.ts";

// 2026-10-30 S3e, the sample variant of the challenge (docs/design/lab_ui.md section 9). The Worker keeps a `SampleChallenge` under the challenge id: the truth run, the plant and the injector's
// list. The page receives the announced type and the shown record (`startSampleChallenge`), drill-downs of single samples (`openSample`), and only after the guess or the give-up the reveal
// (`revealSample`). Nothing of the plant is in what the first two return.

export interface SampleChallenge {
  variant: "sample";
  /** The id of the shown architecture. */
  shown: string;
  plant: ForcedError;
  /** The injector's realised errors of the shown architecture in the planted run: the plant, and the structural errors that every run has. */
  materialised: MaterialisedError[];
  /** The planted run's input to `runSeed` (without the architectures other than the shown one), kept for the reveal. */
  input: SeedInput;
  run: ScenarioRun;
  /** The shown architecture's record of the planted run. */
  ds: RecordedDataset;
  /** The structural types on every sample of the shown record (`ubiquitousOf`): left out of `background`. */
  ubiquitous: string[];
  /** The records the reveal compares: the presets A, B and C in order, then the shown architecture when it is an ablation of C. */
  compared: Architecture[];
}

export type SampleStart = { ok: true; challenge: SampleChallenge; announced_type: string; record: RecordView } | { ok: false; message: string };

/** The deciding flag of each drawn type (ADR-0005's flag table): the one whose state decides whether the error arises. */
export const DECIDING_FLAG = { label_error: "system_issued_id", unit_rekey: "write_time_keys", duplicate_replay: "ingest_idempotency" } as const;

const isStructural = (type: string): boolean => !(DRAWN_TYPES as readonly string[]).includes(type);

/** The structural types that every sample of the record carries (docs/design/lab_ui.md section 9, the author's ruling of 2026-10-30), in the order of `ERROR_TYPES`. None for a record with no sample. */
export const ubiquitousOf = (materialised: readonly MaterialisedError[], sampleIds: readonly string[]): string[] => {
  const on = new Map<string, Set<string>>();
  for (const m of materialised) if (isStructural(m.type)) on.set(m.type, (on.get(m.type) ?? new Set<string>()).add(m.sample_id));
  return sampleIds.length === 0 ? [] : ERROR_TYPES.filter((t) => sampleIds.every((id) => on.get(t)?.has(id)));
};

/**
 * Plant one error and record the run under the shown architecture. The caller has checked the spec, the seed and that `shown` names an architecture. The planted error enters the run through
 * `runSeed`'s `forced` input, which bypasses the rates, so the only drawn error of the run is the planted one.
 */
export const startSampleChallenge = (data: LabData, spec: RunSpec, seed: number, shown: string): SampleStart => {
  const [architecture] = architecturesNamed(data, [shown]);
  if (!architecture) return { ok: false, message: `unknown architecture ${JSON.stringify(shown)}` };
  const type = announceType(seed, architecture);
  if (type === null) return { ok: false, message: `${shown} cannot be shown: every drawn type is prevented in this record, so a planted error would leave nothing in it` };
  const { run, input } = labSeed(data, spec, seed, [architecture]);
  const plant = pickSamplePlant(seed, type, run.events);
  if (plant === null) return { ok: false, message: "this run has no sample that the planted error could be placed on" };
  const planted: SeedInput = { ...input, forced: [plant] };
  const ds = runSeed(planted).datasets[shown] as RecordedDataset;
  const materialised = materialisedOf(planted)[shown] ?? [];
  const ubiquitous = ubiquitousOf(materialised, ds.sample.map((s) => s.sample_id));
  return { ok: true, challenge: { variant: "sample", shown, plant, materialised, input: planted, run, ds, ubiquitous, compared: comparedWith(data, shown) }, announced_type: type, record: recordViewOf(ds, ubiquitous) };
};

/** The drill-down of section 8 for one sample of the shown record, without truth, verdicts or realised errors; null for an id the record does not hold. */
export const openSample = (c: SampleChallenge, sample_id: string): SampleRecord | null => (c.ds.sample.some((s) => s.sample_id === sample_id) ? sampleRecordOf(c.ds, sample_id) : null);

/** Whether the shown record holds a sample (the page guesses among them). */
export const hasSample = (c: SampleChallenge, sample_id: string): boolean => c.ds.sample.some((s) => s.sample_id === sample_id);

const scoreOf = (c: SampleChallenge, guess: string): Score => {
  if (affectedOf(c.plant).includes(guess)) return { result: "hit" };
  const structural = c.materialised.find((m) => m.sample_id === guess && isStructural(m.type) && !c.ubiquitous.includes(m.type));
  return structural ? { result: "background", background_type: structural.type } : { result: "miss" };
};

/**
 * The reveal: the planted error, the score of the guess (none after a give-up), the same planted error on the same run recorded by A, B, C and the shown ablation, and the three-column lineage
 * of the planted sample. `guess` is a sample id, or null for a give-up.
 */
export const revealSample = (c: SampleChallenge, guess: string | null): Reveal => {
  const input: SeedInput = { ...c.input, architectures: c.compared };
  const datasets = c.compared.map((a) => runSeed({ ...input, architectures: [a] }).datasets[a.id] as RecordedDataset);
  const materialised = materialisedOf(input);
  const flag = DECIDING_FLAG[c.plant.type];
  const truth = sampleTruth(c.run, c.plant.sample_id);
  if (truth === null) throw new Error(`challenge: the planted sample ${c.plant.sample_id} is not in the run`);
  const entry = c.materialised.find((m) => m.type === c.plant.type && m.sample_id === c.plant.sample_id);
  return {
    planted: { type: c.plant.type, affected: affectedOf(c.plant), detail: { ...(entry?.detail ?? {}) } },
    score: guess === null ? null : scoreOf(c, guess),
    per_architecture: c.compared.map((a, i) => ({
      architecture: a.id,
      ...outcomeOf(c.plant, datasets[i] as RecordedDataset, materialised[a.id] ?? []),
      reading: `flag.${flag}.${a.flags[flag] ? "on" : "off"}`,
    })),
    lineage: lineageView(truth, "challenge", datasets, materialised),
  };
};
