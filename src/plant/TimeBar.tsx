import { useContext } from "preact/hooks";
import { text } from "../i18n/index.ts";
import type { ScenePlan } from "../protocol.ts";
import { Label, LangContext, T } from "../ui/T.tsx";
import { DAY, SPEEDS } from "./clock.ts";
import type { Playback } from "./playback.ts";
import { usePlayback } from "./usePlayback.ts";
import { clockOf } from "./view.ts";

// The controls of the clock (docs/design/plant_ui.md section 4.2): play and pause, the step to the previous and the next event, the four speed presets and the scrubber over the run with a tick at
// every day boundary. DOM controls, all reachable by the keyboard; the speed and the clock reading are labels. The keys that do the same (Space, the number keys, the comma and the period, the
// brackets) are the route's.

export function TimeBar({ plan, playback }: { plan: ScenePlan; playback: Playback }) {
  const lang = useContext(LangContext);
  const playing = usePlayback(playback, (c) => c.playing);
  const speed = usePlayback(playback, (c) => c.speed);
  const minute = usePlayback(playback, (c) => Math.floor(c.t / 60));
  const t = minute * 60;
  const clock = clockOf(t);
  const boundaries = Math.max(0, Math.ceil(plan.horizon_s / DAY) - 1); // the day boundaries inside the run
  const reading = text(lang, "plant.clock.reading", { day: String(clock.day), time: clock.time });
  return (
    <div class="plant-time" role="group" aria-label={text(lang, "plant.time.label")} data-plant-time>
      <div class="plant-time-buttons">
        <button type="button" class="plant-step" data-time="prev" title={text(lang, "plant.time.prev")} aria-label={text(lang, "plant.time.prev")} onClick={() => playback.step(-1)}>
          «
        </button>
        <button type="button" class="plant-play" data-time="play" aria-pressed={playing} onClick={() => playback.toggle()}>
          <T k={playing ? "plant.time.pause" : "plant.time.play"} />
        </button>
        <button type="button" class="plant-step" data-time="next" title={text(lang, "plant.time.next")} aria-label={text(lang, "plant.time.next")} onClick={() => playback.step(1)}>
          »
        </button>
      </div>
      <div class="plant-speeds" role="group" aria-label={text(lang, "plant.time.speed")}>
        {SPEEDS.map((s) => (
          <button key={s} type="button" data-speed={s} aria-pressed={s === speed} aria-label={text(lang, "plant.time.speed.set", { speed: String(s) })} onClick={() => playback.setSpeed(s)}>
            <Label>×{s}</Label>
          </button>
        ))}
      </div>
      <div class="plant-scrub">
        <div class="plant-ticks" aria-hidden="true">
          {Array.from({ length: boundaries }, (_, k) => (
            <span key={k} class="plant-tick" style={{ left: `${((k + 1) * DAY * 100) / plan.horizon_s}%` }} />
          ))}
        </div>
        <input
          type="range"
          min={0}
          max={plan.horizon_s}
          step={60}
          value={t}
          aria-label={text(lang, "plant.time.scrub")}
          aria-valuetext={reading}
          data-time="scrub"
          onInput={(e) => playback.seek(Number((e.currentTarget as HTMLInputElement).value))}
        />
      </div>
      <T as="p" k="plant.time.keys" class="plant-time-keys" />
    </div>
  );
}
