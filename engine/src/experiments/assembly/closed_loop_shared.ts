import type { EvaluationSettings } from "../../evaluate/config.ts";
import type { ForcedError, MaterialisedError } from "../../inject/types.ts";
import { observeEvents } from "../../observe.ts";
import type { Architecture } from "../../record/architecture.ts";
import { record } from "../../record/recorder.ts";
import { review } from "../../record/review.ts";
import type { ReviewTiming } from "../../record/review.ts";
import type { RecordedDataset, ResultRow } from "../../record/types.ts";
import { validate } from "../../record/validate.ts";
import type { Rng } from "../../rng.ts";
import type { ScenarioRun } from "../../run.ts";
import type { ScenarioConfig } from "../../scenario.ts";
import type { PhLoopConfig } from "../../sensors.ts";
import type { StabilityEffect } from "../../stability.ts";
import { plantStream } from "./closed_loop_plant.ts";
import { qualificationsOf, rosterOf } from "./from_run.ts";

// 2026-10-30 S2c3, experiment 2 (spec 6.2): what every arm of one seed shares. The lab run of the seed is the open-loop run of the scenario (its pH values are placeholders:
// the pH of the culture is the output of each arm's loop, and nothing else in the lab depends on it), so the draws, the sample times, the queue and the analyzer noise are
// the same for every arm (common random numbers through the canonical key). From it: per reactor, the online pH noise of the run and the pH results of each sample with
// the hold they had; per sample, the container (a technique error leaves a pH sample open, A064); per architecture, the recorded structure (record, rules, review) of the lab
// run. The rules and the review read times, keys, versions and QC outcomes, never a pH value (data_model section 7), so the structure holds for every arm's values; a test
// shifts the values and compares. This file reads truth: it belongs to the experiment assembly (spec section 3, rule 2).

/** A pH result of a sample in the lab run: the run it came from, its instant, the analyzer noise on it (hidden, A078) and the hold before the run. */
export interface SharedResult {
  run_id: string;
  t: number;
  noise: number;
  hold_s: number;
}

export interface SharedSample {
  sample_id: string;
  drawn_s: number;
  /** The instant the first pH result exists. */
  first_t: number;
  container: "open" | "closed";
  results: SharedResult[];
}

export interface SharedReactor {
  unit_id: string;
  t0_s: number;
  cadence_s: number;
  /** The noise of the online pH reading at each tick, as the open-loop series drew it (A199). */
  noise: Float64Array;
  /** Samples with a pH result, by the instant of the first result. */
  samples: SharedSample[];
}

/** A recorded pH row and the id of the lab-run result it stands for (`SharedResult.run_id`): the arm values the row by that result, whatever id the row is filed under. */
export interface PhRow {
  row: ResultRow;
  run_id: string;
}

export interface Structure {
  dataset: RecordedDataset;
  /** The pH rows of the dataset by the physical sample they stand for. With no plant a row stands for the sample it is filed under, so this is the rows by sample id. */
  ph: Map<string, PhRow[]>;
  /** S3d: the injector's realised errors of this architecture (plain data); empty with no plant. */
  materialised: MaterialisedError[];
}

export interface Shared {
  seed: number;
  setpoint: number;
  cfg: PhLoopConfig;
  effects: readonly StabilityEffect[];
  /** A046, the hold above which a value is known to be biased. */
  hold_limit_s: number;
  /** The open-sample offset of A041, which the modelled variant subtracts. */
  open_offset: number;
  reactors: SharedReactor[];
  structure: Record<string, Structure>;
}

export interface SharedOptions {
  architectures: readonly Architecture[];
  evaluation: EvaluationSettings;
  rng: Rng;
  timing?: ReviewTiming;
  /**
   * S3d: the errors to plant, as the injector's forced mode takes them (lab_ui.md section 9). Each architecture records the stream the injector made of the lab run, so a label error
   * files a sample's rows under another id where the architecture does not prevent it. Absent or empty: the injector does not run and nothing here changes.
   */
  forced?: readonly ForcedError[];
}

export const buildShared = (run: ScenarioRun, scenario: ScenarioConfig, seed: number, o: SharedOptions): Shared => {
  const cfg = scenario.process.phLoop;
  if (!cfg) throw new Error("closed loop: the scenario has no pH feedback settings (A094, A095, A051, A108, A064)");
  const fallback = scenario.analysis.containers.ph ?? scenario.analysis.containers.default ?? "open";

  const drawn = new Map<string, { unit_id: string; t: number }>();
  const starts = new Map<string, number>();
  const results = new Map<string, SharedResult[]>();
  for (const e of run.events) {
    if (e.type === "sample_drawn") drawn.set(e.sample_id, { unit_id: e.unit_id, t: e.t });
    else if (e.type === "run_started") starts.set(`${e.request_id}/${e.attempt}/${e.visit}`, e.t);
    else if (e.type === "result_measured" && e.analyte === "ph") {
      const run_id = `${e.request_id}/${e.attempt}/${e.visit}`;
      results.set(e.request_id, [...(results.get(e.request_id) ?? []), { run_id, t: e.t, noise: e.noise, hold_s: Number.NaN }]);
    }
  }

  // a technique error (A064) leaves the pH sample in an open container: one keyed draw per sample, the key of the error opportunities (inject/opportunities.ts)
  const containers = new Map<string, "open" | "closed">();
  for (const sample_id of drawn.keys()) {
    const u = o.rng.stream([seed, sample_id, "-", 0, "error:technique_error"]).float();
    containers.set(sample_id, u < cfg.technique_p ? "open" : (fallback as "open" | "closed"));
  }

  const reactors: SharedReactor[] = run.process.reactors.map((r) => {
    const ph = run.sensors.find((s) => s.unit_id === r.unit_id && s.signal === "pH");
    if (!ph) throw new Error(`closed loop: no pH series for ${r.unit_id}`);
    const noise = Float64Array.from(ph.pv, (v, j) => v - (ph.truth[j] as number));
    const samples: SharedSample[] = [];
    for (const [sample_id, d] of drawn) {
      const res = results.get(sample_id);
      if (d.unit_id !== r.unit_id || !res) continue;
      const withHold = res.map((x) => ({ ...x, hold_s: (starts.get(x.run_id) as number) - d.t }));
      samples.push({ sample_id, drawn_s: d.t, first_t: Math.min(...withHold.map((x) => x.t)), container: containers.get(sample_id) as "open" | "closed", results: withHold });
    }
    samples.sort((a, b) => a.first_t - b.first_t || (a.sample_id < b.sample_id ? -1 : 1));
    return { unit_id: r.unit_id, t0_s: ph.t0_s, cadence_s: ph.cadence_s, noise, samples };
  });

  const events = observeEvents(run.events);
  const plan = { containers: Object.fromEntries(containers) };
  const roster = rosterOf(scenario.sampling);
  const structure: Record<string, Structure> = {};
  for (const architecture of o.architectures) {
    const planted = o.forced && o.forced.length > 0 ? plantStream(seed, architecture, events, o.forced) : undefined;
    const recorded = record({ events: planted?.events ?? events, sensors: [], plan, qualifications: qualificationsOf(run), ...(planted && { received_at: planted.received_at }) }, architecture);
    const dataset = review(validate(recorded, { hold_limit_s: o.evaluation.hold_limit_s }).dataset, { roster, timing: o.timing ?? "next_shift_start" });
    const ph = new Map<string, PhRow[]>();
    for (const row of dataset.result) {
      if (row.analyte !== "ph") continue;
      const at = planted ? planted.standsFor(row) : { sample_id: row.request_id, run_id: row.run_id };
      ph.set(at.sample_id, [...(ph.get(at.sample_id) ?? []), { row, run_id: at.run_id }]);
    }
    structure[architecture.id] = { dataset, ph, materialised: planted?.materialised ?? [] };
  }

  const open = scenario.analysis.effects.find((e) => e.analyte === "ph" && e.container === "open" && e.effect === "first_order_offset");
  return { seed, setpoint: scenario.process.ph, cfg, effects: scenario.analysis.effects, hold_limit_s: o.evaluation.hold_limit_s, open_offset: open?.offset ?? 0, reactors, structure };
};
