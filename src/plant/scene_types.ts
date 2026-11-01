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
}

export interface Scene {
  /** The name the graphics driver gives its renderer, for the status line. */
  renderer: string;
  /** What the scene built, by kind: the end-to-end check compares it with the objects list. */
  objects: Record<ObjectKind, number>;
  /** Brings the camera to an object named by its key (`reactor:U01`, `analyzer:AN-1`, `hall:a_manual`). */
  focus(key: string): void;
  /** Frees the GL context, the listeners and the labels. */
  dispose(): void;
}
