import { loadBreakout } from "./breakout/config.ts";
import type { BreakoutConfig } from "./breakout/config.ts";
import { planBreakout } from "./breakout/plan.ts";
import { wholeSeconds } from "./clock.ts";
import type { Param } from "./generated/profile.schema";
import type { Scenario } from "./generated/scenario.schema";
import { loadBays, loadFleet } from "./fleet.ts";
import type { Instrument } from "./fleet.ts";
import { instrumentConfig } from "./instrument.ts";
import type { InstrumentConfig } from "./instrument.ts";
import { routeConfig } from "./measure.ts";
import type { StageCfg } from "./measure.ts";
import { processConfig, workingVolume } from "./process.ts";
import type { CapturePath } from "./raw/types.ts";
import type { ProcessConfig } from "./process.ts";
import { checkParams, loadProfile, param, readAll } from "./profiles.ts";
import type { ProfileLookup } from "./profiles.ts";
import { drawVolumes, samplingConfig } from "./sampling.ts";
import type { SamplingConfig } from "./sampling.ts";
import { stabilityConfig } from "./stability.ts";
import type { StabilityEffect } from "./stability.ts";

// Scenario loader (spec sections 4 and 7): a scenario picks three profiles and carries settings, every number {value, unit, ref}.
// The engine reads no file: the caller passes the parsed scenario and a lookup for the parsed profiles. Nothing here branches on an id.

export interface AnalysisConfig {
  /** The analyzer profile id of each analyzer, analyzer 1 first (spec 4.5.2). */
  analyzers: string[];
  /** The instruments in id order, each with the stage of the plan it serves and its profile. */
  instruments: Instrument[];
  /** The visits of one sample, in order: the route of the analyzer profile, or the plan of a mixed fleet (spec 4.5.4, rule B). */
  route: StageCfg[];
  containers: Record<string, "open" | "closed">;
  /** The containers of each bay when the scenario names a profile per bay (spec 4.5.2); absent: `containers` for every bay. */
  bayContainers?: Record<string, "open" | "closed">[];
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
  /** How a controller cuts its log files (A217): one file per record type per day (the default, spec 2.4.2) or each row as written. */
  controller_log_cut: "daily" | "per_row";
  /** The controller profile of each bay, bay 1 first (spec 2.4.2). Absent: no controller log is emitted. */
  bay_controllers?: string[];
  /** The scenario's set points (A198), which the controller logs as SP; the temperature shift is a process event with its own set point (A195). */
  set_points: { pH: number; DO: number; temperature: number };
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
  /** The break-out event of the scenario (spec 11.4, 11.8): present only when the scenario has a `breakout` block; absent leaves every earlier scenario exactly as it was. */
  breakout?: BreakoutConfig;
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
const rawSettings = (sc: Scenario, settings: ReturnType<typeof checkParams>, proc: Pick<ProcessConfig, "sensors" | "reactors" | "baySize">): RawSettings | undefined => {
  const sensors = proc.sensors;
  if (sc.raw_layer !== true) {
    for (const name of ["capture_path", "calendar_anchor", "export_schedule", "controller_log_cut", "bay_controllers"] as const) {
      if (sc[name] !== undefined) throw new Error(`scenario ${sc.scenario_id}: the setting ${name} is read only with raw_layer true, and raw_layer is off; remove ${name} or set raw_layer to true (spec section 5, Capture path)`);
    }
    return undefined;
  }
  if (sc.calendar_anchor === undefined) throw new Error(`scenario ${sc.scenario_id}: raw_layer needs the setting calendar_anchor (spec section 2.4.1, rule 1)`);
  if (settings.device_zone_h === undefined) throw new Error(`scenario ${sc.scenario_id}: raw_layer needs the setting device_zone_h, the zone the instruments are configured with (A161)`);
  // 2026-10-30 S2f F6: a bay uses one controller profile (spec section 2.4.2). With fewer profiles than bays the units of a later bay had no controller and lost every process value on
  // adapter_ingest, silently; with more, a profile named a bay that does not exist. The bays are the reactors in bays of bay_size, as the process lays them out (process.ts).
  const bays = Math.ceil(proc.reactors / proc.baySize);
  if (sc.bay_controllers !== undefined && sc.bay_controllers.length !== bays) {
    const n = sc.bay_controllers.length;
    throw new Error(`scenario ${sc.scenario_id}: bay_controllers names ${n} controller profile${n === 1 ? "" : "s"} but the scenario has ${bays} bay${bays === 1 ? "" : "s"} (reactor_count ${proc.reactors} in bays of ${proc.baySize}); name one controller profile per bay, bay 1 first (spec section 2.4.2)`);
  }
  return {
    ...(sc.capture_path !== undefined && { capture_path: sc.capture_path }), export_schedule: sc.export_schedule ?? "window_end", controller_log_cut: sc.controller_log_cut ?? "daily",
    ...(sc.bay_controllers !== undefined && { bay_controllers: [...sc.bay_controllers] }), set_points: { pH: sensors.phSp, DO: sensors.doSp, temperature: sensors.tempSp },
    calendar_anchor: sc.calendar_anchor, zone_offset_s: wholeSeconds(param(settings, "device_zone_h", "h") * 3600),
  };
};

export const loadScenario = (raw: unknown, lookup: ProfileLookup): ScenarioConfig => {
  const sc = raw as Scenario | null;
  if (!sc || typeof sc !== "object" || sc.schema_version !== "1") throw new Error("scenario: schema_version 1 expected");
  if (typeof sc.scenario_id !== "string" || sc.scenario_id === "") throw new Error("scenario: scenario_id missing");
  if (!Number.isInteger(sc.seed) || sc.seed < 0) throw new Error("scenario: seed must be a non-negative integer");
  const settings = checkParams(sc.settings ?? {}, "scenario settings");
  const bio = loadProfile(lookup("bioreactor", sc.profiles.bioreactor), "bioreactor");
  const analyzer = loadProfile(lookup("analyzer", sc.profiles.analyzer), "analyzer");
  const staff = loadProfile(lookup("staff", sc.profiles.staff), "staff");
  if (!bio.containers?.default) throw new Error(`profile ${bio.profile_id}: containers needs a default entry`);
  const scripted = (sc.scripted_events ?? []).map((e) => ({ type: e.type, unit_id: e.unit_id, at_s: minutes(e.at) }));
  const base = processConfig(settings, bio.params, scripted);
  const bays = sc.bay_profiles === undefined ? undefined : loadBays(sc.scenario_id, sc.bay_profiles, { reactors: base.reactors, baySize: base.baySize }, lookup);
  if (bays && base.phLoop) throw new Error(`scenario ${sc.scenario_id}: bay_profiles cannot be combined with the pH loop of experiment 2, which reads one container for every bay (spec section 4.5)`);
  const proc = bays ? { ...base, bayVolume_l: bays.map((b) => workingVolume(b.params)) } : base;
  const rawLayer = rawSettings(sc, settings, proc);
  const breakout = sc.breakout === undefined ? undefined : loadBreakout(sc.breakout, sc.scenario_id, lookup);
  if (breakout) planBreakout(breakout, sc.scenario_id, proc); // the refusals that need the units; the run plans again for the script
  const lots = (sc.lot_changes ?? []).map((l) => ({ analyzer: l.analyzer, at_s: minutes(l.at) }));
  const v = readAll(settings, { analyzers: ["analyzer_count", "analyzers"], rerun: ["rerun_probability", "fraction"], qcStart: ["qc_window_start_min", "min"], qcLength: ["qc_window_length_min", "min"] });
  const fleet = loadFleet(sc.scenario_id, sc.analyzer_profiles, analyzer, v.analyzers, lookup, routeConfig);
  const plan = oneOf(sc.sampling_plan, ["burst", "staggered"], "burst", "sampling_plan");
  const label = oneOf(sc.label_method, ["handwritten", "preprinted_barcode", "issued_at_draw"], "handwritten", "label_method");
  return {
    scenario_id: sc.scenario_id,
    seed: sc.seed,
    policy: oneOf(sc.queue_policy, ["fifo", "edf"], "fifo", "queue_policy"),
    feedback: sc.feedback ?? false,
    ...(rawLayer && { raw: rawLayer }),
    ...(breakout && { breakout }),
    process: proc,
    sampling: { ...samplingConfig(settings, staff.params, bio.params, (fleet.plan[0] as StageCfg).storage, plan, label), ...(bays && { bays: bays.map((b) => drawVolumes(settings, b.params)) }) },
    analysis: {
      analyzers: fleet.analyzers,
      instruments: fleet.instruments,
      route: fleet.plan,
      containers: bio.containers as Record<string, "open" | "closed">,
      ...(bays && { bayContainers: bays.map((b) => b.containers as Record<string, "open" | "closed">) }),
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
