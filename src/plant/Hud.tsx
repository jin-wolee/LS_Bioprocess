import { useContext, useState } from "preact/hooks";
import { text } from "../i18n/index.ts";
import type { CheckState, ScenePlan } from "../protocol.ts";
import { Label, LangContext, T } from "../ui/T.tsx";
import { ActionList } from "./ActionList.tsx";
import { HumControl } from "./HumControl.tsx";
import { TourButton } from "./Tour.tsx";
import type { Playback } from "./playback.ts";
import { lightAt } from "./scene_at.ts";
import type { PlantAsk } from "./spec.ts";
import { usePlayback } from "./usePlayback.ts";
import { clockOf, onDuty } from "./view.ts";

// The HUD of the plant (docs/design/plant_ui.md sections 2 and 9): the place card (the name of the place, the layer it shows, the scenario, the clock reading, whether the run plays and at what speed, the
// staff on duty and the floor lights at that instant, the record halls) and the reader's list of actions on the left; the browser-check chip, the sound toggle, the lens chip and the switch of the truth
// overlay on the right; the line of hints and the bottom bar are apart (PlantRoute). The cards are items of the grid of the route (plant.css), so none covers another or the bars, whatever their size.
// P8a, on a phone (under 600 px): one line (the clock and the state of the run) and a button; the rest is a sheet behind that button, with the hint that the bottom stack leaves out.
// The place card follows the clock by the minute. Every number is a label; every word is in the dictionary. P5a adds the lens chip (section 3.3): one button for each record hall, which picks the hall the
// record panel reads; the other halls are dimmed in the scene. A hall whose record has not arrived yet (the halls come after the first answer) is a disabled button that says so.

/** The switch of the truth overlay (section 3.3): pressed or not, and whether the Worker refused the overlay because a challenge is open on the run. */
export interface TruthSwitch {
  on: boolean;
  locked: boolean;
}

export interface HudProps {
  plan: ScenePlan;
  playback: Playback;
  scenario: string;
  check: CheckState;
  lens: string;
  onLens: (architecture: string) => void;
  truth: TruthSwitch;
  onTruth: (on: boolean) => void;
  /** The reader's list of actions (ActionList): the spec, whether a recompute is in flight, and how an undo is sent. */
  spec: PlantAsk;
  busy: boolean;
  onAct: (spec: PlantAsk, play: boolean) => void;
  /** The guided scene (P8b): the button that starts a tour. */
  onTour: () => void;
}

export function Hud({ plan, playback, scenario, check, lens, onLens, truth, onTruth, spec, busy, onAct, onTour }: HudProps) {
  const lang = useContext(LangContext);
  const [sheet, setSheet] = useState(false);
  const arrived = new Set(plan.records.map((r) => r.architecture));
  const minute = usePlayback(playback, (c) => Math.floor(c.t / 60));
  const playing = usePlayback(playback, (c) => c.playing);
  const speed = usePlayback(playback, (c) => c.speed);
  const t = minute * 60;
  const clock = clockOf(t);
  const reading = <T k="plant.clock.reading" parts={{ day: <Label>{clock.day}</Label>, time: <Label>{clock.time}</Label> }} />;
  const state = (
    <>
      <T k={playing ? "plant.state.playing" : "plant.state.paused"} /> <Label>×{speed}</Label>
    </>
  );
  return (
    <>
      <div class="plant-hud plant-compact" data-plant-hud="compact">
        <span data-plant-compact-clock>{reading}</span>
        <span data-plant-compact-state>{state}</span>
        <button type="button" data-sheet-toggle aria-expanded={sheet} aria-controls="plant-sheet" title={text(lang, "plant.hud.sheet.label")} onClick={() => setSheet(!sheet)}>
          <T k="plant.hud.sheet" />
        </button>
      </div>
      <div class="plant-sheet" id="plant-sheet" data-sheet={sheet ? "open" : "closed"}>
        <div class="plant-hud-left">
          <details class="plant-hud plant-hud-place" data-plant-hud="place" open>
            <T as="summary" k="plant.hud.place" class="plant-place" />
            <T as="span" k="plant.hud.layer" class="plant-layer-note" />
            <dl class="plant-facts">
              <T as="dt" k="plant.hud.scenario" />
              <dd>
                <Label>{scenario}</Label>
              </dd>
              <T as="dt" k="plant.hud.clock" />
              <dd data-plant-clock>{reading}</dd>
              <T as="dt" k="plant.hud.state" />
              <dd data-plant-state={playing ? "playing" : "paused"}>{state}</dd>
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
          <ActionList spec={spec} playback={playback} busy={busy} onAct={onAct} />
        </div>
        <div class="plant-hud-chips">
          <div class="plant-hud plant-hud-check" data-plant-hud="check">
            <span class={`chip chip-${check}`} data-check-state={check}>
              <T k="plant.hud.check" />: <T k={`check.chip.${check}`} />
            </span>
            <HumControl />
          </div>
          <TourButton onStart={onTour} />
          <div class="plant-hud plant-hud-lens" data-plant-hud="lens" role="group" aria-label={text(lang, "plant.hud.lens")} title={text(lang, "plant.hud.lens.hint")}>
            <T as="span" k="plant.hud.lens" class="plant-lens-label" />
            {plan.layout.architectures.map((a) => (
              <button
                key={a}
                type="button"
                data-lens-option={a}
                aria-pressed={a === lens}
                disabled={!arrived.has(a)}
                title={text(lang, arrived.has(a) ? "plant.lens.read" : "plant.lens.pending", { name: a })}
                aria-label={text(lang, arrived.has(a) ? "plant.lens.read" : "plant.lens.pending", { name: a })}
                onClick={() => onLens(a)}
              >
                <Label>{a}</Label>
              </button>
            ))}
          </div>
          <TruthControl truth={truth} onTruth={onTruth} />
        </div>
        <T as="p" k="plant.hud.hint" class="plant-sheet-hint" />
      </div>
    </>
  );
}

/** The switch "Show what the simulation knows", off by default; the sentence of the label is under it, and the `locked` answer is said in words beside it. */
export function TruthControl({ truth, onTruth }: { truth: TruthSwitch; onTruth: (on: boolean) => void }) {
  return (
    <div class="plant-hud plant-hud-truth" data-plant-hud="truth" data-overlay>
      <button type="button" data-truth-switch aria-pressed={truth.on} onClick={() => onTruth(!truth.on)}>
        <T k="plant.truth.switch" />
      </button>
      <T as="span" k="plant.truth.label" class="plant-overlay-label" data-note="label" />
      {truth.on && truth.locked && <T as="p" k="plant.truth.locked" class="plant-truth-locked warn" data-truth-locked />}
    </div>
  );
}

/** The one line of hints under the HUD until the first move (section 2): it sits above the bottom bar. */
export function Hint() {
  return <T as="p" k="plant.hud.hint" class="plant-hint" />;
}
