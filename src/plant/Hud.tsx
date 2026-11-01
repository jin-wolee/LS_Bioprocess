import type { CheckState, ScenePlan } from "../protocol.ts";
import { Label, T } from "../ui/T.tsx";
import type { Playback } from "./playback.ts";
import { lightAt } from "./scene_at.ts";
import { usePlayback } from "./usePlayback.ts";
import { clockOf, onDuty } from "./view.ts";

// The HUD of the plant (docs/design/plant_ui.md sections 2 and 9): the place card at the top left (the name of the place, the layer it shows, the scenario, the clock reading, whether the run plays and
// at what speed, the staff on duty and the floor lights at that instant, the record halls; folded under its name on a narrow viewport) and the browser-check chip of the lab at the top right, and,
// apart, the line of hints; the bottom bar of the operator actions is a disabled shell that says it comes in a later step. The place card follows the clock by the minute. Every number is a label;
// every word is in the dictionary.

export function Hud({ plan, playback, scenario, check }: { plan: ScenePlan; playback: Playback; scenario: string; check: CheckState }) {
  const minute = usePlayback(playback, (c) => Math.floor(c.t / 60));
  const playing = usePlayback(playback, (c) => c.playing);
  const speed = usePlayback(playback, (c) => c.speed);
  const t = minute * 60;
  const clock = clockOf(t);
  return (
    <>
      <details class="plant-hud plant-hud-place" data-plant-hud="place" open={window.innerWidth >= 600}>
        <T as="summary" k="plant.hud.place" class="plant-place" />
        <T as="span" k="plant.hud.layer" class="plant-layer" />
        <dl class="plant-facts">
          <T as="dt" k="plant.hud.scenario" />
          <dd>
            <Label>{scenario}</Label>
          </dd>
          <T as="dt" k="plant.hud.clock" />
          <dd data-plant-clock>
            <T k="plant.clock.reading" parts={{ day: <Label>{clock.day}</Label>, time: <Label>{clock.time}</Label> }} />
          </dd>
          <T as="dt" k="plant.hud.state" />
          <dd data-plant-state={playing ? "playing" : "paused"}>
            <T k={playing ? "plant.state.playing" : "plant.state.paused"} /> <Label>×{speed}</Label>
          </dd>
          <T as="dt" k="plant.hud.staff" />
          <dd data-plant-staff>
            <Label>{onDuty(plan, t).length}</Label>
          </dd>
          <T as="dt" k="plant.hud.light" />
          <dd data-plant-light={lightAt(plan, t).lit ? "lit" : "dim"}>
            <T k={lightAt(plan, t).lit ? "plant.light.lit" : "plant.light.dim"} />
          </dd>
          <T as="dt" k="plant.hud.halls" />
          <dd data-plant-halls>
            <Label>{plan.records.map((r) => r.architecture).join(", ")}</Label>
          </dd>
        </dl>
      </details>
      <div class="plant-hud plant-hud-check" data-plant-hud="check">
        <span class={`chip chip-${check}`} data-check-state={check}>
          <T k="plant.hud.check" />: <T k={`check.chip.${check}`} />
        </span>
      </div>
    </>
  );
}

/** The one line of hints under the HUD until the first move (section 2): it sits above the bottom bar. */
export function Hint() {
  return <T as="p" k="plant.hud.hint" class="plant-hint" />;
}
