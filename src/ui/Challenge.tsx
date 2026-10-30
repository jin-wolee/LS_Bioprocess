import { useContext } from "preact/hooks";
import { hasKey, text } from "../i18n/index.ts";
import type { ResultFooter } from "../protocol.ts";
import { canShow, challengeStart, formFor, seedChoices } from "./challenge_form.ts";
import type { ChallengeForm } from "./challenge_form.ts";
import { ErrorBlock } from "./ErrorBlock.tsx";
import { ErrorTypeName } from "./Figure.tsx";
import { seedOf } from "./lineage_form.ts";
import { RecordSvg } from "./RecordSvg.tsx";
import { DecisionTables, SampleTables } from "./RecordTables.tsx";
import { Ref } from "./Ref.tsx";
import { ResultBlock } from "./ResultBlock.tsx";
import { RevealView } from "./RevealView.tsx";
import { displayedCheck } from "./state.ts";
import type { ReadyInfo, State } from "./state.ts";
import { Label, LangContext, T } from "./T.tsx";
import type { ActiveChallenge } from "./one_seed_state.ts";
import type { DecisionRecordView, RecordView } from "../protocol.ts";

// Challenge (lab_ui.md sections 3 and 9): find the error in the record. The start panel chooses the kind of error, the seed and the record to search; the Worker plants one error and sends the
// announced type and the record; the reader opens samples, makes one guess or gives up, and only then receives the reveal. The page holds no plant: until the reveal it knows what the record
// says and nothing else, and it states plainly that this is a game on the honour system, not a security boundary.

export interface ChallengeActions {
  onStart: (form: ChallengeForm) => void;
  onOpen: (sample_id: string) => void;
  onGuess: (target: { sample_id: string } | { decision_id: string }) => void;
  onGiveUp: () => void;
  onNew: () => void;
}

function StartPanel({ ready, state, form, setForm, onStart }: { ready: ReadyInfo; state: State; form: ChallengeForm; setForm: (f: ChallengeForm) => void; onStart: (f: ChallengeForm) => void }) {
  const lang = useContext(LangContext);
  const { challenge } = state;
  const seed = seedOf(form.seed);
  const ablations = ready.presets.filter((p) => p.role === "ablation");
  const presets = ready.presets.filter((p) => p.role === "preset");
  const option = (id: string, flag: string | null) => {
    const can = canShow(ready, form.variant, id);
    const key = `flag.${flag}.label`;
    return (
      <label key={id} class={`check-option${can.ok ? "" : " disabled"}`} data-flag={flag ?? undefined}>
        <input id={`challenge-shown-${id}`} type="radio" name="challenge-shown" disabled={!can.ok} checked={form.shown === id} onChange={() => setForm({ ...form, shown: id })} />{" "}
        {flag ? (hasKey(key) ? text(lang, key) : flag) : null} <Label>{id}</Label>
        {!can.ok && (
          <>
            {" "}
            <T k={can.reason} class="disabled-reason" data-reason={id} />
          </>
        )}
      </label>
    );
  };
  return (
    <section id="challenge-start-panel" aria-labelledby="challenge-start-heading">
      <fieldset class="pick-set">
        <T as="legend" k="challenge.variant.heading" />
        {ready.challenge_variants.map((v) => (
          <div key={v}>
            <label class="check-option">
              <input id={`challenge-variant-${v}`} type="radio" name="challenge-variant" checked={form.variant === v} onChange={() => setForm(formFor(ready, v, form.scenario))} /> <T k={`challenge.variant.${v}`} />
            </label>
            <T as="p" k={`challenge.variant.${v}.note`} class="pick-note" />
          </div>
        ))}
      </fieldset>
      {form.variant === "sample" && (
        <div class="field">
          <T as="label" k="challenge.scenario" for="challenge-scenario" />
          <select id="challenge-scenario" data-label value={form.scenario} onChange={(event) => setForm({ ...form, scenario: event.currentTarget.value })}>
            {ready.scenarios.map((s) => (
              <option key={s.id} value={s.id}>
                {s.id}
              </option>
            ))}
          </select>
        </div>
      )}
      <div class="field">
        <T as="label" k="challenge.seed" for="challenge-seed" />
        <input id="challenge-seed" type="text" inputMode="numeric" autocomplete="off" list="challenge-seeds" value={form.seed} aria-invalid={seed === null} onInput={(event) => setForm({ ...form, seed: event.currentTarget.value })} />
        <datalist id="challenge-seeds">
          {seedChoices(ready, form.variant).map((s) => (
            <option key={s} value={String(s)} />
          ))}
        </datalist>
        {seed === null && <T as="p" k="challenge.seed.invalid" class="warn" data-warn="seed" />}
      </div>
      <T as="h2" k="challenge.shown.heading" id="challenge-start-heading" />
      <T as="p" k="challenge.shown.lead" />
      <div class="shown-list">{presets.map((p) => option(p.id, null))}</div>
      <div class="shown-list" data-flag-list="challenge-ablations">
        <T as="p" k="challenge.shown.ablation" class="shown-head" />
        {ablations.map((a) => option(a.id, a.ablated_flag))}
      </div>
      <p>
        <button id="challenge-start" type="button" class="primary" disabled={challengeStart(form, ready, 0) === null || challenge.starting !== null} onClick={() => onStart(form)}>
          <T k="challenge.start" />
        </button>
      </p>
      {challenge.starting && (
        <div class="run-status" role="status" id="challenge-status">
          <T as="p" k="challenge.starting" class="run-word" />
          {challenge.starting.total > 0 && <progress id="challenge-progress" max={challenge.starting.total} value={challenge.starting.done} />}
        </div>
      )}
    </section>
  );
}

function Playing({ ready, state, active, actions }: { ready: ReadyInfo; state: State; active: ActiveChallenge; actions: ChallengeActions }) {
  const footer: ResultFooter = { kind: "simulation_result", scenario: active.scenario, seeds: [active.seed], engine_version: ready.engine_version, architectures: [active.shown], inputs: active.inputs, check: state.check.state };
  const busy = state.challenge.busy !== null;
  const decision = active.variant === "decision";
  const tableActions = { disabled: busy || active.reveal !== null, onOpen: actions.onOpen, onGuess: actions.onGuess };
  return (
    <ResultBlock footer={footer} check={displayedCheck(footer.check, state.check.state)}>
      <div id="challenge-play" data-challenge={active.challenge} data-variant={active.variant}>
        <T as="p" k="challenge.announced" class="announced" data-announced={active.announced_type} parts={{ type: <ErrorTypeName type={active.announced_type} /> }} />
        <T as="p" k={decision ? "challenge.announced.decision" : "challenge.announced.sample"} />
        {active.inputs.length > 0 && (
          <section class="inputs-printed" aria-labelledby="challenge-inputs-heading">
            <T as="h3" k={decision ? "challenge.inputs.heading" : "results.inputs.heading"} id="challenge-inputs-heading" />
            <T as="p" k={decision ? "challenge.inputs.lead" : "results.inputs.lead"} />
            <ul class="inputs">
              {active.inputs.map((input) => (
                <li key={input.name}>
                  <code class="input-name">
                    <Label>{input.name}</Label>
                  </code>
                  <Ref ids={[input.ref]}>
                    {input.value} {input.unit}
                  </Ref>
                </li>
              ))}
            </ul>
          </section>
        )}
        <T as="h3" k="challenge.record.heading" />
        <dl class="facts">
          <dt>
            <code>architecture</code>
          </dt>
          <dd>
            <Label>{active.shown}</Label>
          </dd>
        </dl>
        {!active.reveal && (
          <p>
            <button id="challenge-giveup" type="button" disabled={busy} onClick={actions.onGiveUp}>
              <T k="challenge.giveup" />
            </button>
          </p>
        )}
        <section id="challenge-opened" aria-live="polite">
          {active.opened ? (
            <>
              <T as="h3" k="challenge.opened.heading" parts={{ sample: <Label>{active.opened.sample_id}</Label> }} />
              <RecordSvg column={active.opened.sample} sample={active.opened.sample_id} />
            </>
          ) : (
            <T as="p" k="challenge.opened.none" />
          )}
        </section>
        {decision ? <DecisionTables record={active.record as DecisionRecordView} actions={tableActions} /> : <SampleTables record={active.record as RecordView} actions={tableActions} />}
        {active.reveal && <RevealView reveal={active.reveal} ready={ready} onNew={actions.onNew} />}
      </div>
    </ResultBlock>
  );
}

export function Challenge({ ready, state, form, setForm, actions }: { ready: ReadyInfo; state: State; form: ChallengeForm; setForm: (f: ChallengeForm) => void; actions: ChallengeActions }) {
  const { challenge } = state;
  return (
    <>
      <section aria-labelledby="challenge-heading">
        <T as="h1" k="challenge.heading" id="challenge-heading" />
        <T as="p" k="challenge.lead" />
        <T as="p" k="challenge.honour" class="notice" data-note="honour" />
      </section>
      {challenge.problem && <ErrorBlock problem={challenge.problem} />}
      {challenge.active ? <Playing ready={ready} state={state} active={challenge.active} actions={actions} /> : <StartPanel ready={ready} state={state} form={form} setForm={setForm} onStart={actions.onStart} />}
    </>
  );
}
