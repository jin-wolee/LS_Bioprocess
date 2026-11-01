import type { ScenePlan } from "../protocol.ts";
import { advance, seek, startClock, toggle, withSpeed } from "./clock.ts";
import type { Clock, Speed } from "./clock.ts";
import { eventTimes, nextEvent, previousEvent } from "./events.ts";
import { startInstant } from "./view.ts";

// The clock of the page (docs/design/plant_ui.md section 4.2): the pure clock of clock.ts held in one place, so the frame loop of the scene, the controls and the HUD share it. Wall seconds reach
// it through `tick` only (called by the frame loop of the scene), and `tick` moves the clock only while it plays. Whoever subscribed is told after every change; a tick of a paused clock changes
// nothing and tells nobody.

export interface Playback {
  get(): Clock;
  /** Wall seconds since the last frame. */
  tick(wall_s: number): void;
  play(): void;
  pause(): void;
  toggle(): void;
  setSpeed(speed: Speed): void;
  seek(t: number): void;
  /** Seek by a number of simulated seconds (an hour, a day), held to the run. */
  jump(seconds: number): void;
  /** To the next (1) or the previous (-1) event of the plan; pauses. At the first or the last it stays where it is. */
  step(direction: 1 | -1): void;
  subscribe(listener: () => void): () => void;
}

export const createPlayback = (plan: ScenePlan, playing: boolean): Playback => {
  const horizon = plan.horizon_s;
  const start = startInstant(plan);
  const times = eventTimes(plan);
  let clock = startClock(start, playing);
  const listeners = new Set<() => void>();
  const set = (next: Clock): void => {
    if (next.t === clock.t && next.speed === clock.speed && next.playing === clock.playing) return;
    clock = next;
    for (const listener of [...listeners]) listener();
  };
  return {
    get: () => clock,
    tick: (wall_s) => set(advance(clock, wall_s, horizon)),
    play: () => set(clock.playing ? clock : toggle(clock, horizon, start)),
    pause: () => set({ ...clock, playing: false }),
    toggle: () => set(toggle(clock, horizon, start)),
    setSpeed: (speed) => set(withSpeed(clock, speed)),
    seek: (t) => set(seek(clock, t, horizon)),
    jump: (seconds) => set(seek(clock, clock.t + seconds, horizon)),
    step: (direction) => {
      const to = direction === 1 ? nextEvent(times, clock.t) : previousEvent(times, clock.t);
      set({ ...(to === null ? clock : seek(clock, to, horizon)), playing: false });
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};

