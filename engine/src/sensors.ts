import type { Event } from "./generated/event.schema";
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
