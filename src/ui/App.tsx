import { useEffect, useLayoutEffect, useReducer, useState } from "preact/hooks";
import { saveLang, savedLang, text } from "../i18n/index.ts";
import type { Lang } from "../i18n/index.ts";
import type { Request, Response } from "../protocol.ts";
import { defaultForm, fromQuery, specOf } from "./form.ts";
import type { Form } from "./form.ts";
import { Home } from "./Home.tsx";
import { Notes } from "./Notes.tsx";
import { Results } from "./Results.tsx";
import { hashOf, parseHash } from "./route.ts";
import type { Route, Screen } from "./route.ts";
import { Setup } from "./Setup.tsx";
import { HOME_ID, initial, reduce } from "./state.ts";
import { LangContext, T } from "./T.tsx";

type Theme = "auto" | "light" | "dark";

/** The Home form of the run request (lab_ui.md section 4): one seed, no architectures. Seed 1 is the first seed of the goldens (spec section 7); the page draws no random number. */
const HOME_REQUEST: Request = { type: "run", id: HOME_ID, spec: { schema_version: "1", scenario: "default", settings: {}, architectures: [], seeds: [1] } };

const NAV: Screen[] = ["home", "setup", "results", "notes"];

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
  const [nextId, setNextId] = useState(HOME_ID + 1);
  const ready = state.ready;

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
    const out = ready ? specOf(f, ready) : null;
    if (!out?.ok) return;
    dispatch({ type: "run_started", id: nextId });
    setNextId(nextId + 1);
    worker.postMessage({ type: "run", id: nextId, spec: out.spec } satisfies Request);
    window.location.hash = hashOf("results");
  };
  const cancel = () => {
    if (state.running !== null) worker.postMessage({ type: "cancel", id: state.running } satisfies Request);
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
        {route.screen === "setup" &&
          (ready && form ? (
            <Setup ready={ready} form={form} setForm={setForm} state={state} link={pageAddress()} linkEngine={linkEngine} onRun={run} onCancel={cancel} />
          ) : (
            <T as="p" k="app.loading" />
          ))}
        {route.screen === "results" && (ready ? <Results state={state} ready={ready} onCancel={cancel} /> : <T as="p" k="app.loading" />)}
        {route.screen === "notes" && <Notes ready={ready} />}
      </main>
      <footer class="foot">
        <T as="p" k="app.footer" />
      </footer>
    </LangContext.Provider>
  );
}
