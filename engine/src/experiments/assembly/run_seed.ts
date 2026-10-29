import type { Metrics } from "../../generated/metrics.schema";
import { evaluate } from "../../evaluate/evaluate.ts";
import type { EvalConfig } from "../../evaluate/config.ts";
import type { Truth } from "../../evaluate/truth.ts";
import { inject } from "../../inject/inject.ts";
import type { ForcedError } from "../../inject/types.ts";
import type { ObservableEvent, ObservableSensorSeries } from "../../observe.ts";
import type { Architecture } from "../../record/architecture.ts";
import { record } from "../../record/recorder.ts";
import type { QualificationInput, RecordedDataset } from "../../record/types.ts";
import { validate } from "../../record/validate.ts";
import type { RuleConfig } from "../../record/validate.ts";
import { keyFile } from "./key_file.ts";

// One truth run, every architecture: inject (fair opportunities), record, validate, write the answer key once, evaluate. The truth run is shared,
// so the truth log is the same for every architecture (experiment 1, spec section 6.1). Detection raises flags and never re-draws or re-measures.

export interface SeedInput {
  scenario_id: string;
  seed: number;
  engine_version: string;
  truth: Truth;
  events: readonly ObservableEvent[];
  sensors: readonly ObservableSensorSeries[];
  architectures: readonly Architecture[];
  /** Production: the label-error probability of each operator (from the staff profile, via inject/rates.ts). */
  label_rate_by_operator?: Readonly<Record<string, number>>;
  clock_offsets?: Readonly<Record<string, number>>;
  /** Forced mode (fixtures): the errors to materialise; the rates are not read. */
  forced?: readonly ForcedError[];
  qualifications?: readonly QualificationInput[];
  rules: RuleConfig;
  config: EvalConfig;
}

export interface SeedOutput {
  key_text: string;
  cells: Metrics[];
  datasets: Record<string, RecordedDataset>;
}

export const runSeed = (input: SeedInput): SeedOutput => {
  const injected = input.architectures.map((architecture) =>
    inject({
      seed: input.seed, architecture, events: input.events,
      ...(input.label_rate_by_operator && { label_rate_by_operator: input.label_rate_by_operator }),
      ...(input.clock_offsets && { clock_offsets: input.clock_offsets }),
      ...(input.forced && { forced: input.forced }),
    }),
  );
  const key_text = keyFile({ engine_version: input.engine_version, scenario_id: input.scenario_id, seed: input.seed }, Object.fromEntries(input.architectures.map((a, i) => [a.id, injected[i] as (typeof injected)[number]])));
  const datasets: Record<string, RecordedDataset> = {};
  const cells = input.architectures.map((architecture, i) => {
    const out = injected[i] as (typeof injected)[number];
    const recorded = record({ events: out.events, sensors: input.sensors, received_at: out.received_at, ...(input.qualifications && { qualifications: input.qualifications }) }, architecture);
    const validated = validate(recorded, input.rules);
    datasets[architecture.id] = validated.dataset;
    return evaluate({ truth: input.truth, dataset: validated.dataset, not_evaluable: validated.not_evaluable, key_text, architecture: architecture.id, config: input.config });
  });
  return { key_text, cells, datasets };
};
