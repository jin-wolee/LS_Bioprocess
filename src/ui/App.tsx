import { useEffect, useLayoutEffect, useReducer, useState } from "preact/hooks";
import { saveLang, savedLang, text } from "../i18n/index.ts";
import type { Lang } from "../i18n/index.ts";
import type { Request, Response } from "../protocol.ts";
import { Home } from "./Home.tsx";
import { initial, reduce } from "./state.ts";
import { LangContext, T } from "./T.tsx";

type Theme = "auto" | "light" | "dark";

/** The Home form of the run request (lab_ui.md section 4): one seed, no architectures. Seed 1 is the first seed of the goldens (spec section 7); the page draws no random number. */
const HOME_REQUEST: Request = { type: "run", id: 1, spec: { schema_version: "1", scenario: "default", settings: {}, architectures: [], seeds: [1] } };

export function App({ worker }: { worker: Worker }) {
  const [state, dispatch] = useReducer(reduce, initial);
  const [lang, setLang] = useState<Lang>(savedLang);
  const [theme, setTheme] = useState<Theme>("auto");
  const ready = state.ready !== null;

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
    if (ready) worker.postMessage(HOME_REQUEST);
  }, [ready, worker]);

  useEffect(() => {
    document.documentElement.lang = lang;
    saveLang(lang);
  }, [lang]);

  useEffect(() => {
    if (theme === "auto") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const other: Lang = lang === "en" ? "ko" : "en";
  return (
    <LangContext.Provider value={lang}>
      <header class="top">
        <T as="strong" k="app.title" class="brand" />
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
      <main id="main" data-ready={ready ? "true" : "false"}>
        <Home state={state} />
      </main>
      <footer class="foot">
        <T as="p" k="app.footer" />
      </footer>
    </LangContext.Provider>
  );
}
