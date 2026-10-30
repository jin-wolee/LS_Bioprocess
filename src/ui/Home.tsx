import { CheckPanel } from "./CheckPanel.tsx";
import { ErrorBlock } from "./ErrorBlock.tsx";
import { Ref } from "./Ref.tsx";
import { ResultBlock } from "./ResultBlock.tsx";
import { displayedCheck } from "./state.ts";
import type { State } from "./state.ts";
import { Label, T } from "./T.tsx";

// Home (lab_ui.md section 3): says what the lab is, shows the browser check, and shows one run of the default scenario so the reader sees the synthetic plant produce events.

export function Home({ state }: { state: State }) {
  const scenario = state.ready?.scenarios.find((s) => s.id === "default");
  return (
    <>
      <section aria-labelledby="home-heading">
        <T as="h1" k="home.heading" id="home-heading" />
        <T as="p" k="home.lead" />
        <T as="p" k="home.notice" class="notice" />
      </section>

      <CheckPanel state={state.check.state} detail={state.check.detail} />

      <section id="versions" aria-labelledby="versions-heading">
        <T as="h2" k="home.versions.heading" id="versions-heading" />
        <dl class="facts">
          <T as="dt" k="home.versions.engine" />
          <dd>{state.ready ? <Label>{state.ready.engine_version}</Label> : <T k="app.loading" />}</dd>
          <T as="dt" k="home.versions.schema" />
          <dd>{state.ready ? <Label>{state.ready.schema_version}</Label> : <T k="app.loading" />}</dd>
        </dl>
      </section>

      <section id="run" aria-labelledby="run-heading">
        <T as="h2" k="home.run.heading" id="run-heading" />
        <T as="p" k="home.run.lead" />
        {state.problem && <ErrorBlock problem={state.problem} />}
        {state.result ? (
          <ResultBlock footer={state.result.footer} summary={state.result.summary} check={displayedCheck(state.result.footer.check, state.check.state)} />
        ) : (
          !state.problem && <T as="p" k="home.run.pending" />
        )}
      </section>

      <section id="inputs" aria-labelledby="inputs-heading">
        <T as="h2" k="home.inputs.heading" id="inputs-heading" />
        <T as="p" k="home.inputs.lead" />
        {scenario && (
          <ul class="inputs">
            {scenario.settings.map((s) => (
              <li key={s.name}>
                <code class="input-name">
                  <Label>{s.name}</Label>
                </code>
                <Ref ids={[s.ref]}>
                  {s.value} {s.unit}
                </Ref>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
