import type { Layout } from "./layout.ts";
import type { Playback } from "./playback.ts";
import type { ItemKind, ObjectKind, Picked } from "./view.ts";
import type { ScenePlan, TruthPlaceholder } from "../protocol.ts";
import type { BreakoutTruth } from "./breakout_at.ts";

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
  /** A click that reached a reactor, an analyzer, a member of staff on duty or a tube (the nearest thing along the ray), P5b. */
  onPickObject(picked: Picked): void;
  /** The flags of `ready`, the rows of the flags board (P6b). */
  flags: readonly string[];
  /** A click that reached a cell of the flags board: the index into the halls of the layout and the flag (P6b). */
  onPickCell(hall: number, flag: string): void;
  /** The camera stopped following a tube because the reader moved it, walked or picked something else. */
  onFollowEnd(): void;
}

/** What the scene needs to draw the truth overlay (section 3.3): the placeholders of the halls, and the two texts (already in the page's language) that every element of it carries. */
export interface OverlayCaptions {
  /** "Simulation's own view, not available to any record". */
  label: string;
  /** The template of the label of a rail, with {architecture} and {count}. */
  absence: string;
}
export interface OverlayData {
  halls: readonly { architecture: string; placeholders: readonly TruthPlaceholder[] }[];
  captions: OverlayCaptions;
}

/** What the scene needs to draw the break-out overlay (P7c): the answer of `{ breakout: true }` and the texts (in the page's language) every element of it carries: the label, the templates of the origin and of a unit reached, and of a clock reading. */
export interface BreakoutData {
  answer: BreakoutTruth;
  captions: { label: string; origin: string; reached: string; clock: string };
}

export interface Scene {
  /** The name the graphics driver gives its renderer, for the status line. */
  renderer: string;
  /** What the scene built, by kind: the end-to-end check compares it with the objects list. */
  objects: Record<Exclude<ObjectKind, ItemKind>, number> & Partial<Record<ItemKind, number>>;
  /** Brings the camera to an object named by its key (`reactor:U01`, `analyzer:AN-1`, `staff:OP-01`, `sample:U10-D08-1`, `hall:a_manual`, `board:B1`, `flags:board`). */
  focus(key: string): void;
  /** The object the panel shows, or none: the scene rings it, and `F` follows it when it is a sample instead of tilting the camera. */
  setPick(picked: Picked | null): void;
  /** Keeps the camera on the tube of a sample (an index into the plan's `samples`) until the reader moves it; null stops. Not while the clock plays under reduced motion: then it cuts to the tube at each step (section 9). */
  setFollow(sample: number | null): void;
  /** The truth overlay: the placeholders on the rails of the halls, or null for none (the switch is off). */
  setOverlay(data: OverlayData | null): void;
  /** The truth overlay of a break-out case (P7c): the origin and the units reached from their instants, or null for none (the switch is off, or nothing is answered). */
  setBreakout(data: BreakoutData | null): void;
  /** The words of the two outcomes of a confirming test in the page's language, for the labels of the tubes on the shelf (P7c). */
  setWords(words: { detected: string; not_detected: string }): void;
  /** The halls that have arrived (the plan on screen holds the first; the others come after it): the shelves are drawn again with them, and the camera, the clock and the walker are not touched. */
  setHalls(records: ScenePlan["records"]): void;
  /** Changes the hall the record panel reads. */
  setLens(architecture: string): void;
  /** Frees the GL context, the listeners and the labels. */
  dispose(): void;
}
