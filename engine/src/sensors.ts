import { wholeSeconds } from "./clock.ts";
import type { Event } from "./generated/event.schema";
import { readAll } from "./profiles.ts";
import type { Params } from "./profiles.ts";
import type { Rng } from "./rng.ts";
import { entityKey } from "./rng.ts";

// L1 online sensors (spec 2.1, A198, A199, A100). A series holds the true value and the process value (truth plus independent
// normal noise) at a fixed cadence from inoculation to harvest, in typed arrays: about 1.4 million values for the default
// scenario are kept columnar, never as event objects. sensorTickEvents expands one series on demand for export.

export type Signal = "pH" | "DO" | "temperature";

export interface SensorConfig {
  step_s: number;
  cadence_s: number;
  phSp: number;
  phSd: number;
  doSp: number;
  doSd: number;
  tempSp: number;
  tempSd: number;
  /** Temperature set point after the shift (A195). */
  tempShiftSp: number;
  /** Time constant of the temperature lag (A199), in seconds. */
  tempLag_s: number;
}

export interface SensorSeries {
  unit_id: string;
  signal: Signal;
  /** Instant of the first tick: the inoculation. */
  t0_s: number;
  cadence_s: number;
  /** Number of ticks; the arrays hold exactly n values. */
  n: number;
  pv: Float64Array;
  truth: Float64Array;
}

export interface SensorReactor {
  unit_id: string;
  inoculated_s: number;
  harvested_s: number;
  shift_s: number;
}

export const buildSensors = (c: SensorConfig, r: SensorReactor, seed: number, rng: Rng): SensorSeries[] => {
  if (c.cadence_s % c.step_s !== 0) throw new Error("sensor cadence must be a whole multiple of the integration step (A100, A200)");
  const n = Math.floor((r.harvested_s - r.inoculated_s) / c.cadence_s) + 1;
  const decay = Math.exp(-c.cadence_s / c.tempLag_s);
  const series = (signal: Signal): SensorSeries => ({ unit_id: r.unit_id, signal, t0_s: r.inoculated_s, cadence_s: c.cadence_s, n, pv: new Float64Array(n), truth: new Float64Array(n) });
  const draw = (signal: Signal) => rng.stream(entityKey(seed, r.unit_id, `sensor_${signal}`));
  const out: SensorSeries[] = [];
  for (const [signal, sp, sd] of [["pH", c.phSp, c.phSd], ["DO", c.doSp, c.doSd]] as const) {
    const s = series(signal);
    const noise = draw(signal);
    for (let j = 0; j < n; j++) {
      s.truth[j] = sp;
      s.pv[j] = sp + sd * noise.gaussian();
    }
    out.push(s);
  }
  // temperature: the true value follows the (shifted) set point with a first-order lag, exactly for a piecewise-constant set point
  const temp = series("temperature");
  const noise = draw("temperature");
  let truth = c.tempSp;
  for (let j = 0; j < n; j++) {
    const sp = r.inoculated_s + j * c.cadence_s >= r.shift_s ? c.tempShiftSp : c.tempSp;
    temp.truth[j] = truth;
    temp.pv[j] = truth + c.tempSd * noise.gaussian();
    truth = sp + (truth - sp) * decay;
  }
  out.push(temp);
  return out;
};

/** One sensor_tick event per tick (the process value is visible, the truth is hidden). Serialisation is not part of the engine run. */
export const sensorTickEvents = (s: SensorSeries): Event[] =>
  Array.from({ length: s.n }, (_, j) => ({ type: "sensor_tick", t: s.t0_s + j * s.cadence_s, unit_id: s.unit_id, signal: s.signal, value: s.pv[j] as number, true_value: s.truth[j] as number }));

// 2026-10-30 S2c3 (spec 6.2, experiment 2): the feedback path of the pH probe. Nothing above calls it: the open-loop series of buildSensors keep the true pH at
// the set point, and only the closed-loop assembly of experiment 2 runs simulatePhLoop (scenario setting feedback: true). The loop is stepped at the sensor cadence.
//   reading_j = truth_j + offset_j + noise_j                   (the probe, A199 noise)
//   truth_j+1 = truth_j + controllerStep(reading_j)            (the controller acts on the reading, A095 deadband around the set point A198)
//   offset_j+1 = offset_j + sign x drift x cadence             (A094; the sign is a draw per reactor, a simulator choice, grade A)
// A readjustment (A051, every A108) at tick j sets offset_j so that the probe reads the reference value: offset_j = reference - truth_j.

export interface PhLoopConfig {
  /** Probe drift between readjustments, pH per day (A094); the direction is a per-reactor draw. */
  drift_per_day: number;
  /** Half-width of the controller deadband around the set point (A095). */
  deadband: number;
  /** Seconds between readjustments onto an offline value (A108) when A051 is on; null when it is off. */
  readjust_every_s: number | null;
  /** Probability that a pH sample is taken or held in an open container (technique error, A064). */
  technique_p: number;
}

/** The true pH, the probe offset and the probe reading of one reactor at the sensor cadence, from inoculation to harvest. */
export interface PhSeries {
  t0_s: number;
  cadence_s: number;
  n: number;
  truth: Float64Array;
  offset: Float64Array;
  pv: Float64Array;
}

/**
 * 2026-10-30 S2c3: the settings of the pH feedback path (A094 probe drift, A095 deadband, A051 readjustment on, A108 interval, A064 technique error), read only
 * when the scenario carries them (SC8). All five are needed together; a scenario with none stays open loop. The interval must be a whole number of sensor ticks.
 */
export const phLoopConfig = (s: Params, cadence_s: number): PhLoopConfig | undefined => {
  if (!("ph_probe_drift_per_d" in s)) return undefined;
  const v = readAll(s, { drift: ["ph_probe_drift_per_d", "pH/d"], deadband: ["ph_controller_deadband", "pH"], on: ["ph_probe_readjust_on", "flag"], hours: ["ph_probe_readjust_interval_h", "h"], technique: ["technique_error_probability", "probability"] });
  if (!(v.drift >= 0)) throw new Error("the probe drift must not be negative (A094)");
  if (!(v.deadband >= 0)) throw new Error("the controller deadband must not be negative (A095)");
  if (v.on !== 0 && v.on !== 1) throw new Error("the readjustment switch must be 1 (on) or 0 (off) (A051)");
  if (!(v.technique >= 0 && v.technique <= 1)) throw new Error("the technique error probability must be between 0 and 1 (A064)");
  const every = wholeSeconds(v.hours * 3600);
  if (v.on === 1 && (every < cadence_s || every % cadence_s !== 0)) throw new Error("the readjustment interval must be a whole multiple of the sensor cadence (A108, A100)");
  return { drift_per_day: v.drift, deadband: v.deadband, readjust_every_s: v.on === 1 ? every : null, technique_p: v.technique };
};

export const probeReading = (truth: number, offset: number, noise: number): number => truth + offset + noise;

/** The change of the true pH the controller makes for a reading: nothing inside the deadband, else the move that returns the reading to the set point (S110: base or CO2 towards the target). */
export const controllerStep = (reading: number, setpoint: number, deadband: number): number => (Math.abs(reading - setpoint) > deadband ? setpoint - reading : 0);

export const probeDrift = (sign: 1 | -1, perDay: number, dt_s: number): number => sign * perDay * (dt_s / 86400);

/**
 * Called at a readjustment tick j (j > 0, at a multiple of the interval) with the series so far (truth is filled up to and including j, offset and pv up to j - 1).
 * It returns the value the probe is set to read, or null for no readjustment.
 */
export type ReadjustFn = (j: number, t_s: number, past: PhSeries) => number | null;

export const simulatePhLoop = (c: { setpoint: number; cfg: PhLoopConfig }, t0_s: number, cadence_s: number, noise: ArrayLike<number>, sign: 1 | -1, readjust: ReadjustFn): PhSeries => {
  const every = c.cfg.readjust_every_s === null ? 0 : c.cfg.readjust_every_s / cadence_s;
  if (c.cfg.readjust_every_s !== null && (!Number.isInteger(every) || every < 1)) throw new Error("the readjustment interval must be a whole multiple of the sensor cadence (A108, A100)");
  const n = noise.length;
  const out: PhSeries = { t0_s, cadence_s, n, truth: new Float64Array(n), offset: new Float64Array(n), pv: new Float64Array(n) };
  let truth = c.setpoint; // the loop starts at the set point with a probe that reads true (a simulator choice, grade A: no ledger value for the offset at inoculation)
  let offset = 0;
  for (let j = 0; j < n; j++) {
    out.truth[j] = truth;
    if (every > 0 && j > 0 && j % every === 0) {
      const onto = readjust(j, t0_s + j * cadence_s, out);
      if (onto !== null) offset = onto - truth;
    }
    const reading = probeReading(truth, offset, noise[j] as number);
    out.offset[j] = offset;
    out.pv[j] = reading;
    truth += controllerStep(reading, c.setpoint, c.cfg.deadband);
    offset += probeDrift(sign, c.cfg.drift_per_day, cadence_s);
  }
  return out;
};
