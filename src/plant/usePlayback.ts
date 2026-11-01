import { useEffect, useState } from "preact/hooks";
import type { Clock } from "./clock.ts";
import type { Playback } from "./playback.ts";

// How the page reads the clock without drawing again for every frame of it (docs/design/plant_ui.md sections 4.2 and 9). The clock changes on every frame of the scene while it plays; a component
// asks for a value derived from it and is drawn again only when that value changes.

/** A value derived from the clock (a number, a string, a boolean: it is compared with `Object.is`). */
export function usePlayback<T>(playback: Playback, select: (clock: Clock) => T): T {
  const [value, setValue] = useState<T>(() => select(playback.get()));
  useEffect(() => {
    const read = (): void => setValue(select(playback.get()));
    read();
    return playback.subscribe(read);
  }, [playback]);
  return value;
}

/**
 * The clock for the parts of the page that need not follow every frame (the tables of the text alternative, the event log). While it plays it is refreshed after `seconds` of the run's clock at the
 * current speed, that is after `seconds` of wall time at a steady speed (no timer and no wall clock is read here: the clock decides); when it is paused, sought or changed it is refreshed at once.
 */
export function useSlowClock(playback: Playback, seconds: number): Clock {
  const [shown, setShown] = useState<Clock>(() => playback.get());
  useEffect(() => {
    let last = playback.get();
    setShown(last);
    return playback.subscribe(() => {
      const now = playback.get();
      const steady = now.playing && last.playing && now.speed === last.speed && now.t >= last.t && now.t - last.t < seconds * now.speed;
      if (steady) return;
      last = now;
      setShown(now);
    });
  }, [playback, seconds]);
  return shown;
}
