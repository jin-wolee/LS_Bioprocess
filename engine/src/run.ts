import { runL3 } from "./analysis.ts";
import type { L3Input, L3Run, L3Window } from "./analysis.ts";
import type { Event } from "./generated/event.schema";
import { buildInstruments } from "./instrument.ts";
import type { Instruments } from "./instrument.ts";
import { makeMeasure } from "./measure.ts";
import { observe } from "./observe.ts";
import { runProcess } from "./process.ts";
import type { ProcessRun } from "./process.ts";
import { createRng } from "./rng.ts";
import type { StreamKey } from "./rng.ts";
import { runSampling } from "./sampling.ts";
import type { Operator, SampleRecord } from "./sampling.ts";
import type { ScenarioConfig } from "./scenario.ts";
import type { SensorSeries } from "./sensors.ts";
import { ENGINE_VERSION } from "./trace.ts";

// One scenario run: L1 process, L2 sampling, then the L3 queue with the instrument state, merged into one truth log.
// Layers run in this order and L1 and L2 never read L3 (no feedback), so the truth log is a function of (scenario, seed, engine version).

const DAY = 86400;

export interface RunOptions {
  /** Called for every stream key the run asks for (the collision test enumerates them). */
  onKey?: (key: StreamKey) => void;
  /** An L5 stub. Never consulted while feedback is false; accepted so a test can show that it is not. */
  l5?: unknown;
}

export interface ScenarioRun {
  /** The truth log in time order, starting with the log_header. Sensor ticks are in `sensors`, not here. */
  events: Event[];
  /** What a recorder could see: the truth log with every hidden field removed (spec section 3). */
  observable: Record<string, unknown>[];
  sensors: SensorSeries[];
  samples: SampleRecord[];
  operators: Operator[];
  process: ProcessRun;
  l3Input: L3Input;
  runs: L3Run[];
  instruments: Instruments;
}

const buildL3Input = (cfg: ScenarioConfig, samples: readonly SampleRecord[]): L3Input => {
  const a = cfg.analysis;
  const roster = cfg.sampling;
  const analyzers = a.route
    .flatMap((stage) => Array.from({ length: a.analyzerCount }, () => stage))
    .map((stage, i) => ({ id: `AN-${i + 1}`, group: stage.group, initial_method: stage.method_id ?? null }));
  const windows: L3Window[] = [];
  const days = Math.ceil(cfg.process.horizon_s / DAY);
  for (const an of analyzers) {
    for (let d = 0; d <= days; d++) {
      // daily QC (A204) and the hours outside the roster (A201): analysis happens only inside the staffed window
      const end = d % 7 >= 5 ? roster.endWeekend_s : roster.endWeekday_s;
      windows.push({ analyzer: an.id, start_s: d * DAY + a.qcStart_s, end_s: d * DAY + a.qcStart_s + a.qcLength_s, kind: "qc" });
      windows.push({ analyzer: an.id, start_s: d * DAY + end, end_s: (d + 1) * DAY + roster.start_s, kind: "closed" });
    }
  }
  for (const m of a.maintenance) windows.push({ analyzer: m.analyzer, start_s: m.start_s, end_s: m.end_s, kind: "maintenance" });
  const drawn = samples.filter((s) => s.state === "drawn").sort((x, y) => x.drawn_s - y.drawn_s || (x.sample_id < y.sample_id ? -1 : 1));
  return {
    schema_version: "1",
    engine_version: ENGINE_VERSION,
    seed: cfg.seed,
    policy: cfg.policy,
    analyzers,
    setup: [], // one method per group in every profile of S1b, so no changeover; a second method brings the table (S4, HPLC contention)
    windows,
    requests: drawn.map((s, i) => ({
      request_id: s.sample_id,
      seq: i + 1,
      arrive_s: s.arrived_s,
      sampled_s: s.drawn_s,
      deadline_s: s.deadline_s,
      visits: a.route.map((st, k) => ({
        group: st.group,
        service_s: st.service_s,
        ...(st.method_id !== undefined && { method_id: st.method_id }),
        ...(k > 0 && st.transfer_s !== undefined && { transfer_s: st.transfer_s }),
      })),
    })),
    forced_outcomes: [],
  };
};

export const runScenario = (cfg: ScenarioConfig, opts: RunOptions = {}): ScenarioRun => {
  if (cfg.feedback) throw new Error("feedback: the closed loop (experiment 2) is not built in S1b; set feedback to false");
  const rng = createRng(opts.onKey);
  const proc = runProcess(cfg.process, cfg.seed, rng);
  const sampling = runSampling(cfg.sampling, proc, cfg.seed, rng);
  const input = buildL3Input(cfg, sampling.samples);
  const instruments = buildInstruments(cfg.analysis.instrument, input.analyzers.map((x) => x.id), cfg.seed, rng);
  const measure = makeMeasure({
    seed: cfg.seed,
    rng,
    instruments,
    samples: new Map(sampling.samples.map((s) => [s.sample_id, s])),
    route: cfg.analysis.route,
    effects: cfg.analysis.effects,
    containers: cfg.analysis.containers,
    rerunP: cfg.analysis.rerunP,
  });
  const l3 = runL3(input, { measure });

  const passed = new Map<string, number>();
  for (const r of l3.runs) if (r.outcome === "qc_passed") passed.set(r.request_id, (passed.get(r.request_id) ?? 0) + 1);
  for (const s of sampling.samples) if (s.state === "drawn" && passed.get(s.sample_id) === cfg.analysis.route.length) s.state = "closed";

  // one log: the header, then L1, L2, the instrument calibrations and the L3 events in time order; at an equal instant the layers keep this order
  const [header, ...l3Events] = l3.events as [Event, ...Event[]];
  const events = [header, ...[...proc.events, ...sampling.events, ...instruments.events, ...l3Events].sort((a, b) => a.t - b.t)];
  return { events, observable: observe(events), sensors: proc.sensors, samples: sampling.samples, operators: sampling.operators, process: proc, l3Input: input, runs: l3.runs, instruments };
};
