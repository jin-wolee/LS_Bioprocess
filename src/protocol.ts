// The messages between the page and the Worker (docs/design/lab_ui.md section 4). Plain data only (structuredClone-safe): no function, no class instance, no truth.
// Types only: the page imports this file for its shapes and the Worker implements it. S3b builds the start-up messages and the `run` request in its Home form; the other requests
// of the design (cancel, lineage, challenge_*, breakout) join this file when their steps land.

export interface RunSpec {
  schema_version: "1";
  scenario: string;
  /** Replaces only the `value` of named scenario settings; unit and ref stay. */
  settings: Record<string, number>;
  architectures: string[];
  seeds: number[];
}

/** page -> Worker */
export type Request = { type: "run"; id: number; spec: RunSpec };

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

/** The count of events by type of one run, as tests/golden/*.summary.json states it. */
export interface RunSummary {
  events: number;
  event_counts: Record<string, number>;
}

export interface ResultFooter {
  kind: "simulation_result";
  scenario: string;
  seeds: number[];
  engine_version: string;
  architectures: string[];
  inputs: RefValue[];
  /** The state of the browser check when the result was made; `pending` is re-labelled by the page when the check message arrives. */
  check: CheckState;
}

export type ErrorCode = "invalid_spec" | "engine_error";

/** Worker -> page */
export type Response =
  | { type: "ready"; engine_version: string; schema_version: "1"; flags: string[]; scenarios: ScenarioInfo[] }
  | { type: "check"; state: CheckState; detail: CheckDetail }
  | { type: "result"; id: number; summary?: RunSummary; footer: ResultFooter }
  | { type: "error"; id: number | null; code: ErrorCode; message: string };
