// The clock of the plant (docs/design/plant_ui.md section 4.2): a plain state and pure functions of it. The view clock `t` is a real number of simulated seconds from the scenario start. Wall time
// moves it only while it plays, by the wall seconds times the speed; nothing else moves it, and no function here reads a clock of its own.

export const HOUR = 3600;
export const DAY = 86400;

/** Simulated seconds for each wall second (section 4.2). At the top speed one frame of 1/60 s is 60 s, well under the 600 s a transport takes at least (A018). */
export const SPEEDS = [30, 120, 600, 3600] as const;
export type Speed = (typeof SPEEDS)[number];
export const DEFAULT_SPEED: Speed = 120;

export interface Clock {
  /** Simulated seconds from the scenario start; between 0 and the horizon. */
  t: number;
  speed: Speed;
  playing: boolean;
}

export const startClock = (t: number, playing: boolean): Clock => ({ t, speed: DEFAULT_SPEED, playing });

/** The clock after `wall_s` seconds of wall time: moved while it plays, stopped at the horizon (then paused), untouched while paused. */
export const advance = (c: Clock, wall_s: number, horizon_s: number): Clock => {
  if (!c.playing) return c;
  const t = c.t + wall_s * c.speed;
  return t >= horizon_s ? { ...c, t: horizon_s, playing: false } : { ...c, t };
};

/** The clock moved to `t`, held to the run (0 s to the horizon); play and speed are kept. */
export const seek = (c: Clock, t: number, horizon_s: number): Clock => ({ ...c, t: Math.min(horizon_s, Math.max(0, t)) });

export const withSpeed = (c: Clock, speed: Speed): Clock => ({ ...c, speed });

/** Play or pause. A clock stopped at the horizon starts again from `start_s`. */
export const toggle = (c: Clock, horizon_s: number, start_s: number): Clock =>
  c.playing ? { ...c, playing: false } : { ...c, playing: true, t: c.t >= horizon_s ? start_s : c.t };
