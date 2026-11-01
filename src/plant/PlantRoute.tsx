import { useContext, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { template, text } from "../i18n/index.ts";
import type { CheckState, ScenePlan } from "../protocol.ts";
import { LangContext, T } from "../ui/T.tsx";
import { BottomBar } from "./BottomBar.tsx";
import { Hint, Hud, TruthControl } from "./Hud.tsx";
import { CardList } from "./CardList.tsx";
import { ObjectsList } from "./ObjectsList.tsx";
import { Panels } from "./Panels.tsx";
import { RecordPanel } from "./RecordPanel.tsx";
import { Intro } from "./Intro.tsx";
import type { SceneStatus } from "./Intro.tsx";
import { LinkNotes } from "./LinkNotes.tsx";
import { TextAlternative } from "./TextAlternative.tsx";
import { TimeBar } from "./TimeBar.tsx";
import { TubeList } from "./TubeList.tsx";
import { drillOf } from "./drill.ts";
import { objectTimes } from "./events.ts";
import { clockKeys } from "./keys.ts";
import { instantIn } from "./link.ts";
import type { PlantLink } from "./link.ts";
import { layoutOf } from "./layout.ts";
import { loadScene, webgl2 } from "./loader.ts";
import { hallsOfPlan } from "./plant_state.ts";
import type { PlantState } from "./plant_state.ts";
import { createPlayback } from "./playback.ts";
import { useOpening } from "./useOpening.ts";
import { DEFAULT_PLANT } from "./spec.ts";
import type { Scene, Tier } from "./scene_types.ts";
import { keyOf, objectsOf, pickedOfKey } from "./view.ts";
import type { Picked } from "./view.ts";
import "./plant.css";

// The plant route (docs/design/plant_ui.md sections 7 and 9). It is part of the first load and holds no WebGL: the scene and `three` are the chunk that `loadScene` fetches, and only when
// `webgl2()` says the browser can draw it. Without WebGL the chunk is never requested and the objects list and the text alternative stand in for the scene. The page state is attributes on the plant
// host (`data-plant-*`, `data-run-hash`, `data-cells-hash`), so the end-to-end checks read the DOM and the page ships no test global. The run's clock (playback.ts) is made with the plan; the scene gives
// it the wall seconds of its frames, the controls and the keys below change it, and the host's `data-plant-t`, `-speed` and `-playing` are written from it.
//
// P5c: the plant is the page store's. The route opens on the instant of the link (`t`, which wins) or the one the reader left at (`plant.view`), paused, with the lens they left on, and saves both when it
// unmounts; the panels carry the links to the other screens (section 7).
//
// P5b: the object the reader picked (a click in the scene, a button of a list) opens its panel and is what `,` and `.` step between the events of; `F` follows a picked sample; the switch of the truth
// overlay is the HUD's, and what the Worker answers is drawn by the scene (the placeholders) and by the record panel (the truth column and the verdicts).

/** The quality tier: `low` under 600 px (no shadows, a pixel ratio of one), `high` above (section 9). The offer to switch is P8. */
const tierOf = (): Tier => (window.innerWidth < 600 ? "low" : "high");

const reducedMotion = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function PlantRoute({ plant, check, link, engine, architectures, onCard, onCardClose, onFields, onFieldsClose, onTruth, onLeave }: {
  plant: PlantState;
  check: CheckState;
  /** The link the route was opened with: its notes, its instant and the engine version it was made with; null when the address has no query. */
  link: PlantLink | null;
  /** The engine version of the build and the record architectures the Setup screen offers (for the links to other screens). */
  engine: string;
  architectures: readonly string[];
  /** The reader leaves the plant: the clock instant and the lens are the store's to keep. */
  onLeave: (t: number, lens: string) => void;
  onCard: (architecture: string, sample_id: string) => void;
  onCardClose: () => void;
  onFields: (architecture: string, sample_id: string) => void;
  onFieldsClose: () => void;
  onTruth: (on: boolean) => void;
}) {
  const lang = useContext(LangContext);
  const webgl = webgl2();
  const answer = plant.ready;
  const plan = answer?.plan ?? null;
  // the plan the page reads: the first hall of the answer and the halls merged since, in the order of the layout. The scene and the clock are made from `plan`, which stays the same object when a hall arrives.
  const halls = useMemo(() => (plan ? hallsOfPlan(plan, plant.halls) : []), [plan, plant.halls]);
  const full = useMemo(() => (plan ? { ...plan, records: halls } : null), [plan, halls]);
  const spec = plant.spec ?? DEFAULT_PLANT;
  const [chosen, setLens] = useState<string | null>(plant.view?.lens ?? null);
  const lens = plan && chosen !== null && plan.layout.architectures.includes(chosen) ? chosen : (plan?.layout.architectures[0] ?? "");
  const lensRef = useRef(lens);
  lensRef.current = lens;
  const cardRef = useRef(onCard);
  cardRef.current = onCard;
  // the picked object and the sample the camera follows; a new plan has none
  const [picked, setPicked] = useState<Picked | null>(null);
  const [following, setFollowing] = useState<number | null>(null);
  const layout = useMemo(() => (plan ? layoutOf(plan.layout) : null), [plan]);
  const objects = useMemo(() => (plan ? objectsOf(plan) : []), [plan]);
  const playback = useMemo(() => (plan ? createPlayback(plan, false) : null), [plan]);
  // the instant the clock opens at: the link's, else where the reader left; an instant outside the run is not used (the notes say so)
  const wanted = useMemo(() => (plan ? instantIn(link?.t ?? plant.view?.t ?? null, plan.horizon_s) : { t: null, fault: null }), [plan, link?.t, plant.view?.t]);
  const times = useMemo(() => (plan && picked ? objectTimes(plan, picked) : undefined), [plan, picked?.kind, picked?.index]);
  const host = useRef<HTMLDivElement>(null);
  const mounted = useRef<Scene | null>(null);
  const [scene, setScene] = useState<SceneStatus>({ kind: webgl ? "loading" : "none" });
  const [renderer, setRenderer] = useState<string | null>(null);

  // a pick opens the panel of an object and closes the record of a card (one panel at a time); it ends a follow
  const choose = (p: Picked | null): void => {
    if (p !== null) onCardClose();
    setPicked(p);
    setFollowing(null);
  };
  const chooseRef = useRef(choose);
  chooseRef.current = choose;

  useEffect(() => {
    const target = host.current;
    if (!webgl || !plan || !layout || !target || !playback) return;
    let live = true;
    let made: Scene | null = null;
    setScene({ kind: "loading" });
    setPicked(null);
    setFollowing(null);
    loadScene()
      .then(({ mountScene }) => {
        if (!live) return;
        made = mountScene({
          host: target, layout, plan, tier: tierOf(), playback, reducedMotion: reducedMotion(), lens: lensRef.current,
          // a click on a card opens its record, and the lens goes to the hall the card is in; a click on an object opens its panel
          onPick: (architecture, sample) => {
            setLens(architecture);
            chooseRef.current(null);
            cardRef.current(architecture, (plan.samples[sample] as ScenePlan["samples"][number]).id);
          },
          onPickObject: (p) => chooseRef.current(p),
          onFollowEnd: () => setFollowing(null),
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
  // the picked object, the follow, and the truth overlay (what the Worker answered for the halls, with the two texts every element of it carries, in the language of the page)
  useEffect(() => {
    if (scene.kind === "ready") mounted.current?.setPick(picked);
  }, [picked?.kind, picked?.index, scene.kind]);
  useEffect(() => {
    if (scene.kind === "ready") mounted.current?.setFollow(following);
  }, [following, scene.kind]);
  const absences = plant.truth.on ? plant.truth.halls?.view : null;
  useEffect(() => {
    if (scene.kind !== "ready") return;
    mounted.current?.setOverlay(absences ? { halls: absences.halls, captions: { label: text(lang, "plant.truth.label"), absence: template(lang, "plant.truth.absence") } } : null);
  }, [absences, lang, scene.kind]);

  useOpening(playback, wanted.t, scene.kind === "ready", reducedMotion(), lens, onLeave);

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

  const keyRefs = useRef({ times, picked, following });
  keyRefs.current = { times, picked, following };
  useEffect(() => {
    if (!webgl || !playback) return;
    const onKey = clockKeys({
      playback,
      times: () => keyRefs.current.times,
      follow: () => keyRefs.current.picked?.kind === "sample",
      toggleFollow: () => setFollowing((now) => (now === null && keyRefs.current.picked?.kind === "sample" ? keyRefs.current.picked.index : null)),
    });
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [webgl, playback]);

  // a button of the objects list or a list of tubes brings the camera to the object, and opens its panel (a hall has none: the lens and the cards are its way in)
  const look = (key: string): void => {
    mounted.current?.focus(key);
    host.current?.scrollIntoView({ block: "nearest" });
    const found = plan ? pickedOfKey(plan, key) : null;
    if (found) choose(found);
  };
  const pickAndLook = (p: Picked): void => {
    if (plan) look(keyOf(plan, p));
  };

  // the lens picks the hall the record panel reads; a card that is open in another hall is closed (the panel never reads a hall other than the lens)
  const chooseLens = (architecture: string): void => {
    setLens(architecture);
    if (plant.record && plant.record.architecture !== architecture) onCardClose();
  };

  const locked = plant.truth.on && (plant.truth.halls?.problem?.code === "locked" || plant.truth.sample?.problem?.code === "locked");
  const waiting = plan === null && plant.problem === null;
  const state = !webgl ? "text" : scene.kind;
  const intro = (
    <>
      <Intro webgl={webgl} planned={plan !== null} problem={plant.problem} scene={scene} state={state} renderer={renderer} />
      <LinkNotes notes={link?.notes ?? []} fallbackSeed={DEFAULT_PLANT.seed} outside={wanted.fault} horizon={plan?.horizon_s ?? null} engine={{ made: link?.engine ?? null, current: engine }} />
    </>
  );
  const drill = drillOf({ spec, engine, architectures }, () => Math.floor(playback?.get().t ?? 0));

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
            data-plant-truth={!plant.truth.on ? "off" : locked ? "locked" : "on"}
            data-plant-pick={plan && picked ? keyOf(plan, picked) : undefined}
            data-plant-follow={plan && following !== null ? (plan.samples[following] as ScenePlan["samples"][number]).id : undefined}
            data-run-hash={answer ? answer.hashes.truth : undefined}
            data-cells-hash={answer ? JSON.stringify(answer.hashes.cells) : undefined}
          />
          {(waiting || scene.kind === "loading") && (
            <p class="plant-boot" role="status">
              <T k="plant.boot" />
            </p>
          )}
          {full && playback && <Hud plan={full} playback={playback} scenario={spec.run.scenario} check={check} lens={lens} onLens={chooseLens} />}
          {full && playback && <TruthControl truth={{ on: plant.truth.on, locked }} onTruth={onTruth} />}
          {plant.record && <RecordPanel record={plant.record} drill={drill} onClose={onCardClose} truth={plant.truth} />}
          {full && playback && picked && (
            <Panels
              plan={full}
              playback={playback}
              pick={picked}
              drill={drill}
              lens={lens}
              fields={plant.fields}
              following={following !== null}
              onClose={() => choose(null)}
              onPick={pickAndLook}
              onFollow={() => setFollowing((now) => (now === null && picked.kind === "sample" ? picked.index : null))}
              onOpenRecord={(architecture, sample_id) => {
                choose(null);
                onCard(architecture, sample_id);
              }}
              onFields={onFields}
              onFieldsClose={onFieldsClose}
            />
          )}
          <div class="plant-bottom">
            <Hint />
            {plan && playback && <TimeBar plan={plan} playback={playback} {...(times && { times })} />}
            <BottomBar />
          </div>
        </div>
      )}

      {webgl && intro}
      {plan && full && playback && (
        <div class="plant-after">
          <ObjectsList objects={objects} onLook={scene.kind === "ready" ? look : null} />
          {webgl && <TubeList plan={full} playback={playback} onOpen={pickAndLook} />}
          {webgl && <CardList plan={full} playback={playback} lens={lens} onOpen={(architecture, sample_id) => { choose(null); onCard(architecture, sample_id); }} />}
          <TextAlternative plan={full} playback={playback} />
        </div>
      )}
    </>
  );
}
