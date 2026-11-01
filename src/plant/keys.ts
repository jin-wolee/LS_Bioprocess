import { DAY, HOUR, SPEEDS } from "./clock.ts";
import type { Playback } from "./playback.ts";

// The keys of the plant's clock (docs/design/plant_ui.md section 4.2), as a handler the route puts on the window. The keys that walk and look are the scene's own (gl/input.ts).

/** Whether the focus is in a control that takes typing (a text field, a select, a text area): the keys of the clock leave it alone. A range, a check box and a button do not take these keys. */
const BUTTONLIKE = ["range", "checkbox", "radio", "button"];
const takesKeys = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && (target.isContentEditable || ["SELECT", "TEXTAREA"].includes(target.tagName) || (target instanceof HTMLInputElement && !BUTTONLIKE.includes(target.type)));
/** Whether Space is the focused control's own key (it presses a button, a link, a summary, a check box). */
const pressable = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && (["BUTTON", "A", "SUMMARY"].includes(target.tagName) || (target instanceof HTMLInputElement && ["checkbox", "radio", "button"].includes(target.type)));

/** What the keys of the route reach: the clock, the instants of the picked object (for the step) and the follow of a picked sample. */
export interface KeyTargets {
  playback: Playback;
  times: () => readonly number[] | undefined;
  follow: () => boolean;
  toggleFollow: () => void;
}

/** The keys of the clock: Space plays and pauses, 1 to 4 the speeds, comma and period the previous and next event (of the picked object, when there is one), the brackets an hour, the braces a day; `F` follows a picked sample. */
export const clockKeys = ({ playback, times, follow, toggleFollow }: KeyTargets) => (e: KeyboardEvent): void => {
  if (e.ctrlKey || e.metaKey || e.altKey || takesKeys(e.target)) return;
  const speed = SPEEDS[Number(e.key) - 1];
  if (e.key === " ") {
    if (pressable(e.target)) return; // a focused button is pressed by Space
    playback.toggle();
  } else if (speed !== undefined && /^[1-9]$/.test(e.key)) playback.setSpeed(speed);
  else if (e.key === ",") playback.step(-1, times());
  else if (e.key === ".") playback.step(1, times());
  else if (e.key === "[") playback.jump(-HOUR);
  else if (e.key === "]") playback.jump(HOUR);
  else if (e.key === "{") playback.jump(-DAY);
  else if (e.key === "}") playback.jump(DAY);
  else if (e.key.toLowerCase() === "f" && follow()) toggleFollow();
  else return;
  e.preventDefault();
};
