import type { LeftOutWhy } from "../plant/action_list.ts";
import { ActionWords } from "../plant/ActionList.tsx";
import type { PlantAction } from "../protocol.ts";
import { T } from "./T.tsx";

// The operator actions a Setup opened from the plant carries (docs/design/lab_ui.md section 22, item 8): the plant's actions that name a unit or an analyzer, as a numbered list in words with each instant
// printed as an assumed input (the sentence of the plant's own list), applied to every seed; one control that drops them all; and, below, the plant's actions that this screen left out with the reason for each
// (a draw names the sample of one seed; a lab setting is a control of Setup's own). The numbers are the places the Worker names in a refusal. Nothing is drawn for a Setup opened without the plant.

export function SetupActions({ actions, leftOut, onDrop }: { actions: readonly PlantAction[]; leftOut: readonly { action: PlantAction; why: LeftOutWhy }[]; onDrop: () => void }) {
  if (actions.length === 0 && leftOut.length === 0) return null;
  return (
    <>
      {actions.length > 0 && (
        <section id="plant-actions" aria-labelledby="plant-actions-heading" data-setup-actions>
          <T as="h2" k="setup.actions.heading" id="plant-actions-heading" />
          <T as="p" k="setup.actions.lead" />
          <ol class="run-actions" data-run-actions>
            {actions.map((a, i) => (
              <li key={`${i}${JSON.stringify(a)}`} data-run-action={a.kind}>
                <ActionWords action={a} />
              </li>
            ))}
          </ol>
          <button type="button" id="drop-actions" data-drop-actions onClick={onDrop}>
            <T k="setup.actions.drop" />
          </button>
        </section>
      )}
      {leftOut.length > 0 && (
        <section id="plant-actions-left" aria-labelledby="plant-actions-left-heading" data-setup-left-out>
          <T as="h3" k="setup.actions.left_heading" id="plant-actions-left-heading" />
          <T as="p" k="setup.actions.left_lead" />
          <ul class="run-actions" data-left-out-list>
            {leftOut.map(({ action, why }, i) => (
              <li key={`${i}${JSON.stringify(action)}`} data-left-out={action.kind}>
                <ActionWords action={action} /> <T k={`setup.actions.why.${why}`} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
