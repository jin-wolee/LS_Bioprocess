import type { Metrics } from "../../generated/metrics.schema";
import { evaluate } from "../../evaluate/evaluate.ts";
import type { EvalConfig } from "../../evaluate/config.ts";
import type { Truth } from "../../evaluate/truth.ts";
import { inject } from "../../inject/inject.ts";
import type { ForcedError } from "../../inject/types.ts";
import type { ObservableEvent, ObservableSensorSeries } from "../../observe.ts";
import type { Architecture } from "../../record/architecture.ts";
import { record } from "../../record/recorder.ts";
import { review } from "../../record/review.ts";
import type { ReviewConfig } from "../../record/review.ts";
import type { QualificationInput, RecordedDataset } from "../../record/types.ts";
import { validate } from "../../record/validate.ts";
import type { RuleConfig } from "../../record/validate.ts";
import { NOT_APPLICABLE, observationsOf, rawMetrics } from "../../evaluate/raw_metrics.ts";
import type { RawMetrics } from "../../evaluate/raw_metrics.ts";
import { resolveCapturePath } from "../../record/capture.ts";
import type { CapturePath } from "../../raw/types.ts";
import type { EntryConfig } from "../../record/rule_types.ts";
import { keyFile } from "./key_file.ts";
import { rawPath } from "./raw_path.ts";
import type { RawSetup } from "./raw_path.ts";
import { rawKeyFile } from "./raw_key_file.ts";

// One truth run, every architecture: inject (fair opportunities), record, validate, review, write the answer key once, evaluate. The truth run is shared,
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
  /** The raw device layer (ADR-0014). Absent: the recorders consume the observable events as before, and nothing here changes. */
  raw?: RawSetup;
  /** The method's units, bounds and dilution rule for the rules on a typed entry (VR-005, VR-006, VR-013); read only on manual_transcription. */
  entry_rules?: EntryConfig;
  rules: RuleConfig;
  /** The review of held and quarantined rows (A213 to A215, S2 review step): the roster, the timing and the sensitivity variants. */
  review: ReviewConfig;
  config: EvalConfig;
}

/** The raw layer of one architecture: its capture path, the raw quirk key (the evaluator's) and the ingest metrics, or "not applicable" on manual_transcription. */
export interface RawRun {
  path: CapturePath;
  key_text: string;
  metrics: RawMetrics | typeof NOT_APPLICABLE;
}

export interface SeedOutput {
  key_text: string;
  cells: Metrics[];
  datasets: Record<string, RecordedDataset>;
  /** Present only with the raw layer on, by architecture id. */
  raw?: Record<string, RawRun>;
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
  const rawRuns: Record<string, RawRun> = {};
  const cells = input.architectures.map((architecture, i) => {
    const out = injected[i] as (typeof injected)[number];
    // the raw layer: the files are emitted from the same rows and draws on both capture paths; the path decides what the recorder is given
    const captured = input.raw ? rawPath({ setup: input.raw, seed: input.seed, architecture, path: resolveCapturePath(architecture, input.raw.capture_path), events: out.events, received_at: out.received_at }) : null;
    const recorded = record({ events: captured?.events ?? out.events, sensors: input.sensors, received_at: captured?.received_at ?? out.received_at, ...(input.qualifications && { qualifications: input.qualifications }), ...(captured && { capture: captured.capture }) }, architecture);
    if (captured) {
      const head = { engine_version: input.engine_version, scenario_id: input.scenario_id, seed: input.seed, architecture: architecture.id, capture_path: captured.path };
      rawRuns[architecture.id] = { path: captured.path, key_text: rawKeyFile(head, captured.key), metrics: captured.tables ? rawMetrics(observationsOf(captured.key.files, captured.outputs)) : NOT_APPLICABLE };
    }
    const validated = validate(captured?.tables ? { ...recorded, raw: captured.tables } : recorded, { ...input.rules, ...(input.entry_rules && { entry: input.entry_rules }) });
    const reviewed = review(validated.dataset, input.review);
    datasets[architecture.id] = reviewed;
    return evaluate({ truth: input.truth, dataset: reviewed, not_evaluable: validated.not_evaluable, key_text, architecture: architecture.id, config: input.config });
  });
  return { key_text, cells, datasets, ...(input.raw && { raw: rawRuns }) };
};
