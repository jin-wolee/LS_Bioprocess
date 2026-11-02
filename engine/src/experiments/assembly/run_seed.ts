import type { Metrics } from "../../generated/metrics.schema";
import { evaluate } from "../../evaluate/evaluate.ts";
import type { EvalConfig } from "../../evaluate/config.ts";
import { HOLD_RULE, holdLimit } from "../../evaluate/hold_limit.ts";
import type { HoldLimit } from "../../evaluate/hold_limit.ts";
import type { Truth } from "../../evaluate/truth.ts";
import { inject } from "../../inject/inject.ts";
import type { ForcedError } from "../../inject/types.ts";
import type { ObservableEvent, ObservableSensorSeries } from "../../observe.ts";
import type { Architecture } from "../../record/architecture.ts";
import { record } from "../../record/recorder.ts";
import { review } from "../../record/review.ts";
import type { ReviewConfig } from "../../record/review.ts";
import type { BreakoutInput, QualificationInput, RecordedDataset } from "../../record/types.ts";
import { validate } from "../../record/validate.ts";
import type { RuleConfig } from "../../record/validate.ts";
import { NOT_APPLICABLE, controllerObservations, observationsOf, rawMetrics } from "../../evaluate/raw_metrics.ts";
import type { RawMetrics } from "../../evaluate/raw_metrics.ts";
import { resolveCapturePath } from "../../record/capture.ts";
import type { CapturePath } from "../../raw/types.ts";
import type { EntryConfig } from "../../record/rule_types.ts";
import { keyFile } from "./key_file.ts";
import { physicalIds } from "./physical_ids.ts";
import { rawPath } from "./raw_path.ts";
import type { RawSetup } from "./raw_path.ts";
import { rawKeyFile } from "./raw_key_file.ts";
import { controllerPath, mergeTables } from "./raw_controller.ts";

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
  /** The break-out path only (spec 11.8.9 C12): the master data of the topology, handed to the recorder beside the events. Absent: the recorder ignores the break-out events and writes none of the tables of the extension. */
  breakout?: BreakoutInput;
  rules: RuleConfig;
  /** Ask for the hold-time rule's share of the result (spec section 8): the open-loop experiment and the lab's Results do; the views of one sample and the plant do not. Default false. */
  with_hold_limit?: boolean;
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
  /** The hold-time rule's share of the result, by architecture, when the input asked for it; null where the record stores no hold time and the rule cannot run (spec section 8). Not part of a cell's metrics. */
  hold_limit: Record<string, HoldLimit | null>;
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
  const hold_limit: Record<string, HoldLimit | null> = {};
  const rawRuns: Record<string, RawRun> = {};
  const cells = input.architectures.map((architecture, i) => {
    const out = injected[i] as (typeof injected)[number];
    // the raw layer: the files are emitted from the same rows and draws on both capture paths; the path decides what the recorder is given
    const captured = input.raw ? rawPath({ setup: input.raw, seed: input.seed, architecture, path: resolveCapturePath(architecture, input.raw.capture_path), events: out.events, received_at: out.received_at, physical: physicalIds(input.events, out.events) }) : null;
    // S2e2: the controller logs. Machine files, so only the adapter path has them (spec 5, "Capture path", rule 3); the layer off, or a layer on with no bay controller, has none
    const controller = captured && input.raw?.controller
      ? controllerPath({ setup: input.raw.controller, anchor_epoch_s: input.raw.anchor_epoch_s, zone_offset_s: input.raw.zone_offset_s, path: captured.path, flags: { ingest_idempotency: architecture.flags.ingest_idempotency }, events: input.events, sensors: input.sensors })
      : null;
    const capture = captured && controller ? { ...captured.capture, historian: controller.historian, findings: [...(captured.capture.findings ?? []), ...controller.findings] } : captured?.capture;
    const recorded = record({ events: captured?.events ?? out.events, sensors: input.sensors, received_at: captured?.received_at ?? out.received_at, ...(input.qualifications && { qualifications: input.qualifications }), ...(capture && { capture }), ...(input.breakout && { breakout: input.breakout }) }, architecture);
    const tables = captured?.tables && controller ? mergeTables(captured.tables, controller.tables) : captured?.tables;
    if (captured) {
      const head = { engine_version: input.engine_version, scenario_id: input.scenario_id, seed: input.seed, architecture: architecture.id, capture_path: captured.path };
      const key = controller ? { ...captured.key, not_modelled: [...captured.key.not_modelled, ...controller.not_modelled] } : captured.key;
      rawRuns[architecture.id] = { path: captured.path, key_text: rawKeyFile(head, key), metrics: captured.tables ? rawMetrics([...observationsOf(captured.key.files, captured.outputs), ...(controller ? controllerObservations(controller.outputs) : [])]) : NOT_APPLICABLE };
    }
    const toValidate = tables ? { ...recorded, raw: tables } : recorded;
    const rules = (hold_limit_s: number | undefined) => ({ ...input.rules, ...(hold_limit_s !== undefined && { hold_limit_s }), ...(input.entry_rules && { entry: input.entry_rules }) });
    const validated = validate(toValidate, rules(input.rules.hold_limit_s));
    const reviewed = review(validated.dataset, input.review);
    datasets[architecture.id] = reviewed;
    const cell = evaluate({ truth: input.truth, dataset: reviewed, not_evaluable: validated.not_evaluable, key_text, architecture: architecture.id, config: input.config });
    if (input.with_hold_limit) {
      // the hold-time rule's share (spec section 8): absent where the rule cannot run; otherwise the same rows validated and reviewed again with the limit lifted, only if the rule rejected a request
      hold_limit[architecture.id] = validated.not_evaluable.some((n) => n.rule === HOLD_RULE)
        ? null
        : holdLimit({ truth: input.truth, dataset: reviewed, cell, key_text, architecture: architecture.id, lifted: () => review(validate(toValidate, rules(Number.POSITIVE_INFINITY)).dataset, input.review) });
    }
    return cell;
  });
  return { key_text, cells, hold_limit, datasets, ...(input.raw && { raw: rawRuns }) };
};
