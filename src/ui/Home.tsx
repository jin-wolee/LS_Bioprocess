import { webgl2 } from "../plant/loader.ts";
import { CheckDetails, CheckStatus } from "./CheckPanel.tsx";
import { ErrorBlock } from "./ErrorBlock.tsx";
import { OneFlag } from "./OneFlag.tsx";
import { ResultBlock } from "./ResultBlock.tsx";
import { ScenarioInputs } from "./ScenarioInputs.tsx";
import { hashOf } from "./route.ts";
import { HOME_ID, displayedCheck } from "./state.ts";
import type { State } from "./state.ts";
import { Label, T } from "./T.tsx";

// Home (lab_ui.md section 3): says what the lab is, offers the plant as its primary action (plant_ui.md sections 7 and 9: "Enter the plant", or the plant as text where the browser has no WebGL version
// two), shows the status line of the browser check, offers the card of the one-flag experiment (A3, section 26: a run the reader starts, never one the page starts), and keeps one run of the default
// scenario so the reader sees the synthetic plant produce events. P11: what the check covers and compared, the versions and the inputs are in one closed fold ("About this run"); A3: the run of the
// default scenario with its table of event counts is in the same fold, so the first screen is the plant's card, the status line and the card of the experiment, not a long list. The status line (the
// chip and the banner, a live region) is never inside the fold, and neither is a problem of the Worker or of the Home run (a closed fold would hide it).

export function Home({ state, onRunOneFlag, onCancelOneFlag }: { state: State; onRunOneFlag: () => void; onCancelOneFlag: () => void }) {
  const solid = webgl2();
  const scenario = state.ready?.scenarios.find((s) => s.id === "default");
  const problem = state.problem && (state.problem.id === HOME_ID || state.problem.id === null) ? state.problem : null;
  return (
    <>
      <section aria-labelledby="home-heading">
        <T as="h1" k="home.heading" id="home-heading" />
        <T as="p" k="home.lead" />
        <T as="p" k="home.notice" class="notice" />
      </section>

      <section id="plant-entry" class="home-plant" aria-labelledby="home-plant-heading">
        <T as="h2" k="home.plant.heading" id="home-plant-heading" />
        <T as="p" k="home.plant.lead" />
        {!solid && <T as="p" k="home.plant.nowebgl" class="notice" />}
        <p>
          <a id="enter-plant" class="primary-link" href={hashOf("plant")} data-plant-entry={solid ? "scene" : "text"}>
            <T k={solid ? "home.plant.enter" : "home.plant.text"} />
          </a>
        </p>
      </section>

      <CheckStatus state={state.check.state} detail={state.check.detail} />

      {problem && <ErrorBlock problem={problem} />}

      <OneFlag state={state} onRun={onRunOneFlag} onCancel={onCancelOneFlag} />

      <details id="about-run" class="home-about">
        <T as="summary" k="home.about.summary" />

        <section id="run" aria-labelledby="run-heading">
          <T as="h3" k="home.run.heading" id="run-heading" />
          <T as="p" k="home.run.lead" />
          {state.home ? (
            <ResultBlock footer={state.home.footer} summary={state.home.summary} check={displayedCheck(state.home.footer.check, state.check.state)} />
          ) : (
            !problem && <T as="p" k="home.run.pending" />
          )}
        </section>

        <CheckDetails state={state.check.state} detail={state.check.detail} />

        <section id="versions" aria-labelledby="versions-heading">
          <T as="h3" k="home.versions.heading" id="versions-heading" />
          <dl class="facts">
            <T as="dt" k="home.versions.engine" />
            <dd>{state.ready ? <Label>{state.ready.engine_version}</Label> : <T k="app.loading" />}</dd>
            <T as="dt" k="home.versions.schema" />
            <dd>{state.ready ? <Label>{state.ready.schema_version}</Label> : <T k="app.loading" />}</dd>
          </dl>
        </section>

        <section id="inputs" aria-labelledby="inputs-heading">
          <T as="h3" k="home.inputs.heading" id="inputs-heading" />
          <T as="p" k="home.inputs.lead" />
          <ScenarioInputs scenario={scenario} />
        </section>
      </details>
    </>
  );
}
