import { useContext, useEffect, useRef, useState } from "preact/hooks";
import { text } from "../i18n/index.ts";
import type { Key } from "../i18n/index.ts";
import type { PlantSpec, ScenePlan } from "../protocol.ts";
import { LangContext, T } from "../ui/T.tsx";
import { ActionForm } from "./ActionForm.tsx";
import { ActionIcon } from "./ActionIcon.tsx";
import { CORE, OPTIONAL, actionOf, atOf, initialFields } from "./act_form.ts";
import type { ActionKind, Fields } from "./act_form.ts";
import { plus } from "./action_list.ts";
import type { ActRefusal } from "./plant_state.ts";
import type { Playback } from "./playback.ts";
import { usePlayback } from "./usePlayback.ts";
import type { Picked } from "./view.ts";
import "./plant_act.css";

// The bottom bar of the operator actions (docs/design/plant_ui.md sections 2 and 5, "As built in P6a"): the five core actions as buttons with an icon and a label, the three optional ones in an overflow, and
// the small form that a button opens above the bar. A form holds the clock paused while it is open, so that the instant it prints is the instant it sends, and gives it back as it was when it closes
// without sending; a sent action holds the clock at `at` until the Worker answers, and the plan that comes back resumes it (plant_state.ts). The page sends the whole list with the new action and checks
// nothing the Worker checks; a refusal comes back to the store and is shown at the form. The bar is disabled while a recompute is in flight.

export interface BarProps {
  /** The plan with the halls that have arrived. */
  plan: ScenePlan;
  playback: Playback;
  /** The spec the page asked for last: its list is the reader's list. */
  spec: PlantSpec;
  /** The flags of `ready`, for the flag form. */
  flags: readonly string[];
  picked: Picked | null;
  /** An action request is in flight. */
  busy: boolean;
  refusal: ActRefusal | null;
  /** The board the reader asked for from the objects list (the bay, and a number that changes with each ask): the move form opens on it. */
  ask: { bay: number; nonce: number } | null;
  onAct: (spec: PlantSpec, play: boolean) => void;
  onRefusalClose: () => void;
}

export function BottomBar(p: BarProps) {
  const lang = useContext(LangContext);
  const [open, setOpen] = useState<ActionKind | null>(null);
  const [more, setMore] = useState(false);
  const [fields, setFields] = useState<Fields>({});
  const [bay, setBay] = useState<number | null>(null);
  // whether the clock was playing when the first form opened (null: no form holds the clock); the element to give the focus back to
  const held = useRef<boolean | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const moreButton = useRef<HTMLButtonElement>(null);
  const sent = useRef(false);

  const choose = (kind: ActionKind, from: HTMLElement | null, force = false): void => {
    if (open === kind && !force) return close();
    if (open === null) {
      held.current = p.playback.get().playing;
      p.playback.pause();
    }
    opener.current = OPTIONAL.includes(kind) ? moreButton.current : from;
    setMore(false);
    setBay(null);
    sent.current = false;
    setFields(initialFields(kind, { plan: p.plan, flags: p.flags, picked: p.picked, at: atOf(p.playback.get().t) }));
    setOpen(kind);
  };
  const close = (): void => {
    if (held.current) p.playback.play();
    held.current = null;
    setOpen(null);
    p.onRefusalClose();
    opener.current?.focus();
  };

  // Escape closes the form, wherever the focus is (the Apply button is disabled while the Worker works, and a disabled button gives up the focus)
  const closing = useRef(close);
  closing.current = close;
  useEffect(() => {
    if (open === null) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape" && !e.defaultPrevented) closing.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open === null]);

  // the reader asked for a board from the objects list: the move form opens on that bay
  useEffect(() => {
    if (p.ask === null) return;
    choose("move_draw", null, true);
    setBay(p.ask.bay);
  }, [p.ask?.nonce]);

  // the request ended and nothing refused it: the plan that came back resumes the clock, and the form is done
  const wasBusy = useRef(false);
  useEffect(() => {
    if (wasBusy.current && !p.busy && open !== null && sent.current && p.refusal === null) {
      sent.current = false;
      held.current = null;
      setOpen(null);
      opener.current?.focus();
    }
    wasBusy.current = p.busy;
  }, [p.busy]);

  const submit = (kind: ActionKind, at: number): void => {
    const action = actionOf(kind, fields, at, p.plan);
    if (action === null) return;
    sent.current = true;
    p.playback.seek(action.at);
    p.onAct({ ...p.spec, actions: plus(p.spec.actions, action) }, held.current ?? p.playback.get().playing);
  };

  const button = (kind: ActionKind) => (
    <button key={kind} type="button" data-action={kind} aria-expanded={open === kind} aria-controls="plant-act-form" disabled={p.busy} onClick={(e) => choose(kind, e.currentTarget)}>
      <ActionIcon kind={kind} /> <T k={`plant.bar.${kind}` as Key} />
    </button>
  );

  return (
    <div class="plant-bar-wrap">
      <div class="plant-bar" role="group" aria-label={text(lang, "plant.bar.label")} data-plant-bar="actions" data-busy={p.busy}>
        <div class="plant-bar-actions">
          {CORE.map(button)}
          <button ref={moreButton} type="button" data-action="more" aria-expanded={more} aria-controls="plant-bar-more" disabled={p.busy} onClick={() => setMore(!more)}>
            <ActionIcon kind="more" /> <T k="plant.bar.more" />
          </button>
        </div>
        {more && (
          <div id="plant-bar-more" class="plant-bar-actions plant-bar-more" role="group" aria-label={text(lang, "plant.bar.more.label")}>
            {OPTIONAL.map(button)}
          </div>
        )}
        {p.busy && <T as="p" k="plant.bar.busy" class="plant-bar-note" />}
      </div>
      {open !== null && (
        <OpenForm kind={open} bar={p} fields={fields} bay={bay} set={(patch) => setFields((f) => ({ ...f, ...patch }))} onSubmit={(at) => submit(open, at)} onClose={close} />
      )}
    </div>
  );
}

/** The form that is open: it reads the clock (held, so steady) for the instant it acts at and for the boards, and takes the focus when it opens. */
function OpenForm({ kind, bar, fields, bay, set, onSubmit, onClose }: {
  kind: ActionKind;
  bar: BarProps;
  fields: Fields;
  bay: number | null;
  set: (patch: Fields) => void;
  onSubmit: (at: number) => void;
  onClose: () => void;
}) {
  const lang = useContext(LangContext);
  const now = usePlayback(bar.playback, (c) => c.t);
  const at = atOf(now);
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    host.current?.querySelector<HTMLElement>("select, input, button[data-board-row]")?.focus();
  }, [kind]);
  return (
    <div ref={host} class="plant-act">
      <ActionForm
        kind={kind} plan={bar.plan} flags={bar.flags} fields={fields} at={at} now={now} bay={bay} busy={bar.busy} refusal={bar.refusal}
        set={set} onSubmit={() => onSubmit(atOf(bar.playback.get().t))} onClose={onClose} word={(key) => text(lang, key as Key)}
      />
    </div>
  );
}
