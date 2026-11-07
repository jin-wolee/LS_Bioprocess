import { useEffect, useRef, useState } from "preact/hooks";
import type { RefObject } from "preact";
import { template, text } from "../i18n/index.ts";
import type { Lang } from "../i18n/index.ts";
import type { ScenePlan } from "../protocol.ts";
import type { BreakoutTruth } from "./breakout_at.ts";
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
  /** A click on a cell of the flags board: the index into the halls of the layout and the flag (P6b). */
  cell(hall: number, flag: string): void;
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
  /** The flags of `ready`: the rows of the flags board (P6b). */
  flags: readonly string[];
  /** The placeholders of the halls while the truth overlay is on and has been answered. */
  absences: HallsTruth | null | undefined;
  /** The answer of `{ breakout: true }` while the overlay is on (P7c, a case only). */
  breakout: BreakoutTruth | null | undefined;
  lang: Lang;
  handlers: SceneHandlers;
}

export function useScene({ host, webgl, plan, layout, playback, halls, lens, picked, following, flags, absences, breakout, lang, handlers }: SceneInput): { scene: SceneStatus; renderer: string | null; mounted: RefObject<Scene | null> } {
  const mounted = useRef<Scene | null>(null);
  const [scene, setScene] = useState<SceneStatus>({ kind: webgl ? "loading" : "none" });
  const [renderer, setRenderer] = useState<string | null>(null);
  const lensRef = useRef(lens);
  lensRef.current = lens;
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const flagsRef = useRef(flags);
  flagsRef.current = flags;
  const langRef = useRef(lang);
  langRef.current = lang;

  // Measure the space above the plant, including wrapped navigation and other header content.
  useEffect(() => {
    const wrap = host.current?.parentElement;
    const header = document.querySelector(".top");
    if (!webgl || !wrap || !header) return;
    const measure = (): void => wrap.style.setProperty("--plant-top-space", `${Math.max(0, wrap.getBoundingClientRect().top + window.scrollY)}px`);
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    window.addEventListener("resize", measure);
    measure();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      wrap.style.removeProperty("--plant-top-space");
    };
  }, [webgl, host]);

  useEffect(() => {
    const target = host.current;
    if (!webgl || !plan || !layout || !target || !playback) return;
    let live = true;
    let made: Scene | null = null;
    let stopContext = (): void => {};
    setScene({ kind: "loading" });
    handlersRef.current.reset();
    loadScene()
      .then(({ mountScene }) => {
        if (!live) return;
        made = mountScene({
          host: target, layout, plan, tier: tierOf(), playback, reducedMotion: reducedMotion(), lens: lensRef.current, flags: flagsRef.current,
          // a click on a card opens its record, and the lens goes to the hall the card is in; a click on an object opens its panel
          onPick: (architecture, sample) => handlersRef.current.card(architecture, sample),
          onPickObject: (p) => handlersRef.current.object(p),
          onPickCell: (hall, flag) => handlersRef.current.cell(hall, flag),
          onFollowEnd: () => handlersRef.current.followEnd(),
        });
        const canvas = target.querySelector("canvas.plant-canvas");
        if (canvas) {
          const lost = (event: Event): void => {
            event.preventDefault();
            playback.pause();
            setScene({ kind: "failed", message: text(langRef.current, "plant.status.scene.lost"), messageKey: "plant.status.scene.lost" });
          };
          const restored = (): void => setScene({ kind: "ready" });
          canvas.addEventListener("webglcontextlost", lost);
          canvas.addEventListener("webglcontextrestored", restored);
          stopContext = () => {
            canvas.removeEventListener("webglcontextlost", lost);
            canvas.removeEventListener("webglcontextrestored", restored);
          };
        }
        mounted.current = made;
        setRenderer(made.renderer);
        setScene({ kind: "ready" });
      })
      .catch((e: unknown) => {
        if (live) setScene({ kind: "failed", message: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      live = false;
      stopContext();
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
    mounted.current?.setOverlay(absences ? { halls: absences.halls, captions: { label: text(lang, "plant.truth.label.short"), absence: template(lang, "plant.truth.absence") } } : null);
  }, [absences, lang, scene.kind]);
  // a break-out case (P7c): what the simulation knows of the event, and the words the stamps on the shelf are read in
  useEffect(() => {
    if (scene.kind !== "ready") return;
    const captions = { label: text(lang, "plant.truth.label.short"), origin: template(lang, "plant.truth.origin"), reached: template(lang, "plant.truth.reached"), clock: template(lang, "plant.clock.reading") };
    mounted.current?.setBreakout(breakout ? { answer: breakout, captions } : null);
  }, [breakout, lang, scene.kind]);
  useEffect(() => {
    if (scene.kind === "ready") mounted.current?.setWords({ detected: text(lang, "plant.confirm.detected"), not_detected: text(lang, "plant.confirm.not_detected") });
  }, [lang, scene.kind]);

  return { scene, renderer, mounted };
}
