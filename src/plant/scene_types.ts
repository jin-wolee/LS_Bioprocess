import type { Layout } from "./layout.ts";
import type { Playback } from "./playback.ts";
import type { ObjectKind } from "./view.ts";
import type { ScenePlan } from "../protocol.ts";

// What the page and the scene say to each other (docs/design/plant_ui.md sections 6 and 9). Types only, so the page can name them without importing the chunk that holds `three`.

/** `high`: soft shadows and a pixel ratio up to two. `low`: no shadows and a ratio of one; the default under 600 px (section 9). */
export type Tier = "high" | "low";

export interface SceneOptions {
  /** The element the canvas and the labels of the scene are put in; the scene sets `data-plant-calls` and `data-plant-objects` on it. */
  host: HTMLElement;
  layout: Layout;
  plan: ScenePlan;
  tier: Tier;
  /** The clock: the frame loop gives it the wall seconds of each frame and draws `sceneAt` at the instant it reads (docs/design/plant_ui.md section 4.2). */
  playback: Playback;
  /** Reduced motion: the camera cuts and the avatar steps without a glide. */
  reducedMotion: boolean;
  /** The hall the record panel reads (the lens): the other halls are dimmed. */
  lens: string;
  /** A click on a card of a hall that has been drawn: the architecture and the index into the plan's `samples`. A click that meets no card walks the avatar, as before. */
  onPick(architecture: string, sample: number): void;
}

export interface Scene {
  /** The name the graphics driver gives its renderer, for the status line. */
  renderer: string;
  /** What the scene built, by kind: the end-to-end check compares it with the objects list. */
  objects: Record<ObjectKind, number>;
  /** Brings the camera to an object named by its key (`reactor:U01`, `analyzer:AN-1`, `hall:a_manual`). */
  focus(key: string): void;
  /** The halls that have arrived (the plan on screen holds the first; the others come after it): the shelves are drawn again with them, and the camera, the clock and the walker are not touched. */
  setHalls(records: ScenePlan["records"]): void;
  /** Changes the hall the record panel reads. */
  setLens(architecture: string): void;
  /** Frees the GL context, the listeners and the labels. */
  dispose(): void;
}
