import type { ComponentChildren } from "preact";
import { useContext } from "preact/hooks";
import { text } from "../i18n/index.ts";
import { Label, LangContext, T } from "../ui/T.tsx";
import type { PlantAction } from "../protocol.ts";
import { Instant } from "./ActionRefs.tsx";
import { canonicalOrder, isLabSetting, wordsOf, without } from "./action_list.ts";
import type { Slot } from "./action_list.ts";
import type { Playback } from "./playback.ts";
import type { PlantAsk } from "./spec.ts";

// The reader's list of actions, in the HUD (docs/design/plant_ui.md section 5.5, "As built in P6a"): each action in words with its instant, in the canonical order of the Worker, a mark on a lab setting
// (it applies to the whole run), and an undo for each, which removes that action and sends the rest the same way. Above it the line that says the run is recomputing: a live region, announced when it
// fills, with a turning ring that the style sheet draws only when the reader has not asked for reduced motion.

const slotOf = (s: Slot): ComponentChildren => ("instant" in s ? <Instant t={s.instant} /> : "label" in s ? <Label>{s.label}</Label> : <T k={s.word} />);

/** One action as a sentence of the dictionary. */
export function ActionWords({ action }: { action: PlantAction }) {
  const w = wordsOf(action);
  return <T k={w.key} parts={Object.fromEntries(Object.entries(w.slots).map(([name, slot]) => [name, slotOf(slot)]))} />;
}

export function ActionList({ spec, playback, busy, onAct }: { spec: PlantAsk; playback: Playback; busy: boolean; onAct: (spec: PlantAsk, play: boolean) => void }) {
  const lang = useContext(LangContext);
  const list = canonicalOrder(spec.actions);
  // the undo holds the clock where it is, and the plan that comes back resumes it at the undone action's instant
  const undo = (action: PlantAction): void => {
    const play = playback.get().playing;
    playback.pause();
    onAct({ ...spec, actions: without(spec.actions, action) }, play);
  };
  return (
    <section class="plant-hud plant-hud-actions" data-plant-hud="actions" aria-labelledby="plant-actions-heading">
      <T as="h2" k="plant.act.list.heading" id="plant-actions-heading" />
      <p class="plant-recomputing" role="status" data-plant-recomputing-line>
        {busy && (
          <>
            <span class="plant-ring" aria-hidden="true" /> <T k="plant.act.recomputing" />
          </>
        )}
      </p>
      {list.length === 0 ? (
        <T as="p" k="plant.act.list.empty" class="plant-act-empty" />
      ) : (
        <ol class="plant-act-list" data-act-list>
          {list.map((a, i) => (
            <li key={JSON.stringify(a)} data-action-item={a.kind}>
              <ActionWords action={a} />
              {isLabSetting(a) && <T k="plant.act.list.whole_run" class="chip" />}{" "}
              <button type="button" data-undo disabled={busy} aria-label={text(lang, "plant.act.undo.of", { number: String(i + 1) })} onClick={() => undo(a)}>
                <T k="plant.act.undo" />
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
