import { useEffect, useRef } from "preact/hooks";
import type { Playback } from "./playback.ts";

// How the plant opens and closes (docs/design/plant_ui.md section 7, "As built in P5c"): the clock opens at the instant of the link or of the reader's leaving, paused; otherwise the run plays once its
// scene is drawn, unless the reader prefers reduced motion (then it starts paused: section 9); and leaving the plant saves the instant and the lens in the page store.

/**
 * `start` is the instant the clock opens at, or null for the opening of the first shift; `drawn` is whether the scene has been drawn; `reduced` whether the reader prefers reduced motion. `onLeave`
 * is told the whole second of the clock and the lens when the route unmounts.
 */
export function useOpening(playback: Playback | null, start: number | null, drawn: boolean, reduced: boolean, lens: string, onLeave: (t: number, lens: string) => void): void {
  const held = useRef(false);
  const latest = useRef({ playback, lens, onLeave });
  latest.current = { playback, lens, onLeave };

  useEffect(() => {
    held.current = false;
    if (playback && start !== null) {
      playback.seek(start);
      held.current = true;
    }
  }, [playback]);

  useEffect(() => {
    if (drawn && playback && !reduced && !held.current) playback.play();
  }, [drawn, playback]);

  useEffect(() => () => {
    const { playback: clock, lens: hall, onLeave: leave } = latest.current;
    if (clock) leave(Math.floor(clock.get().t), hall);
  }, []);
}
