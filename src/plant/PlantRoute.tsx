import { useContext, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { text } from "../i18n/index.ts";
import type { CheckState, ScenePlan } from "../protocol.ts";
import { ErrorBlock } from "../ui/ErrorBlock.tsx";
import { LangContext, Label, T } from "../ui/T.tsx";
import { BottomBar } from "./BottomBar.tsx";
import { Hint, Hud } from "./Hud.tsx";
import { CardList } from "./CardList.tsx";
import { ObjectsList } from "./ObjectsList.tsx";
import { RecordPanel } from "./RecordPanel.tsx";
import { TextAlternative } from "./TextAlternative.tsx";
import { TimeBar } from "./TimeBar.tsx";
import { DAY, HOUR, SPEEDS } from "./clock.ts";
import { layoutOf } from "./layout.ts";
import { loadScene, webgl2 } from "./loader.ts";
import { hallsOfPlan } from "./plant_state.ts";
import type { PlantState } from "./plant_state.ts";
import { createPlayback } from "./playback.ts";
import type { Playback } from "./playback.ts";
import { DEFAULT_PLANT } from "./spec.ts";
import type { Scene, Tier } from "./scene_types.ts";
import { objectsOf } from "./view.ts";
import "./plant.css";

// The plant route (docs/design/plant_ui.md sections 7 and 9). It is part of the first load and holds no WebGL: the scene and `three` are the chunk that `loadScene` fetches, and only when
// `webgl2()` says the browser can draw it. Without WebGL the chunk is never requested and the objects list and the text alternative stand in for the scene. The page state is attributes on the plant
// host (`data-plant-*`, `data-run-hash`, `data-cells-hash`), so the end-to-end checks read the DOM and the page ships no test global. The run's clock (playback.ts) is made with the plan; the scene gives
// it the wall seconds of its frames, the controls and the keys below change it, and the host's `data-plant-t`, `-speed` and `-playing` are written from it.

type SceneState = { kind: "none" | "loading" | "ready" } | { kind: "failed"; message: string };

/** The quality tier: `low` under 600 px (no shadows, a pixel ratio of one), `high` above (section 9). The offer to switch is P8. */
const tierOf = (): Tier => (window.innerWidth < 600 ? "low" : "high");

const reducedMotion = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Whether the focus is in a control that takes typing (a text field, a select, a text area): the keys of the clock leave it alone. A range, a check box and a button do not take these keys. */
const BUTTONLIKE = ["range", "checkbox", "radio", "button"];
const takesKeys = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && (target.isContentEditable || ["SELECT", "TEXTAREA"].includes(target.tagName) || (target instanceof HTMLInputElement && !BUTTONLIKE.includes(target.type)));
/** Whether Space is the focused control's own key (it presses a button, a link, a summary, a check box). */
const pressable = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && (["BUTTON", "A", "SUMMARY"].includes(target.tagName) || (target instanceof HTMLInputElement && ["checkbox", "radio", "button"].includes(target.type)));

/** The keys of the clock (docs/design/plant_ui.md section 4.2): Space plays and pauses, 1 to 4 the speeds, comma and period the previous and next event, the brackets an hour, the braces a day. */
const clockKeys = (playback: Playback) => (e: KeyboardEvent): void => {
  if (e.ctrlKey || e.metaKey || e.altKey || takesKeys(e.target)) return;
  const speed = SPEEDS[Number(e.key) - 1];
  if (e.key === " ") {
    if (pressable(e.target)) return; // a focused button is pressed by Space
    playback.toggle();
  } else if (speed !== undefined && /^[1-9]$/.test(e.key)) playback.setSpeed(speed);
  else if (e.key === ",") playback.step(-1);
  else if (e.key === ".") playback.step(1);
  else if (e.key === "[") playback.jump(-HOUR);
  else if (e.key === "]") playback.jump(HOUR);
  else if (e.key === "{") playback.jump(-DAY);
  else if (e.key === "}") playback.jump(DAY);
  else return;
  e.preventDefault();
};

export function PlantRoute({ plant, check, onCard, onCardClose }: { plant: PlantState; check: CheckState; onCard: (architecture: string, sample_id: string) => void; onCardClose: () => void }) {
  const lang = useContext(LangContext);
  const webgl = webgl2();
  const answer = plant.ready;
  const plan = answer?.plan ?? null;
  // the plan the page reads: the first hall of the answer and the halls merged since, in the order of the layout. The scene and the clock are made from `plan`, which stays the same object when a hall arrives.
  const halls = useMemo(() => (plan ? hallsOfPlan(plan, plant.halls) : []), [plan, plant.halls]);
  const full = useMemo(() => (plan ? { ...plan, records: halls } : null), [plan, halls]);
  const [picked, setLens] = useState<string | null>(null);
  const lens = plan && picked !== null && plan.layout.architectures.includes(picked) ? picked : (plan?.layout.architectures[0] ?? "");
  const lensRef = useRef(lens);
  lensRef.current = lens;
  const cardRef = useRef(onCard);
  cardRef.current = onCard;
  const layout = useMemo(() => (plan ? layoutOf(plan.layout) : null), [plan]);
  const objects = useMemo(() => (plan ? objectsOf(plan) : []), [plan]);
  const playback = useMemo(() => (plan ? createPlayback(plan, false) : null), [plan]);
  const host = useRef<HTMLDivElement>(null);
  const mounted = useRef<Scene | null>(null);
  const [scene, setScene] = useState<SceneState>({ kind: webgl ? "loading" : "none" });
  const [renderer, setRenderer] = useState<string | null>(null);

  useEffect(() => {
    const target = host.current;
    if (!webgl || !plan || !layout || !target || !playback) return;
    let live = true;
    let made: Scene | null = null;
    setScene({ kind: "loading" });
    loadScene()
      .then(({ mountScene }) => {
        if (!live) return;
        made = mountScene({
          host: target, layout, plan, tier: tierOf(), playback, reducedMotion: reducedMotion(), lens: lensRef.current,
          // a click on a card opens its record, and the lens goes to the hall the card is in
          onPick: (architecture, sample) => {
            setLens(architecture);
            cardRef.current(architecture, (plan.samples[sample] as ScenePlan["samples"][number]).id);
          },
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

  // the halls that arrive after the first answer, and the lens, go to the scene without making it again
  useEffect(() => {
    if (scene.kind === "ready") mounted.current?.setHalls(halls);
  }, [halls, scene.kind]);
  useEffect(() => {
    if (scene.kind === "ready") mounted.current?.setLens(lens);
  }, [lens, scene.kind]);

  // the run plays once its scene is drawn, unless the reader prefers reduced motion (then it starts paused: section 9)
  useEffect(() => {
    if (scene.kind === "ready" && playback && !reducedMotion()) playback.play();
  }, [scene.kind, playback]);

  // the page state of section 10, written from the clock
  useEffect(() => {
    const target = host.current;
    if (!target || !playback) return;
    const write = (): void => {
      const c = playback.get();
      const set = (name: "plantT" | "plantSpeed" | "plantPlaying", value: string): void => {
        if (target.dataset[name] !== value) target.dataset[name] = value;
      };
      set("plantT", String(Math.floor(c.t)));
      set("plantSpeed", String(c.speed));
      set("plantPlaying", String(c.playing));
    };
    write();
    return playback.subscribe(write);
  }, [playback]);

  useEffect(() => {
    if (!webgl || !playback) return;
    const onKey = clockKeys(playback);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [webgl, playback]);

  const look = (key: string): void => {
    mounted.current?.focus(key);
    host.current?.scrollIntoView({ block: "nearest" });
  };

  // the lens picks the hall the record panel reads; a card that is open in another hall is closed (the panel never reads a hall other than the lens)
  const chooseLens = (architecture: string): void => {
    setLens(architecture);
    if (plant.record && plant.record.architecture !== architecture) onCardClose();
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
            data-plant-epoch={answer ? answer.epoch : undefined}
            data-run-hash={answer ? answer.hashes.truth : undefined}
            data-cells-hash={answer ? JSON.stringify(answer.hashes.cells) : undefined}
          />
          {(waiting || scene.kind === "loading") && (
            <p class="plant-boot" role="status">
              <T k="plant.boot" />
            </p>
          )}
          {full && playback && <Hud plan={full} playback={playback} scenario={DEFAULT_PLANT.run.scenario} check={check} lens={lens} onLens={chooseLens} />}
          {plant.record && <RecordPanel record={plant.record} onClose={onCardClose} />}
          <div class="plant-bottom">
            <Hint />
            {plan && playback && <TimeBar plan={plan} playback={playback} />}
            <BottomBar />
          </div>
        </div>
      )}

      {webgl && intro}
      {plan && full && playback && (
        <div class="plant-after">
          <ObjectsList objects={objects} onLook={scene.kind === "ready" ? look : null} />
          {webgl && <CardList plan={full} playback={playback} lens={lens} onOpen={onCard} />}
          <TextAlternative plan={full} playback={playback} />
        </div>
      )}
    </>
  );
}
