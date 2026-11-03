import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "preact/hooks";
import { saveLang, savedLang, text } from "../i18n/index.ts";
import type { Lang } from "../i18n/index.ts";
import type { Request, Response } from "../protocol.ts";
import { OFFER } from "../breakout_offer.ts";
import { Breakout } from "./Breakout.tsx";
import { breakoutRequest, defaultBreakoutForm, plantBreakoutForm } from "./breakout_view.ts";
import type { BreakoutForm } from "./breakout_view.ts";
import { Challenge } from "./Challenge.tsx";
import { challengeStart, defaultChallengeForm } from "./challenge_form.ts";
import type { ChallengeForm } from "./challenge_form.ts";
import { leftOutOf } from "../plant/action_list.ts";
import { isCase } from "../plant/spec.ts";
import { defaultForm, fromQuery, runRequest } from "./form.ts";
import type { Form } from "./form.ts";
import { Home } from "./Home.tsx";
import { Lineage } from "./Lineage.tsx";
import { defaultLineageForm, lineageRequest, plantLineageForm } from "./lineage_form.ts";
import type { LineageForm } from "./lineage_form.ts";
import { Notes } from "./Notes.tsx";
import { PlantOrigin } from "./PlantOrigin.tsx";
import { PlantRoute } from "../plant/PlantRoute.tsx";
import { Results } from "./Results.tsx";
import { SCREENS, hashOf, parseHash } from "./route.ts";
import type { Route, Screen } from "./route.ts";
import { Setup } from "./Setup.tsx";
import { SiteLink } from "./SiteLink.tsx";
import { HOME_ID, initial, reduce } from "./state.ts";
import { LangContext, T } from "./T.tsx";
import { useOrigin } from "./useOrigin.ts";
import { usePlant } from "./usePlant.ts";

type Theme = "auto" | "light" | "dark";

/** The Home form of the run request (lab_ui.md section 4): one seed, no architectures. Seed 1 is the first seed of the goldens (spec section 7); the page draws no random number. */
const HOME_REQUEST: Request = { type: "run", id: HOME_ID, spec: { schema_version: "1", scenario: "default", settings: {}, architectures: [], seeds: [1] } };

/** The navigation: every screen, except the Break-out screen in a build that refuses it (lab_ui.md section 20). */
const NAV: readonly Screen[] = SCREENS.filter((screen) => screen !== "breakout" || OFFER !== "refused");

/** The address of the page without its hash: the link of a setup is this and `#/setup?...`. */
const pageAddress = (): string => {
  try {
    return window.location.href.split("#")[0] ?? "";
  } catch {
    return "";
  }
};

export function App({ worker }: { worker: Worker }) {
  const [state, dispatch] = useReducer(reduce, initial);
  const [lang, setLang] = useState<Lang>(savedLang);
  const [theme, setTheme] = useState<Theme>("auto");
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  const [form, setForm] = useState<Form | null>(null);
  const [linkEngine, setLinkEngine] = useState<string | null>(null);
  const ids = useRef(HOME_ID + 1);
  const take = (): number => ids.current++;
  // the forms of the one-seed screens start from the defaults of the build and keep what the reader typed while they visit another screen
  const [lineageForm, setLineageForm] = useState<LineageForm | null>(null);
  const [challengeForm, setChallengeForm] = useState<ChallengeForm | null>(null);
  const [breakoutForm, setBreakoutForm] = useState<BreakoutForm | null>(null);
  const ready = state.ready;
  const lineageNow = lineageForm ?? (ready ? defaultLineageForm(ready) : null);
  const challengeNow = challengeForm ?? (ready ? defaultChallengeForm(ready) : null);
  const breakoutNow = breakoutForm ?? (ready ? defaultBreakoutForm(ready) : null);

  // a layout effect runs inside the render task, before the Worker's first message can be handled
  useLayoutEffect(() => {
    const onMessage = (event: MessageEvent<Response>) => dispatch(event.data);
    const onError = (event: ErrorEvent) => dispatch({ type: "worker_error", message: event.message || "the Worker raised an error" });
    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);
    return () => {
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
    };
  }, [worker]);

  useEffect(() => {
    const onHash = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    if (ready) worker.postMessage(HOME_REQUEST);
  }, [ready !== null, worker]);

  // what the page knows of the build, to read a link against
  // (the cases and the defaults of the Break-out form are in it only where the build offers the screen: P7c, plant_ui.md section 7)
  const known = useMemo(
    () => (ready ? { scenarios: ready.scenarios.map((x) => x.id), architectures: ready.presets.map((x) => x.id), breakout: ready.breakout && { cases: ready.breakout.cases.map((c) => c.id), seed: ready.breakout.seed_list[0] ?? 0, architectures: defaultBreakoutForm(ready).archs } } : null),
    [ready],
  );
  // the plant: the run the route wants, the rows of a card, the truth overlay (usePlant.ts)
  const plant = usePlant({ worker, state, dispatch, route, known, take });

  // a screen opened from the plant: the plant it came from (useOrigin), and the first Lineage link asks for its sample
  const origin = useOrigin(
    known,
    route,
    state.results,
    (link, sample) => {
      if (!ready || isCase(link.spec)) return;
      const f = plantLineageForm(ready, link.spec, sample);
      setLineageForm(f);
      showLineage(f);
    },
    (link) => {
      if (!ready || !isCase(link.spec)) return;
      const f = plantBreakoutForm(link.spec);
      setBreakoutForm(f);
      runBreakout(f);
    },
  );

  // the form starts from the defaults of the first scenario, or from the link the page was opened with; a link opened later (a hash change) fills it again
  useEffect(() => {
    if (!ready) return;
    if (route.screen === "setup" && route.query !== "") {
      const link = fromQuery(route.query, ready);
      setForm(link.form);
      setLinkEngine(link.engine);
    } else if (form === null) {
      setForm(defaultForm(ready, ready.scenarios[0]?.id ?? "default"));
    }
  }, [ready !== null, route.screen, route.query]);

  useEffect(() => {
    document.documentElement.lang = lang;
    saveLang(lang);
  }, [lang]);

  useEffect(() => {
    if (theme === "auto") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const run = (f: Form) => {
    const id = take();
    const request = ready ? runRequest(f, ready, id) : null;
    if (!request) return;
    dispatch({ type: "run_started", id });
    worker.postMessage(request satisfies Request);
    window.location.hash = hashOf("results");
  };
  const cancel = () => {
    if (state.running !== null) worker.postMessage({ type: "cancel", id: state.running } satisfies Request);
  };

  const showLineage = (f: LineageForm) => {
    const id = take();
    const request = lineageRequest(f, id);
    if (request?.type !== "lineage") return;
    dispatch({ type: "lineage_started", id, asked: { scenario: request.spec.scenario, seed: request.seed, architectures: request.spec.architectures } });
    worker.postMessage(request);
  };
  const runBreakout = (f: BreakoutForm) => {
    const id = take();
    const request = ready ? breakoutRequest(f, ready, id) : null;
    if (request?.type !== "breakout") return;
    dispatch({ type: "breakout_started", id, asked: { case: request.case, seed: request.seed, architectures: request.architectures } });
    worker.postMessage(request);
  };
  const startChallenge = (f: ChallengeForm) => {
    const id = take();
    const request = ready ? challengeStart(f, ready, id) : null;
    if (request?.type !== "challenge_start") return;
    dispatch({ type: "challenge_starting", id, meta: { variant: f.variant, scenario: f.scenario, seed: request.seed, shown: f.shown } });
    worker.postMessage(request);
  };
  const active = state.challenge.active;
  const openSample = (sample_id: string) => {
    if (!active) return;
    const id = take();
    dispatch({ type: "challenge_busy", busy: { id, kind: "open", sample_id } });
    worker.postMessage({ type: "challenge_open", id, challenge: active.challenge, sample_id } satisfies Request);
  };
  const guess = (target: { sample_id: string } | { decision_id: string }) => {
    if (!active) return;
    const id = take();
    dispatch({ type: "challenge_busy", busy: { id, kind: "guess" } });
    worker.postMessage({ type: "challenge_guess", id, challenge: active.challenge, target } satisfies Request);
  };
  const giveUp = () => {
    if (!active) return;
    const id = take();
    dispatch({ type: "challenge_busy", busy: { id, kind: "giveup" } });
    worker.postMessage({ type: "challenge_giveup", id, challenge: active.challenge } satisfies Request);
  };

  const other: Lang = lang === "en" ? "ko" : "en";
  return (
    <LangContext.Provider value={lang}>
      <header class="top">
        <T as="strong" k="app.title" class="brand" />
        <nav aria-label={text(lang, "nav.label")} class="nav">
          {NAV.map((screen) => (
            <a key={screen} id={`nav-${screen}`} href={hashOf(screen)} {...(route.screen === screen && { "aria-current": "page" })}>
              <T k={`nav.${screen}`} />
            </a>
          ))}
        </nav>
        <div class="controls">
          <SiteLink />
          <button id="lang-toggle" type="button" lang={other} aria-label={text(lang, "controls.lang.label")} onClick={() => setLang(other)}>
            <T k="controls.lang.switch" />
          </button>
          <label>
            <T k="controls.theme.label" />{" "}
            <select id="theme-select" value={theme} onChange={(event) => setTheme(event.currentTarget.value as Theme)}>
              <T as="option" k="controls.theme.auto" value="auto" />
              <T as="option" k="controls.theme.light" value="light" />
              <T as="option" k="controls.theme.dark" value="dark" />
            </select>
          </label>
        </div>
      </header>
      <main id="main" data-ready={ready ? "true" : "false"} data-screen={route.screen} {...(ready && { "data-flags": ready.flags.join(",") })}>
        {route.screen === "home" && <Home state={state} />}
        {origin && ready && <PlantOrigin origin={origin} plant={state.plant} engine={ready.engine_version} screen={route.screen} />}
        {route.screen === "plant" &&
          (ready ? (
            <PlantRoute
              plant={state.plant}
              check={state.check.state}
              link={plant.link}
              engine={ready.engine_version}
              architectures={ready.presets.map((x) => x.id)}
              flags={ready.flags}
              onCard={plant.openCard}
              onCardClose={plant.closeCard}
              onFields={plant.openFields}
              onFieldsClose={plant.closeFields}
              onAct={plant.act}
              onRefusalClose={plant.closeRefusal}
              onTruth={(on) => dispatch({ type: "plant_truth_switched", on })}
              onLeave={(t, lens) => dispatch({ type: "plant_left", t, lens })}
            />
          ) : (
            <T as="p" k="app.loading" />
          ))}
        {route.screen === "setup" &&
          (ready && form ? (
            <Setup ready={ready} form={form} setForm={setForm} state={state} link={pageAddress()} linkEngine={linkEngine} leftOut={origin ? leftOutOf(origin.link.spec.actions) : []} onRun={run} onCancel={cancel} />
          ) : (
            <T as="p" k="app.loading" />
          ))}
        {route.screen === "results" && (ready ? <Results state={state} ready={ready} onCancel={cancel} /> : <T as="p" k="app.loading" />)}
        {route.screen === "lineage" &&
          (ready && lineageNow ? <Lineage ready={ready} state={state} form={lineageNow} setForm={setLineageForm} onShow={showLineage} /> : <T as="p" k="app.loading" />)}
        {route.screen === "challenge" &&
          (ready && challengeNow ? (
            <Challenge ready={ready} state={state} form={challengeNow} setForm={setChallengeForm} actions={{ onStart: startChallenge, onOpen: openSample, onGuess: guess, onGiveUp: giveUp, onNew: () => dispatch({ type: "challenge_reset" }) }} />
          ) : (
            <T as="p" k="app.loading" />
          ))}
        {route.screen === "breakout" &&
          (ready && breakoutNow ? <Breakout ready={ready} state={state} form={breakoutNow} setForm={setBreakoutForm} offer={OFFER} onRun={runBreakout} /> : <T as="p" k="app.loading" />)}
        {route.screen === "notes" && <Notes ready={ready} />}
      </main>
      <footer class="foot">
        <T as="p" k="app.footer" />
      </footer>
    </LangContext.Provider>
  );
}
