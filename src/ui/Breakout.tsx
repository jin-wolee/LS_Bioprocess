import { hasKey } from "../i18n/index.ts";
import type { Key } from "../i18n/index.ts";
import type { Offer } from "../breakout_offer.ts";
import type { BreakoutResult, ResultFooter } from "../protocol.ts";
import { ArchitectureBlock } from "./BreakoutArchitecture.tsx";
import { EventFacts, Inputs, Observed, Topology } from "./BreakoutEvent.tsx";
import { breakoutRequest, caseLink, editBreakout } from "./breakout_view.ts";
import type { BreakoutForm } from "./breakout_view.ts";
import { ErrorBlock } from "./ErrorBlock.tsx";
import { FlagName } from "./Flags.tsx";
import { seedOf } from "./lineage_form.ts";
import { ResultBlock } from "./ResultBlock.tsx";
import { displayedCheck } from "./state.ts";
import type { ReadyInfo, State } from "./state.ts";
import { Label, T } from "./T.tsx";

// Break-out (lab_ui.md sections 3, 6 and 20; spec 11.4 to 11.6 and 11.8): after a contamination signal, what the walk-back finds in the record of each architecture. The reader chooses one of the
// five SC12 cases, a seed and the records to compare; the Worker answers with the report of that case over that one seed. The public build refuses the screen while any id it shows follows to a source
// below main-reread (ADR-0013); a local build shows it marked "not for publication". The screen orders no architecture and combines no metric into a score.

/** The sentence of the author's ruling on C29 (spec 11.8.12 C40): shown with a mycoplasma result only. */
export function C29() {
  return (
    <div class="notice" data-c29>
      <T as="h3" k="breakout.c29.heading" />
      <T as="p" k="breakout.c29.text" />
    </div>
  );
}

export function Refused() {
  return (
    <section aria-labelledby="breakout-refused-heading" data-note="refused">
      <T as="h1" k="breakout.refused.heading" id="breakout-refused-heading" />
      <T as="p" k="breakout.refused.text" class="notice" />
    </section>
  );
}

export function FormPanel({ ready, form, setForm, onRun, busy }: { ready: ReadyInfo; form: BreakoutForm; setForm: (f: BreakoutForm) => void; onRun: (f: BreakoutForm) => void; busy: boolean }) {
  const offer = ready.breakout;
  const seed = seedOf(form.seed);
  const presets = ready.presets.filter((p) => p.role === "preset");
  const ablations = ready.presets.filter((p) => p.role === "ablation");
  const toggle = (id: string, on: boolean) => setForm(editBreakout(form, { archs: on ? [...form.archs, id] : form.archs.filter((a) => a !== id) }));
  // P7c: the same case, seed and records in the plant (a link: it runs nothing)
  const inPlant = caseLink(form, ready, ready.engine_version);
  const caseKey = `breakout.case.${form.case}`;
  return (
    <section id="breakout-form">
      <div class="field">
        <T as="label" k="breakout.form.case" for="breakout-case" />
        <select id="breakout-case" data-label value={form.case} onChange={(event) => setForm(editBreakout(form, { case: event.currentTarget.value }))}>
          {(offer?.cases ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.id}
            </option>
          ))}
        </select>
      </div>
      {hasKey(caseKey) && <T as="p" k={caseKey as Key} class="pick-note" />}
      <div class="field">
        <T as="label" k="breakout.form.seed" for="breakout-seed" />
        <input id="breakout-seed" type="text" inputMode="numeric" autocomplete="off" list="breakout-seeds" value={form.seed} aria-invalid={seed === null} onInput={(event) => setForm(editBreakout(form, { seed: event.currentTarget.value }))} />
        <datalist id="breakout-seeds">
          {(offer?.seed_list ?? []).map((s) => (
            <option key={s} value={String(s)} />
          ))}
        </datalist>
        {seed === null && <T as="p" k="breakout.form.seed.invalid" class="warn" data-warn="seed" />}
      </div>
      <fieldset class="pick-set">
        <T as="legend" k="breakout.form.archs" />
        <div class="checks">
          {presets.map((p) => (
            <label key={p.id} class="check-option">
              <input id={`breakout-arch-${p.id}`} type="checkbox" checked={form.archs.includes(p.id)} onChange={(event) => toggle(p.id, event.currentTarget.checked)} /> <Label>{p.id}</Label>
            </label>
          ))}
        </div>
        {ablations.length > 0 && (
          <>
            <T as="p" k="breakout.form.ablations" class="shown-head" />
            <div class="checks" data-flag-list="breakout-ablations">
              {ablations.map((a) => (
                <label key={a.id} class="check-option" data-flag={a.ablated_flag ?? ""}>
                  <input id={`breakout-arch-${a.id}`} type="checkbox" checked={form.archs.includes(a.id)} onChange={(event) => toggle(a.id, event.currentTarget.checked)} />{" "}
                  {a.ablated_flag ? <FlagName flag={a.ablated_flag} /> : <Label>{a.id}</Label>}
                </label>
              ))}
            </div>
          </>
        )}
        {form.archs.length === 0 && <T as="p" k="breakout.form.none" class="warn" data-warn="architectures" />}
      </fieldset>
      <p>
        <button id="breakout-run" type="button" class="primary" disabled={busy || breakoutRequest(form, ready, 0) === null} onClick={() => onRun(form)}>
          <T k="breakout.form.run" />
        </button>
        {inPlant && (
          <>
            {" "}
            <a id="breakout-open-plant" href={inPlant} data-drill="plant">
              <T k="breakout.open_plant" />
            </a>
          </>
        )}
      </p>
    </section>
  );
}

export function ResultView({ result, ready, state }: { result: BreakoutResult; ready: ReadyInfo; state: State }) {
  const footer: ResultFooter = { kind: "simulation_result", scenario: result.scenario, seeds: [result.seed], engine_version: result.engine_version, architectures: result.architectures, inputs: [], check: state.check.state };
  return (
    <ResultBlock footer={footer} check={displayedCheck(footer.check, state.check.state)}>
      <div id="breakout-result" data-breakout-result data-case={result.case} data-seed={result.seed}>
        <EventFacts result={result} />
        <Inputs result={result} />
        <Topology result={result} />
        <Observed result={result} />
        {result.c29 !== null && <C29 />}
        <T as="p" k="breakout.note.order" />
        {result.per_architecture.map((arch) => (
          <ArchitectureBlock key={arch.architecture} arch={arch} result={result} ready={ready} />
        ))}
      </div>
    </ResultBlock>
  );
}

export function Breakout({ ready, state, form, setForm, offer, onRun }: { ready: ReadyInfo; state: State; form: BreakoutForm; setForm: (f: BreakoutForm) => void; offer: Offer; onRun: (f: BreakoutForm) => void }) {
  if (offer === "refused" || ready.breakout === null) return <Refused />;
  const { breakout } = state;
  return (
    <>
      <section aria-labelledby="breakout-heading">
        <T as="h1" k="breakout.heading" id="breakout-heading" />
        <T as="p" k="breakout.lead" />
        <T as="p" k="breakout.reading" data-note="reading" />
        {offer === "local_only" && <T as="p" k="breakout.local.notice" class="notice" data-note="not-for-publication" />}
      </section>
      <FormPanel ready={ready} form={form} setForm={setForm} onRun={onRun} busy={breakout.running !== null} />
      {breakout.running !== null && (
        <div class="run-status" role="status" id="breakout-status">
          <T as="p" k="breakout.running" class="run-word" />
        </div>
      )}
      {breakout.problem && <ErrorBlock problem={breakout.problem} />}
      {!breakout.result && breakout.running === null && !breakout.problem && <T as="p" k="breakout.empty" />}
      {breakout.result && <ResultView result={breakout.result} ready={ready} state={state} />}
    </>
  );
}
