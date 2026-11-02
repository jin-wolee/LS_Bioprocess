import { useEffect, useRef, useState } from "preact/hooks";
import type { RefObject } from "preact";
import { template, text } from "../i18n/index.ts";
import type { Lang } from "../i18n/index.ts";
import type { ScenePlan } from "../protocol.ts";
import type { SceneStatus } from "./Intro.tsx";
import type { Layout } from "./layout.ts";
import { loadScene } from "./loader.ts";
import type { HallsTruth } from "./plant_state.ts";
import type { Playback } from "./playback.ts";
import type { Scene, Tier } from "./scene_types.ts";
import type { Picked } from "./view.ts";

// The scene of the plant route (docs/design/plant_ui.md sections 7 and 9): the chunk that holds `three` is fetched and mounted in the host when the plan, the layout and the clock are there, and the
// things the page keeps beside it (the halls that arrive after the first answer, the lens, the picked object, the follow, the truth overlay) are given to the scene without making it again. What the
// scene says back (a pick, the end of a follow) goes to the handlers of the route.

/** The quality tier: `low` under 600 px (no shadows, a pixel ratio of one), `high` above (section 9). The offer to switch is P8. */
export const tierOf = (): Tier => (window.innerWidth < 600 ? "low" : "high");

export const reducedMotion = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** What the scene says back to the route. */
export interface SceneHandlers {
  /** A click on a card: the architecture and the index into the plan's `samples`. */
  card(architecture: string, sample: number): void;
  /** A click on a reactor, an analyzer, a member of staff or a tube. */
  object(picked: Picked): void;
  /** The camera stopped following. */
  followEnd(): void;
  /** A new scene is being made: whatever was picked or followed belongs to the old one. */
  reset(): void;
}

export interface SceneInput {
  host: RefObject<HTMLElement | null>;
  webgl: boolean;
  plan: ScenePlan | null;
  layout: Layout | null;
  playback: Playback | null;
  halls: ScenePlan["records"];
  lens: string;
  picked: Picked | null;
  following: number | null;
  /** The placeholders of the halls while the truth overlay is on and has been answered. */
  absences: HallsTruth | null | undefined;
  lang: Lang;
  handlers: SceneHandlers;
}

export function useScene({ host, webgl, plan, layout, playback, halls, lens, picked, following, absences, lang, handlers }: SceneInput): { scene: SceneStatus; renderer: string | null; mounted: RefObject<Scene | null> } {
  const mounted = useRef<Scene | null>(null);
  const [scene, setScene] = useState<SceneStatus>({ kind: webgl ? "loading" : "none" });
  const [renderer, setRenderer] = useState<string | null>(null);
  const lensRef = useRef(lens);
  lensRef.current = lens;
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const target = host.current;
    if (!webgl || !plan || !layout || !target || !playback) return;
    let live = true;
    let made: Scene | null = null;
    setScene({ kind: "loading" });
    handlersRef.current.reset();
    loadScene()
      .then(({ mountScene }) => {
        if (!live) return;
        made = mountScene({
          host: target, layout, plan, tier: tierOf(), playback, reducedMotion: reducedMotion(), lens: lensRef.current,
          // a click on a card opens its record, and the lens goes to the hall the card is in; a click on an object opens its panel
          onPick: (architecture, sample) => handlersRef.current.card(architecture, sample),
          onPickObject: (p) => handlersRef.current.object(p),
          onFollowEnd: () => handlersRef.current.followEnd(),
        });
        mounted.current = made;
        setRenderer(made.renderer);
        setScene({ kind: "ready" });
      })
      .catch((e: unknown) => {
        if (live) setScene({ kind: "failed", message: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      live = false;
      made?.dispose();
      mounted.current = null;
    };
  }, [plan, layout, webgl, playback]);

  // the renderer is kept from one scene to the next while the reader is on the plant (an action makes a new plan, and a new renderer would compile its programs again); leaving frees it and its context
  useEffect(() => {
    if (!webgl) return;
    return () => void loadScene().then((chunk) => chunk.releaseStage());
  }, [webgl]);

  // the halls that arrive after the first answer, and the lens, go to the scene without making it again
  useEffect(() => {
    if (scene.kind === "ready") mounted.current?.setHalls(halls);
  }, [halls, scene.kind]);
  useEffect(() => {
    if (scene.kind === "ready") mounted.current?.setLens(lens);
  }, [lens, scene.kind]);
  // the picked object, the follow, and the truth overlay (what the Worker answered for the halls, with the two texts every element of it carries, in the language of the page)
  useEffect(() => {
    if (scene.kind === "ready") mounted.current?.setPick(picked);
  }, [picked?.kind, picked?.index, scene.kind]);
  useEffect(() => {
    if (scene.kind === "ready") mounted.current?.setFollow(following);
  }, [following, scene.kind]);
  useEffect(() => {
    if (scene.kind !== "ready") return;
    mounted.current?.setOverlay(absences ? { halls: absences.halls, captions: { label: text(lang, "plant.truth.label"), absence: template(lang, "plant.truth.absence") } } : null);
  }, [absences, lang, scene.kind]);

  return { scene, renderer, mounted };
}
