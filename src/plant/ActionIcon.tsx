import type { ActionKind } from "./act_form.ts";

// The icon of each action of the bar (docs/design/plant_ui.md section 2): a small outline drawn in code, a shape that repeats the label and carries nothing alone (no asset file ships). Stroke only, in the
// colour of the text, so it reads in both themes.

const PATHS: Record<ActionKind | "more", string> = {
  add_feed: "M8 2.2C8 2.2 3.6 7 3.6 10.2a4.4 4.4 0 0 0 8.8 0C12.4 7 8 2.2 8 2.2Z",
  raise_alarm: "M8 2.2 14.4 13.4H1.6ZM8 6.6V9.8M8 11.6V11.7",
  move_draw: "M2 8H14M10 4.2 14 8 10 11.8",
  analyzer_down: "M5.2 3V13M10.8 3V13",
  change_lot: "M2 4H10L14 8 10 12H2Z",
  set_flag: "M4 2V14M4 3H12.2L10 6 12.2 9H4",
  set_capture_path: "M8 2V9.2M5 6.4 8 9.4 11 6.4M2.6 13H13.4",
  set_labelling: "M2 3.2H14V12.8H2ZM5 6.4H11M5 9.6H9",
  more: "M3 8V8.1M8 8V8.1M13 8V8.1",
};

export function ActionIcon({ kind }: { kind: ActionKind | "more" }) {
  return (
    <svg class="plant-act-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <path d={PATHS[kind]} fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
}
