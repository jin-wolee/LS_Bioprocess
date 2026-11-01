import { useContext, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { text } from "../i18n/index.ts";
import type { CheckState } from "../protocol.ts";
import { ErrorBlock } from "../ui/ErrorBlock.tsx";
import { LangContext, Label, T } from "../ui/T.tsx";
import { BottomBar } from "./BottomBar.tsx";
import { Hint, Hud } from "./Hud.tsx";
import { ObjectsList } from "./ObjectsList.tsx";
import { TextAlternative } from "./TextAlternative.tsx";
import { layoutOf } from "./layout.ts";
import { loadScene, webgl2 } from "./loader.ts";
import type { PlantState } from "./plant_state.ts";
import { DEFAULT_PLANT } from "./spec.ts";
import type { Scene, Tier } from "./scene_types.ts";
import { objectsOf, startInstant } from "./view.ts";
import "./plant.css";

// The plant route (docs/design/plant_ui.md sections 7 and 9). It is part of the first load and holds no WebGL: the scene and `three` are the chunk that `loadScene` fetches, and only when
// `webgl2()` says the browser can draw it. Without WebGL the chunk is never requested and the objects list and the text alternative stand in for the scene. The page state is attributes on the plant
// host (`data-plant-*`, `data-run-hash`, `data-cells-hash`), so the end-to-end checks read the DOM and the page ships no test global.

type SceneState = { kind: "none" | "loading" | "ready" } | { kind: "failed"; message: string };

/** The quality tier: `low` under 600 px (no shadows, a pixel ratio of one), `high` above (section 9). The offer to switch is P8. */
const tierOf = (): Tier => (window.innerWidth < 600 ? "low" : "high");

export function PlantRoute({ plant, check }: { plant: PlantState; check: CheckState }) {
  const lang = useContext(LangContext);
  const webgl = webgl2();
  const answer = plant.ready;
  const plan = answer?.plan ?? null;
  const layout = useMemo(() => (plan ? layoutOf(plan.layout) : null), [plan]);
  const objects = useMemo(() => (plan ? objectsOf(plan) : []), [plan]);
  const at = plan ? startInstant(plan) : 0;
  const host = useRef<HTMLDivElement>(null);
  const mounted = useRef<Scene | null>(null);
  const [scene, setScene] = useState<SceneState>({ kind: webgl ? "loading" : "none" });
  const [renderer, setRenderer] = useState<string | null>(null);

  useEffect(() => {
    const target = host.current;
    if (!webgl || !plan || !layout || !target) return;
    let live = true;
    let made: Scene | null = null;
    setScene({ kind: "loading" });
    loadScene()
      .then(({ mountScene }) => {
        if (!live) return;
        made = mountScene({ host: target, layout, plan, tier: tierOf(), at, reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches });
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
  }, [plan, layout, webgl]);

  const look = (key: string): void => {
    mounted.current?.focus(key);
    host.current?.scrollIntoView({ block: "nearest" });
  };

  const waiting = plan === null && plant.problem === null;
  const state = !webgl ? "text" : scene.kind;
  const intro = (
      <section class="plant-intro" aria-labelledby="plant-heading">
        <T as="h1" k="plant.heading" id="plant-heading" />
        <T as="p" k="plant.lead" />
        {plant.problem && <ErrorBlock problem={{ id: null, code: plant.problem.code, message: plant.problem.message }} />}
        <p id="plant-status" role="status" data-plant-status={state} class="plant-status">
          <T k={plan ? "plant.status.plan.ready" : "plant.status.plan.waiting"} />{" "}
          {webgl && scene.kind === "loading" && plan && <T k="plant.status.scene.loading" />}
          {webgl && scene.kind === "ready" && <T k="plant.status.scene.ready" />}
          {scene.kind === "failed" && (
            <>
              <T k="plant.status.scene.failed" />{" "}
              <code>
                <Label engine>{scene.message}</Label>
              </code>
            </>
          )}{" "}
          {renderer && <T k="plant.status.renderer" parts={{ renderer: <Label engine>{renderer}</Label> }} />}
        </p>
        {!webgl && (
          <div class="notice" role="note" data-plant-fallback>
            <T as="h2" k="plant.nowebgl.heading" />
            <T as="p" k="plant.nowebgl.notice" />
          </div>
        )}
      </section>
  );

  // the order of the page is the top bar, the scene, then the text about it and the objects list (section 9); without a scene the text comes first
  return (
    <>
      {!webgl && intro}
      {webgl && (
        <div class="plant-wrap">
          <div
            id="plant"
            ref={host}
            class="plant-gl"
            role="img"
            aria-label={text(lang, "plant.canvas.label")}
            aria-describedby="plant-text"
            data-plant
            data-plant-scene={scene.kind}
            data-plant-tier={tierOf()}
            data-plant-t={plan ? at : undefined}
            data-plant-epoch={answer ? answer.epoch : undefined}
            data-run-hash={answer ? answer.hashes.truth : undefined}
            data-cells-hash={answer ? JSON.stringify(answer.hashes.cells) : undefined}
          />
          {(waiting || scene.kind === "loading") && (
            <p class="plant-boot" role="status">
              <T k="plant.boot" />
            </p>
          )}
          {plan && <Hud plan={plan} at={at} scenario={DEFAULT_PLANT.run.scenario} check={check} />}
          <div class="plant-bottom">
            <Hint />
            <BottomBar />
          </div>
        </div>
      )}

      {webgl && intro}
      {plan && (
        <div class="plant-after">
          <ObjectsList objects={objects} onLook={scene.kind === "ready" ? look : null} />
          <TextAlternative plan={plan} at={at} />
        </div>
      )}
    </>
  );
}
