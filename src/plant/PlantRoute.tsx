import { useContext, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { text } from "../i18n/index.ts";
import type { CheckState, ScenePlan } from "../protocol.ts";
import { LangContext, T } from "../ui/T.tsx";
import { BottomBar } from "./BottomBar.tsx";
import type { BarProps } from "./BottomBar.tsx";
import { Hint, Hud } from "./Hud.tsx";
import { CardList } from "./CardList.tsx";
import { ObjectsList } from "./ObjectsList.tsx";
import { Panels } from "./Panels.tsx";
import { RecordPanel } from "./RecordPanel.tsx";
import { Intro } from "./Intro.tsx";
import { LinkNotes } from "./LinkNotes.tsx";
import { TextAlternative } from "./TextAlternative.tsx";
import { flagMatrix } from "./flags_board.ts";
import { TimeBar } from "./TimeBar.tsx";
import { TubeList } from "./TubeList.tsx";
import { drillOf } from "./drill.ts";
import { objectTimes } from "./events.ts";
import { clockKeys } from "./keys.ts";
import type { AskLink } from "./link.ts";
import { layoutOf } from "./layout.ts";
import { webgl2 } from "./loader.ts";
import { hallsOfPlan } from "./plant_state.ts";
import type { PlantState } from "./plant_state.ts";
import { openingOf } from "./opening.ts";
import { createPlayback } from "./playback.ts";
import { useAddress } from "./useAddress.ts";
import { useOpening } from "./useOpening.ts";
import { DEFAULT_PLANT, hallsOf, isCase, scenarioOf } from "./spec.ts";
import type { PlantAsk } from "./spec.ts";
import { reducedMotion, tierOf, useScene } from "./useScene.ts";
import { keyOf, objectsOf, pickedOfKey } from "./view.ts";
import type { Picked } from "./view.ts";
import "./plant.css";

// The plant route (docs/design/plant_ui.md sections 7 and 9). It is part of the first load and holds no WebGL: the scene and `three` are the chunk that `loadScene` fetches, and only when
// `webgl2()` says the browser can draw it. Without WebGL the chunk is never requested and the objects list and the text alternative stand in for the scene. The page state is attributes on the plant
// host (`data-plant-*`, `data-run-hash`, `data-cells-hash`), so the end-to-end checks read the DOM and the page ships no test global. The run's clock (playback.ts) is made with the plan; the scene gives
// it the wall seconds of its frames, the controls and the keys below change it, and the host's `data-plant-t`, `-speed` and `-playing` are written from it.
//
// P6a: the bar under the floor takes the operator actions; the list of them is in the HUD, the clock resumes at `resume_at` when the plan of an action arrives, and the address holds the plant link of the
// spec once a run has settled.
//
// P5c: the plant is the page store's. The route opens on the instant of the link (`t`, which wins) or the one the reader left at (`plant.view`), paused, with the lens they left on, and saves both when it
// unmounts; the panels carry the links to the other screens (section 7).
//
// P5b: the object the reader picked (a click in the scene, a button of a list) opens its panel and is what `,` and `.` step between the events of; `F` follows a picked sample; the switch of the truth
// overlay is the HUD's, and what the Worker answers is drawn by the scene (the placeholders) and by the record panel (the truth column and the verdicts).

export function PlantRoute({ plant, check, link, engine, architectures, flags, onCard, onCardClose, onFields, onFieldsClose, onTruth, onLeave, onAct, onRefusalClose }: {
  plant: PlantState;
  check: CheckState;
  /** The link the route was opened with: its notes, its instant and the engine version it was made with; null when the address has no query. */
  link: AskLink | null;
  /** The engine version of the build and the record architectures the Setup screen offers (for the links to other screens). */
  engine: string;
  architectures: readonly string[];
  /** The flags of `ready`, for the flag form of the bar. */
  flags: readonly string[];
  /** The reader leaves the plant: the clock instant and the lens are the store's to keep. */
  onLeave: (t: number, lens: string) => void;
  onCard: (architecture: string, sample_id: string) => void;
  onCardClose: () => void;
  onFields: (architecture: string, sample_id: string) => void;
  onFieldsClose: () => void;
  onTruth: (on: boolean) => void;
  /** An operator action: the spec with the list including it, and whether the clock was playing when the reader acted. */
  onAct: (spec: PlantAsk, play: boolean) => void;
  onRefusalClose: () => void;
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
  // the picked object and the sample the camera follows; a new plan has none
  const [picked, setPicked] = useState<Picked | null>(null);
  const [following, setFollowing] = useState<number | null>(null);
  const layout = useMemo(() => (plan ? layoutOf(plan.layout) : null), [plan]);
  const objects = useMemo(() => (plan ? objectsOf(plan) : []), [plan]);
  const playback = useMemo(() => (plan ? createPlayback(plan, false) : null), [plan]);
  // the instant the clock opens at: after an action, its resume_at; else the link's, else where the reader left; an instant outside the run is not used (the notes say so)
  const wanted = useMemo(
    () => (plan ? openingOf({ resume: plant.act.resume, epoch: answer?.epoch ?? null, linkT: link?.t ?? null, viewT: plant.view?.t ?? null, horizon: plan.horizon_s }) : { t: null, fault: null, play: null }),
    [plan, link?.t, plant.view?.t, plant.act.resume],
  );
  // an action request is in flight: the bar waits; the board the reader asked for from the objects list opens the form of the move of a draw on its bay
  const busy = plant.act.pending !== null;
  const [ask, setAsk] = useState<BarProps["ask"]>(null);
  const times = useMemo(() => (plan && picked ? objectTimes(plan, picked) : undefined), [plan, picked?.kind, picked?.index]);
  const host = useRef<HTMLDivElement>(null);

  // a pick opens the panel of an object and closes the record of a card (one panel at a time); it ends a follow
  const choose = (p: Picked | null): void => {
    if (p !== null) onCardClose();
    setPicked(p);
    setFollowing(null);
  };

  const absences = plant.truth.on ? plant.truth.halls?.view : null;
  const breakout = plant.truth.on ? plant.truth.breakout?.view : null;
  const { scene, renderer, mounted } = useScene({
    host, webgl, plan, layout, playback, halls, lens, picked, following, flags, absences, breakout, lang,
    handlers: {
      // a click on a card opens its record, and the lens goes to the hall the card is in; a click on an object opens its panel
      card: (architecture, sample) => {
        setLens(architecture);
        choose(null);
        onCard(architecture, ((plan as ScenePlan).samples[sample] as ScenePlan["samples"][number]).id);
      },
      object: choose,
      followEnd: () => setFollowing(null),
      cell: (hall, flag) => pickCell(hall, flag),
      reset: () => choose(null),
    },
  });

  useOpening(playback, wanted.t, wanted.play, scene.kind === "ready", reducedMotion(), lens, onLeave);
  useAddress(plant.spec, plant.running === null && plan !== null, engine);

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
    if (key.startsWith("board:")) setAsk((now) => ({ form: "move_draw", bay: Number(key.slice(7)) - 1, nonce: (now?.nonce ?? 0) + 1 }));
  };
  // a cell of the flags board (a click in the scene, or its button in the objects list): the camera goes to the panel and the flag form opens on that hall's record and that flag
  const pickCell = (hall: number, flag: string): void => {
    const architecture = hallsOf(spec)[hall];
    if (architecture === undefined) return;
    mounted.current?.focus("flags:board");
    setAsk((now) => ({ form: "set_flag", architecture, flag, nonce: (now?.nonce ?? 0) + 1 }));
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
      <Intro webgl={webgl} planned={plan !== null} breakout={isCase(spec)} scenario={scenarioOf(spec)} problem={plant.problem} scene={scene} state={state} renderer={renderer} />
      <LinkNotes notes={link?.notes ?? []} fallbackSeed={link?.spec.seed ?? DEFAULT_PLANT.seed} outside={wanted.fault} horizon={plan?.horizon_s ?? null} engine={{ made: link?.engine ?? null, current: engine }} />
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
            data-plant-actions={spec.actions.length}
            data-plant-case={isCase(spec) ? spec.case : undefined}
            data-plant-recomputing={busy ? "true" : undefined}
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
          <div class="plant-huds">
            {full && playback && (
              <Hud plan={full} playback={playback} scenario={scenarioOf(spec)} check={check} lens={lens} onLens={chooseLens} truth={{ on: plant.truth.on, locked }} onTruth={onTruth} spec={spec} busy={busy} onAct={onAct} />
            )}
            <div class="plant-side">
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
            </div>
            <div class="plant-bottom">
              <Hint />
              {plan && playback && <TimeBar plan={plan} playback={playback} {...(times && { times })} />}
              {full && playback && (
                <BottomBar plan={full} playback={playback} spec={spec} flags={flags} picked={picked} busy={busy} refusal={plant.act.refusal} ask={ask} onAct={onAct} onRefusalClose={onRefusalClose} />
              )}
            </div>
          </div>
        </div>
      )}

      {webgl && intro}
      {plan && full && playback && (
        <div class="plant-after">
          <ObjectsList objects={objects} onLook={scene.kind === "ready" ? look : null} matrix={webgl ? flagMatrix(full, flags) : null} onCell={webgl && scene.kind === "ready" ? pickCell : null} />
          {webgl && <TubeList plan={full} playback={playback} onOpen={pickAndLook} />}
          {webgl && <CardList plan={full} playback={playback} lens={lens} onOpen={(architecture, sample_id) => { choose(null); onCard(architecture, sample_id); }} />}
          <TextAlternative plan={full} playback={playback} flags={flags} lens={lens} />
        </div>
      )}
    </>
  );
}
