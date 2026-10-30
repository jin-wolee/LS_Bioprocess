import type { ExperimentReport } from "../engine/src/generated/experiment_report.schema";

// The messages between the page and the Worker (docs/design/lab_ui.md section 4). Plain data only (structuredClone-safe): no function, no class instance, no truth.
// Types only: the page imports this file for its shapes and the Worker implements it. S3b built the start-up messages and the `run` request in its Home form; S3c's Setup batch adds
// the full `ready`, the full `run` (architectures, seeds, the two profile lists, the capture path), `progress` and `cancel`. The other requests of the design (lineage, challenge_*,
// breakout) join this file when their steps land.

export type CapturePath = "manual_transcription" | "adapter_ingest";

export interface RunSpec {
  schema_version: "1";
  scenario: string;
  /** Replaces only the `value` of named scenario settings; unit and ref stay. */
  settings: Record<string, number>;
  /** One bioreactor profile id per bay, bay 1 first (spec section 4.5.2); absent: every bay takes the scenario's own. */
  bay_profiles?: string[];
  /** One analyzer profile id per analyzer, analyzer 1 first; absent: every analyzer takes the scenario's own. */
  analyzer_profiles?: string[];
  /** Overrides the capture path of every preset and turns the raw layer on. */
  capture_path?: CapturePath;
  architectures: string[];
  seeds: number[];
}

/** page -> Worker */
export type Request = { type: "run"; id: number; spec: RunSpec } | { type: "cancel"; id: number };

export type CheckState = "pending" | "identical" | "failed" | "error";

export interface CheckDetail {
  /** The five timed runs of seed 1 (lab_ui.md section 12). */
  runs_ms: number[];
  /** The strict log hash against the reference, seeds 1 to 3. */
  truth: { seed: number; equal: boolean }[];
  /** The five repeats of seed 1 agree. */
  repeats_equal: boolean;
  /** The digest of the metric cells of seed 1 under A, B and C equals the reference. */
  cells_equal: boolean;
  /** Only in the state `error`. */
  reason?: string;
}

/** A parameter as the scenario files give it (ADR-0012); `ref` is an A### or S### of the ledgers. */
export interface RefValue {
  name: string;
  value: number | string;
  unit: string;
  ref: string;
}

export interface ScenarioInfo {
  id: string;
  description: string;
  settings: RefValue[];
  profiles: Record<string, string>;
}

/** One entry of the profile catalogue (spec section 4.5.6): `bundle` is the profile file's own field (A065 to A073); its grade comes from the ledger view. */
export interface ProfileInfo {
  kind: "bioreactor" | "analyzer" | "staff";
  id: string;
  bundle: string;
  description: string;
  /** Analyzer profiles only. */
  stages?: { group: string; analytes: string[] }[];
}

/** A preset (A, B, C) or an ablation of C (C with one flag off), with its flags. */
export interface PresetInfo {
  id: string;
  role: "preset" | "ablation";
  ablated_flag: string | null;
  flags: Record<string, boolean>;
  labelling: string;
  capture_path: string | null;
}

/** The count of events by type of one run, as tests/golden/*.summary.json states it. */
export interface RunSummary {
  events: number;
  event_counts: Record<string, number>;
}

/** The median and the spread across seeds of one figure of the utilisation of an analyzer profile (spec section 4.5.6). */
export interface UtilisationRow {
  window: "staffed" | "24h";
  setup: "with" | "without";
  n_defined: number;
  median: number | null;
  lo: number | null;
  hi: number | null;
  denominator: string;
}

export interface UtilisationView {
  by_profile: { profile: string; instruments: number; rows: UtilisationRow[] }[];
}

export interface ResultFooter {
  kind: "simulation_result";
  scenario: string;
  seeds: number[];
  engine_version: string;
  architectures: string[];
  /** The inputs the result used: the inputs of the metrics, the settings the reader changed, the zone of the raw layer when a capture path is named. */
  inputs: RefValue[];
  bay_profiles?: string[];
  analyzer_profiles?: string[];
  capture_path?: CapturePath;
  /** The state of the browser check when the result was made; `pending` is re-labelled by the page when the check message arrives. */
  check: CheckState;
}

export type ErrorCode = "invalid_spec" | "engine_error" | "cancelled";

/** Worker -> page */
export type Response =
  | {
      type: "ready";
      engine_version: string;
      schema_version: "1";
      flags: string[];
      min_seeds: number;
      seed_list: number[];
      scenarios: ScenarioInfo[];
      profiles: ProfileInfo[];
      presets: PresetInfo[];
      evaluation: RefValue[];
      challenge_variants: ("sample" | "decision")[];
    }
  | { type: "check"; state: CheckState; detail: CheckDetail }
  | { type: "progress"; id: number; done: number; total: number }
  | { type: "result"; id: number; summary?: RunSummary; report?: ExperimentReport; utilisation?: UtilisationView; footer: ResultFooter }
  | { type: "error"; id: number | null; code: ErrorCode; message: string };
