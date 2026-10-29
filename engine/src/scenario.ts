import { wholeSeconds } from "./clock.ts";
import type { Param } from "./generated/profile.schema";
import type { Scenario } from "./generated/scenario.schema";
import { instrumentConfig } from "./instrument.ts";
import type { InstrumentConfig } from "./instrument.ts";
import { routeConfig } from "./measure.ts";
import type { StageCfg } from "./measure.ts";
import { processConfig } from "./process.ts";
import type { CapturePath } from "./raw/types.ts";
import type { ProcessConfig } from "./process.ts";
import { checkParams, loadProfile, param, readAll } from "./profiles.ts";
import type { ProfileLookup } from "./profiles.ts";
import { samplingConfig } from "./sampling.ts";
import type { SamplingConfig } from "./sampling.ts";
import { stabilityConfig } from "./stability.ts";
import type { StabilityEffect } from "./stability.ts";

// Scenario loader (spec sections 4 and 7): a scenario picks three profiles and carries settings, every number {value, unit, ref}.
// The engine reads no file: the caller passes the parsed scenario and a lookup for the parsed profiles. Nothing here branches on an id.

export interface AnalysisConfig {
  analyzerCount: number;
  /** The visits of one sample, in order (the analyzer profile's route). */
  route: StageCfg[];
  containers: Record<string, "open" | "closed">;
  effects: StabilityEffect[];
  instrument: InstrumentConfig;
  rerunP: number;
  qcStart_s: number;
  qcLength_s: number;
  maintenance: { analyzer: string; start_s: number; end_s: number }[];
}

/** The raw device layer of the scenario (ADR-0014, spec section 2.4); present only when `raw_layer` is true. */
export interface RawSettings {
  /** The scenario's override of the capture path of every preset; absent: each preset keeps its own default. */
  capture_path?: CapturePath;
  /** When an analyzer export reaches the host (A216): the end of each staffed window (the default, spec 2.4.2) or at the instant each result is produced. */
  export_schedule: "window_end" | "per_run";
  /** The synthetic calendar date of scenario second 0, YYYY-MM-DD. */
  calendar_anchor: string;
  /** The zone the instruments are configured with, seconds ahead of UTC (A161: the device offset comes from configuration, not from the file). */
  zone_offset_s: number;
}

export interface ScenarioConfig {
  scenario_id: string;
  seed: number;
  policy: "fifo" | "edf";
  /** L5 feeds back into L1 (experiment 2). S1 builds only the open loop, so true is refused by the run. */
  feedback: boolean;
  /** Present only with `raw_layer` true; absent leaves every earlier scenario exactly as it was. */
  raw?: RawSettings;
  process: ProcessConfig;
  sampling: SamplingConfig;
  analysis: AnalysisConfig;
}

const oneOf = <T extends string>(value: T | undefined, allowed: readonly T[], fallback: T, what: string): T => {
  if (value === undefined) return fallback;
  if (!allowed.includes(value)) throw new Error(`scenario: ${what} must be one of ${allowed.join(", ")}`);
  return value;
};

/** A parameter given inline in minutes, as whole seconds. */
const minutes = (p: Param): number => wholeSeconds(param({ x: p }, "x", "min") * 60);

/** The raw-layer settings of a scenario. A setting that is read only with the layer on fails validation with the layer off, because a silent no-op would mislead. */
const rawSettings = (sc: Scenario, settings: ReturnType<typeof checkParams>): RawSettings | undefined => {
  if (sc.raw_layer !== true) {
    for (const name of ["capture_path", "calendar_anchor", "export_schedule"] as const) {
      if (sc[name] !== undefined) throw new Error(`scenario ${sc.scenario_id}: the setting ${name} is read only with raw_layer true, and raw_layer is off; remove ${name} or set raw_layer to true (spec section 5, Capture path)`);
    }
    return undefined;
  }
  if (sc.calendar_anchor === undefined) throw new Error(`scenario ${sc.scenario_id}: raw_layer needs the setting calendar_anchor (spec section 2.4.1, rule 1)`);
  if (settings.device_zone_h === undefined) throw new Error(`scenario ${sc.scenario_id}: raw_layer needs the setting device_zone_h, the zone the instruments are configured with (A161)`);
  return { ...(sc.capture_path !== undefined && { capture_path: sc.capture_path }), export_schedule: sc.export_schedule ?? "window_end", calendar_anchor: sc.calendar_anchor, zone_offset_s: wholeSeconds(param(settings, "device_zone_h", "h") * 3600) };
};

export const loadScenario = (raw: unknown, lookup: ProfileLookup): ScenarioConfig => {
  const sc = raw as Scenario | null;
  if (!sc || typeof sc !== "object" || sc.schema_version !== "1") throw new Error("scenario: schema_version 1 expected");
  if (typeof sc.scenario_id !== "string" || sc.scenario_id === "") throw new Error("scenario: scenario_id missing");
  if (!Number.isInteger(sc.seed) || sc.seed < 0) throw new Error("scenario: seed must be a non-negative integer");
  const settings = checkParams(sc.settings ?? {}, "scenario settings");
  const rawLayer = rawSettings(sc, settings);
  const bio = loadProfile(lookup("bioreactor", sc.profiles.bioreactor), "bioreactor");
  const analyzer = loadProfile(lookup("analyzer", sc.profiles.analyzer), "analyzer");
  const staff = loadProfile(lookup("staff", sc.profiles.staff), "staff");
  if (!bio.containers?.default) throw new Error(`profile ${bio.profile_id}: containers needs a default entry`);
  const scripted = (sc.scripted_events ?? []).map((e) => ({ type: e.type, unit_id: e.unit_id, at_s: minutes(e.at) }));
  const proc = processConfig(settings, bio.params, scripted);
  const lots = (sc.lot_changes ?? []).map((l) => ({ analyzer: l.analyzer, at_s: minutes(l.at) }));
  const v = readAll(settings, { analyzers: ["analyzer_count", "analyzers"], rerun: ["rerun_probability", "fraction"], qcStart: ["qc_window_start_min", "min"], qcLength: ["qc_window_length_min", "min"] });
  const plan = oneOf(sc.sampling_plan, ["burst", "staggered"], "burst", "sampling_plan");
  const label = oneOf(sc.label_method, ["handwritten", "preprinted_barcode", "issued_at_draw"], "handwritten", "label_method");
  return {
    scenario_id: sc.scenario_id,
    seed: sc.seed,
    policy: oneOf(sc.queue_policy, ["fifo", "edf"], "fifo", "queue_policy"),
    feedback: sc.feedback ?? false,
    ...(rawLayer && { raw: rawLayer }),
    process: proc,
    sampling: samplingConfig(settings, staff.params, bio.params, analyzer, plan, label),
    analysis: {
      analyzerCount: v.analyzers,
      route: routeConfig(analyzer),
      containers: bio.containers as Record<string, "open" | "closed">,
      effects: stabilityConfig(sc.stability),
      instrument: instrumentConfig(settings, proc.horizon_s, lots),
      rerunP: v.rerun,
      qcStart_s: wholeSeconds(v.qcStart * 60),
      qcLength_s: wholeSeconds(v.qcLength * 60),
      maintenance: (sc.maintenance ?? []).map((m) => {
        const start_s = minutes(m.start);
        return { analyzer: m.analyzer, start_s, end_s: start_s + wholeSeconds(param({ x: m.length }, "x", "h") * 3600) };
      }),
    },
  };
};
