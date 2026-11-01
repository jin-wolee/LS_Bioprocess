import { useContext } from "preact/hooks";
import { hasKey, text } from "../i18n/index.ts";
import type { ResultFooter } from "../protocol.ts";
import { ErrorBlock } from "./ErrorBlock.tsx";
import { LineageColumns, LineageTruth } from "./LineageView.tsx";
import { architecturesOf, editLineage, lineageRequest, seedOf } from "./lineage_form.ts";
import type { LineageForm } from "./lineage_form.ts";
import { ResultBlock } from "./ResultBlock.tsx";
import { displayedCheck } from "./state.ts";
import type { ReadyInfo, State } from "./state.ts";
import { Label, LangContext, T } from "./T.tsx";

// Lineage (lab_ui.md sections 3 and 8): one physical sample followed through the record of each architecture. The reader chooses a run (a scenario and a seed), the records to compare and the
// sample: the one the pick rule of the single-sample trace chooses, or any sample of the run. The Worker answers with the view and the ids of the run's samples. A run that is an unrevealed
// challenge is refused with `locked`, and the screen shows that as it shows any problem.

export function Lineage({ ready, state, form, setForm, onShow }: { ready: ReadyInfo; state: State; form: LineageForm; setForm: (f: LineageForm) => void; onShow: (f: LineageForm) => void }) {
  const lang = useContext(LangContext);
  const { lineage } = state;
  const update = (patch: Partial<LineageForm>) => setForm(editLineage(form, patch));
  const presets = ready.presets.filter((p) => p.role === "preset");
  const ablations = ready.presets.filter((p) => p.role === "ablation");
  const seed = seedOf(form.seed);
  const request = lineageRequest(form, 0);
  const toggle = (id: string, on: boolean) => update({ archs: on ? [...form.archs, id] : form.archs.filter((a) => a !== id) });
  const answer = lineage.answer;
  const footer: ResultFooter | null =
    answer && lineage.asked
      ? { kind: "simulation_result", scenario: lineage.asked.scenario, seeds: [lineage.asked.seed], engine_version: ready.engine_version, architectures: lineage.asked.architectures, inputs: [], check: state.check.state }
      : null;
  return (
    <>
      <section aria-labelledby="lineage-heading">
        <T as="h1" k="lineage.heading" id="lineage-heading" />
        <T as="p" k="lineage.lead" />
        <T as="p" k="lineage.locked.hint" class="notice" />
      </section>

      <section id="lineage-form">
        <div class="field">
          <T as="label" k="lineage.scenario" for="lineage-scenario" />
          <select id="lineage-scenario" data-label value={form.scenario} onChange={(event) => update({ scenario: event.currentTarget.value })}>
            {ready.scenarios.map((s) => (
              <option key={s.id} value={s.id}>
                {s.id}
              </option>
            ))}
          </select>
        </div>
        <div class="field">
          <T as="label" k="lineage.seed" for="lineage-seed" />
          <input id="lineage-seed" type="text" inputMode="numeric" autocomplete="off" value={form.seed} aria-invalid={seed === null} onInput={(event) => update({ seed: event.currentTarget.value })} />
          {seed === null && <T as="p" k="lineage.seed.invalid" class="warn" data-warn="seed" />}
        </div>

        <fieldset class="pick-set">
          <T as="legend" k="lineage.pick.heading" />
          <label class="check-option">
            <input id="lineage-pick-rule" type="radio" name="lineage-pick" checked={form.pick === "rule"} onChange={() => update({ pick: "rule" })} /> <T k="lineage.pick.rule" />
          </label>
          <T as="p" k="lineage.pick.rule.note" class="pick-note" />
          <label class="check-option">
            <input id="lineage-pick-reader" type="radio" name="lineage-pick" checked={form.pick === "reader"} onChange={() => update({ pick: "reader" })} /> <T k="lineage.pick.reader" />
          </label>
          {form.pick === "reader" && (
            <div class="field">
              <T as="label" k="lineage.pick.id" for="lineage-sample" />
              <input id="lineage-sample" type="text" autocomplete="off" list="lineage-samples" value={form.sample} onInput={(event) => update({ sample: event.currentTarget.value })} />
              <datalist id="lineage-samples" aria-label={text(lang, "lineage.pick.samples")}>
                {(answer?.sample_ids ?? []).map((id) => (
                  <option key={id} value={id} />
                ))}
              </datalist>
            </div>
          )}
        </fieldset>

        <section aria-labelledby="lineage-arch-heading">
          <T as="h2" k="lineage.arch.heading" id="lineage-arch-heading" />
          <div class="checks">
            {presets.map((p) => (
              <label key={p.id} class="check-option">
                <input id={`lineage-arch-${p.id}`} type="checkbox" checked={form.archs.includes(p.id)} onChange={(event) => toggle(p.id, event.currentTarget.checked)} /> <Label>{p.id}</Label>
              </label>
            ))}
          </div>
          {ablations.length > 0 && (
            <div class="field">
              <T as="label" k="lineage.arch.ablation" for="lineage-ablation" />
              <select id="lineage-ablation" value={form.ablation} data-flag-list="lineage-ablation" onChange={(event) => update({ ablation: event.currentTarget.value })}>
                <T as="option" k="lineage.arch.ablation.none" value="" />
                {ablations.map((a) => {
                  const key = `flag.${a.ablated_flag}.label`;
                  return (
                    <option key={a.id} value={a.id} data-flag={a.ablated_flag ?? ""}>
                      {hasKey(key) ? text(lang, key) : a.ablated_flag} ({a.id})
                    </option>
                  );
                })}
              </select>
            </div>
          )}
          {architecturesOf(form).length === 0 && <T as="p" k="lineage.arch.none" class="warn" data-warn="architectures" />}
        </section>

        <p>
          <button id="lineage-show" type="button" class="primary" disabled={request === null || lineage.running !== null} onClick={() => onShow(form)}>
            <T k="lineage.show" />
          </button>
        </p>
      </section>

      {lineage.running !== null && (
        <div class="run-status" role="status" id="lineage-status">
          <T as="p" k="lineage.running" class="run-word" />
        </div>
      )}
      {lineage.problem && <ErrorBlock problem={lineage.problem} />}
      {!answer && !lineage.running && !lineage.problem && <T as="p" k="lineage.empty" />}
      {answer && footer && (
        <ResultBlock footer={footer} check={displayedCheck(footer.check, state.check.state)}>
          <div id="lineage-view" data-lineage-view data-sample={answer.view.sample.sample_id}>
            <LineageTruth view={answer.view} />
            <LineageColumns view={answer.view} ready={ready} />
          </div>
        </ResultBlock>
      )}
    </>
  );
}
