import { useContext } from "preact/hooks";
import { text } from "../i18n/index.ts";
import type { Key } from "../i18n/index.ts";
import { LangContext, T } from "../ui/T.tsx";

// The bottom bar of the operator actions (docs/design/plant_ui.md sections 2 and 5): in P3 a disabled shell of the five core actions that says it comes in a later step. Disabled controls are not
// reachable by the keyboard and take no click; the sentence under them is what a reader who meets the bar is told (P6 builds the actions and their refusals).

const CORE = ["add_feed", "move_draw", "analyzer_down", "set_flag", "set_capture_path"] as const;

export function BottomBar() {
  const lang = useContext(LangContext);
  const soon = text(lang, "plant.bar.soon");
  return (
    <div class="plant-bar" role="group" aria-label={text(lang, "plant.bar.label")} data-plant-bar="shell">
      <div class="plant-bar-actions">
        {CORE.map((kind) => (
          <button key={kind} type="button" disabled title={soon} data-action={kind}>
            <T k={`plant.bar.${kind}` as Key} />
          </button>
        ))}
      </div>
      <T as="p" k="plant.bar.soon" class="plant-bar-note" />
    </div>
  );
}
