import type { BreakoutConfig } from "../../breakout/config.ts";
import type { Contrast } from "../../evaluate/effects.ts";
import type { EvaluationSettings } from "../../evaluate/config.ts";
import { truthFromRun } from "../../evaluate/truth.ts";
import { labelErrorRate } from "../../inject/rates.ts";
import { observeEvents } from "../../observe.ts";
import type { Params } from "../../profiles.ts";
import type { Architecture } from "../../record/architecture.ts";
import type { ReviewConfig, Roster } from "../../record/review.ts";
import type { BreakoutInput, QualificationInput } from "../../record/types.ts";
import type { ScenarioRun } from "../../run.ts";
import type { SamplingConfig } from "../../sampling.ts";
import { ENGINE_VERSION } from "../../trace.ts";
import type { EntryConfig } from "../../record/rule_types.ts";
import type { RawSetup } from "./raw_path.ts";
import type { SeedInput } from "./run_seed.ts";

// The experiment assembly may read truth (spec section 3, rule 2): it turns a truth run into the plain data the recorded side and the evaluator take.

export interface RunSettings {
  scenario_id: string;
  /** The staff profile of the samplers (A072, A073); its label-error parameters set the rate. */
  staff: Params;
  evaluation: EvaluationSettings;
  architectures: readonly Architecture[];
  /** The horizon in days (the denominator of utilisation). */
  days: number;
  contrast?: Contrast;
  /** Seconds each analyzer clock runs ahead (A049). */
  clock_offsets?: Readonly<Record<string, number>>;
  /** The review of held rows (A213 to A215): the roster of the scenario, the timing and the variants. */
  review: ReviewConfig;
  /** The raw device layer (ADR-0014); absent with the layer off. */
  raw?: RawSetup;
  entry_rules?: EntryConfig;
  /** The break-out block of the scenario (spec 11.8): present only on the break-out path, where the recorder is handed its master data and the evaluator the topology. Absent: nothing changes. */
  breakout?: BreakoutConfig;
}

/** The master data of the topology that the event stream does not carry (data_model 15.6, spec 11.8.9 C12): each lot with its kind and preparation time, each equipment item with its name. Never the hidden `contaminated_at`. */
export const breakoutMasterOf = (b: BreakoutConfig): BreakoutInput => ({
  lots: b.lots.map((l) => ({ lot_id: l.lot_id, kind: l.kind, prepared_at: l.prepared_s })),
  equipment: b.equipment.map((e) => ({ equipment_id: e.equipment_id, name: e.name })),
});

/** The roster of A201 as the scenario sets it (its sampling settings), as plain data for the review: the engine hard-codes no clock time. */
export const rosterOf = (s: SamplingConfig): Roster => ({ start_s: s.start_s, shift_change_s: s.shiftChange_s, end_weekday_s: s.endWeekday_s, end_weekend_s: s.endWeekend_s });

/** One qualification record per operator, valid from the start of the run with no end: the training status of the staff profile (A072, A073) as the record attests it. */
export const qualificationsOf = (run: Pick<ScenarioRun, "operators">): QualificationInput[] =>
  run.operators.map((o) => ({ qualification_id: `Q-${o.operator_id}`, operator_id: o.operator_id, qualified: o.qualified, valid_from: 0, valid_to: null }));

/** The layout of the plant for the controller side: which bay each unit sits in, read from the run (the assembly may read the process; the emitters get plain data). */
const withLayout = (raw: RawSetup, run: Pick<ScenarioRun, "process">): RawSetup =>
  raw.controller ? { ...raw, controller: { unit_bay: Object.fromEntries(run.process.reactors.map((r) => [r.unit_id, r.bay])), ...raw.controller } } : raw;

export const seedInputFromRun = (run: ScenarioRun, s: RunSettings): SeedInput => ({
  scenario_id: s.scenario_id,
  seed: run.l3Input.seed,
  engine_version: ENGINE_VERSION,
  truth: { ...truthFromRun(run), ...(s.breakout && { breakout: breakoutMasterOf(s.breakout) }) },
  events: observeEvents(run.events),
  sensors: run.observableSensors,
  architectures: s.architectures,
  label_rate_by_operator: Object.fromEntries(run.operators.map((o) => [o.operator_id, labelErrorRate(s.staff)])),
  ...(s.clock_offsets && { clock_offsets: s.clock_offsets }),
  qualifications: qualificationsOf(run),
  ...(s.raw && { raw: withLayout(s.raw, run) }),
  ...(s.entry_rules && { entry_rules: s.entry_rules }),
  ...(s.breakout && { breakout: breakoutMasterOf(s.breakout) }),
  // the tolerances of VR-003 and VR-004 have no ledger entry (scenarios/evaluation/default.json): those two rules are reported as not evaluable
  rules: { hold_limit_s: s.evaluation.hold_limit_s },
  review: s.review,
  config: { sla_s: s.evaluation.sla_s, staffed_window_s: s.evaluation.staffed_window_s, days: s.days, ...(s.contrast && { contrast: s.contrast }) },
});
