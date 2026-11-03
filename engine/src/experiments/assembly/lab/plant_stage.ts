import type { Metrics } from "../../../generated/metrics.schema";
import type { MaterialisedError } from "../../../inject/types.ts";
import { logHash } from "../../../trace.ts";
import { runSeed } from "../run_seed.ts";
import type { RecordedDataset } from "../../../record/types.ts";
import type { Challenges } from "./challenges.ts";
import { cellsDigest, checkPlantRequest, compare, keptHall, keptOf, planOf, previousRun, truthOf } from "./plant.ts";
import type { PlantAnswer, PlantKept, PlantSpec } from "./plant.ts";
import type { PlantRefusal } from "./actions.ts";
import type { PlanRecord } from "./plant_records.ts";
import { checkCaseSpec, isCaseSpec, stageCase } from "./plant_case.ts";
import { recordsOf } from "./plant_records.ts";
import { materialisedOf } from "./seed_setup.ts";
import type { LabData } from "./setup.ts";

// The progressive answer of the `plant_run` request (docs/design/plant_ui.md section 5.5): the truth run and the record of the first architecture of the spec are built and answered at once, as the
// plan with that one hall; the other architectures follow, one hall at a time, in the order of the spec. For a larger fleet the records dominate the cost, so the floor and the lens hall never wait
// for the others. Each hall is the recorders run for that one architecture on the same truth run; the plan assembled from the first answer and the halls is proven byte-equal to the plan of one
// build (`runPlant` in plant.ts), with the same hashes, by engine/tests/lab/worker_halls.test.ts. The halls that are built are added to the kept state, so `plant_record` reads them without
// a recompute.

/** One hall that came after the first answer: its record for the plan and the digest of its metric cells. */
export interface PlantHall {
  records: PlanRecord[];
  cells: Record<string, string>;
}

export interface PlantStaged {
  ok: true;
  /** The answer with the first architecture's hall only. */
  answer: PlantAnswer;
  /** Holds the first hall; each call of a function of `halls` adds the hall it builds. */
  kept: PlantKept;
  /** One function for each architecture after the first, in the order of the spec. A function builds its hall (the recorders run for it) and returns what the page merges. */
  halls: (() => Promise<PlantHall>)[];
}

export const stagePlant = async (data: LabData, spec: PlantSpec, previous?: PlantKept): Promise<PlantStaged | PlantRefusal> => {
  const made = truthOf(data, spec);
  if (!made.ok) return made;
  const t = made.truth;
  const kept = keptOf(t);
  /** The recorders for architecture `k` of the spec, on the truth run that is already made. */
  const build = (k: number) => async (): Promise<PlantHall> => {
    const architecture = t.architectures[k] as (typeof t.architectures)[number];
    const out = runSeed({ ...t.input, architectures: [architecture] });
    const dataset = out.datasets[architecture.id] as RecordedDataset;
    const records = recordsOf([dataset], t.samples);
    const errors = materialisedOf({ ...t.input, architectures: [architecture] })[architecture.id] as MaterialisedError[];
    kept.halls.set(architecture.id, keptHall(dataset, records[0] as PlanRecord, t.samples, errors));
    return { records, cells: { [architecture.id]: await cellsDigest(out.cells[0] as Metrics) } };
  };
  const first = await build(0)();
  return {
    ok: true,
    answer: { plan: planOf(data, t, first.records), ...compare(previousRun(previous), spec.actions, t.run.events), hashes: { truth: await logHash(t.run.events), cells: first.cells } },
    kept,
    halls: t.architectures.slice(1).map((_, k) => build(k + 1)),
  };
};

/** The `plant_run` request as the Worker receives it, answered progressively: the spec is checked and a locked run is refused (`checkPlantRequest`), then `stagePlant`. */
export const answerPlantStart = async (data: LabData, challenges: Challenges, raw: { spec: unknown }, previous?: PlantKept): Promise<PlantStaged | PlantRefusal> => {
  // a break-out case (plant_ui.md section 6, rule 11): checked as the `breakout` request is, and no challenge can lock it
  if (isCaseSpec(raw.spec)) {
    const asked = checkCaseSpec(data, raw.spec);
    return asked.ok ? stageCase(data, asked, previous) : asked;
  }
  const checked = checkPlantRequest(data, challenges, raw);
  return checked.ok ? stagePlant(data, checked.spec, previous) : checked;
};
