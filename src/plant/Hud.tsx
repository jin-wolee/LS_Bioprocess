import type { CheckState, ScenePlan } from "../protocol.ts";
import { Label, T } from "../ui/T.tsx";
import { clockOf, onDuty } from "./view.ts";

// The HUD shells of the plant (docs/design/plant_ui.md sections 2 and 9): the place card at the top left (the name of the place, the layer it shows, the scenario, the clock reading and the staff on
// duty at that instant, the record halls; folded under its name on a narrow viewport) and the browser-check chip of the lab at the top right, and, apart, the line of hints; the bottom bar of the operator actions is a disabled shell that
// says it comes in a later step. Every number is a label; every word is in the dictionary.

export function Hud({ plan, at, scenario, check }: { plan: ScenePlan; at: number; scenario: string; check: CheckState }) {
  const clock = clockOf(at);
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
          <T as="dt" k="plant.hud.staff" />
          <dd data-plant-staff>
            <Label>{onDuty(plan, at).length}</Label>
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
