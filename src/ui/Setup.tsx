import type { ScenarioInfo } from "../protocol.ts";
import { ErrorBlock } from "./ErrorBlock.tsx";
import { FlagMatrix } from "./Flags.tsx";
import { defaultForm, parseSeeds, rangeWarning, specOf, toQuery, whole, withCounts } from "./form.ts";
import type { Form } from "./form.ts";
import { Ref } from "./Ref.tsx";
import { RunStatus } from "./RunStatus.tsx";
import { ScenarioInputs } from "./ScenarioInputs.tsx";
import { Architectures, Capture } from "./SetupChoices.tsx";
import { ProfileList } from "./SetupLists.tsx";
import { HOME_ID } from "./state.ts";
import type { ReadyInfo, State } from "./state.ts";
import { Label, T } from "./T.tsx";

// Setup (lab_ui.md section 3): what the reader chooses to run. Every input carries its ledger id (the scenario's default beside it) and a warning when a typed value lies outside the ledger
// range of its id; a warning does not stop the run. The form is a RunSpec in waiting (form.ts); the link holds it and never a result.

type CountField = "n" | "baySize" | "m";
const COUNTS: { field: CountField; id: string; label: "setup.n.label" | "setup.baysize.label" | "setup.m.label"; setting: string }[] = [
  { field: "n", id: "n", label: "setup.n.label", setting: "reactor_count" },
  { field: "baySize", id: "bay-size", label: "setup.baysize.label", setting: "bay_size" },
  { field: "m", id: "m", label: "setup.m.label", setting: "analyzer_count" },
];

function Count({ spec, scenario, form, onChange }: { spec: (typeof COUNTS)[number]; scenario: ScenarioInfo | undefined; form: Form; onChange: (value: string) => void }) {
  const setting = scenario?.settings.find((s) => s.name === spec.setting);
  const typed = whole(form[spec.field]);
  const range = setting && typed !== null ? rangeWarning(setting.ref, typed) : null;
  return (
    <div class="field" data-field={spec.field}>
      <T as="label" k={spec.label} for={spec.id} />
      <input id={spec.id} type="text" inputMode="numeric" autocomplete="off" value={form[spec.field]} aria-invalid={typed === null} onInput={(event) => onChange(event.currentTarget.value)} />
      {setting && (
        <Ref ids={[setting.ref]}>
          {setting.value} {setting.unit}
        </Ref>
      )}
      {typed === null && <T as="p" k="setup.warn.integer" class="warn" data-warn="integer" />}
      {setting && range && (
        <T as="p" k="setup.warn.range" class="warn" data-warn="range" parts={{ value: <Label>{typed}</Label>, id: <Label>{setting.ref}</Label>, low: <Label>{range[0]}</Label>, high: <Label>{range[1]}</Label> }} />
      )}
    </div>
  );
}

function Seeds({ ready, form, update }: { ready: ReadyInfo; form: Form; update: (patch: Partial<Form>) => void }) {
  const seeds = parseSeeds(form.seeds);
  const minimum = ready.evaluation.find((e) => e.name === "min_seeds");
  const range = seeds && minimum ? rangeWarning(minimum.ref, seeds.length) : null;
  return (
    <section id="seeds-section" aria-labelledby="seeds-heading">
      <T as="h2" k="setup.seeds.heading" id="seeds-heading" />
      <T as="p" k="setup.seeds.lead" />
      <div class="field">
        <T as="label" k="setup.seeds.count" for="seed-count" />
        <input
          id="seed-count"
          type="number"
          min="1"
          max={ready.seed_list.length}
          value={seeds ? Math.min(seeds.length, ready.seed_list.length) : ""}
          onInput={(event) => {
            const count = Number(event.currentTarget.value);
            if (Number.isInteger(count) && count >= 1) update({ seeds: ready.seed_list.slice(0, count).join(", ") });
          }}
        />
        {minimum && (
          <Ref ids={[minimum.ref]}>
            {minimum.value} {minimum.unit}
          </Ref>
        )}
      </div>
      <div class="field">
        <T as="label" k="setup.seeds.label" for="seeds" />
        <input id="seeds" type="text" autocomplete="off" spellcheck={false} value={form.seeds} aria-invalid={seeds === null} onInput={(event) => update({ seeds: event.currentTarget.value })} />
      </div>
      {seeds === null && <T as="p" k="setup.seeds.parse" class="warn" data-warn="seeds" />}
      {seeds && minimum && seeds.length < Number(minimum.value) && (
        <T as="p" k="setup.seeds.below" class="warn" data-warn="seeds-minimum" parts={{ min: <Ref ids={[minimum.ref]}>{minimum.value} {minimum.unit}</Ref> }} />
      )}
      {seeds && minimum && range && seeds.length >= Number(minimum.value) && (
        <T as="p" k="setup.warn.range" class="warn" data-warn="range" parts={{ value: <Label>{seeds.length}</Label>, id: <Label>{minimum.ref}</Label>, low: <Label>{range[0]}</Label>, high: <Label>{range[1]}</Label> }} />
      )}
    </section>
  );
}

export function Setup({ ready, form, setForm, state, link, linkEngine, onRun, onCancel }: {
  ready: ReadyInfo;
  form: Form;
  setForm: (form: Form) => void;
  state: State;
  /** The address of the page without its hash, to build the link of this setup. */
  link: string;
  /** The engine version a link was made with, when the page was opened from a link. */
  linkEngine: string | null;
  onRun: (form: Form) => void;
  onCancel: () => void;
}) {
  const update = (patch: Partial<Form>) => setForm({ ...form, ...patch });
  const scenario = ready.scenarios.find((s) => s.id === form.scenario);
  const spec = specOf(form, ready);
  const problem = state.problem && state.problem.id !== HOME_ID ? state.problem : null;
  const running = state.running !== null;
  const setScenario = (id: string) => setForm(defaultForm(ready, id, form));
  return (
    <>
      <section aria-labelledby="setup-heading">
        <T as="h1" k="setup.heading" id="setup-heading" />
        <T as="p" k="setup.lead" />
        {linkEngine !== null && linkEngine !== ready.engine_version && (
          <T as="p" k="setup.link.engine" class="notice" data-note="link-engine" parts={{ made: <Label>{linkEngine}</Label>, current: <Label>{ready.engine_version}</Label> }} />
        )}
      </section>

      <section id="scenario-section" aria-labelledby="scenario-heading">
        <div class="field">
          <T as="label" k="setup.scenario.label" for="scenario" id="scenario-heading" />
          <select id="scenario" data-label value={form.scenario} onChange={(event) => setScenario(event.currentTarget.value)}>
            {ready.scenarios.map((s) => (
              <option key={s.id} value={s.id}>
                {s.id}
              </option>
            ))}
          </select>
        </div>
        {scenario && (
          <p>
            <T k="setup.scenario.description" /> <Label engine>{scenario.description}</Label>
          </p>
        )}
      </section>

      <section id="plant" aria-labelledby="plant-heading">
        <T as="h2" k="setup.plant.heading" id="plant-heading" />
        <T as="p" k="setup.range.note" />
        {COUNTS.map((c) => (
          <Count key={c.field} spec={c} scenario={scenario} form={form} onChange={(value) => setForm(withCounts(form, ready, { [c.field]: value }))} />
        ))}
        <T as="h3" k="setup.bays.heading" />
        <T as="p" k="setup.bays.lead" parts={{ first: <Label>1</Label> }} />
        <ProfileList kind="bioreactor" picks={form.bays} profiles={ready.profiles} onPick={(i, profile) => update({ bays: form.bays.map((b, j) => (j === i ? profile : b)) })} />
        <T as="h3" k="setup.analyzers.heading" />
        <T as="p" k="setup.analyzers.lead" parts={{ first: <Label>1</Label> }} />
        <ProfileList kind="analyzer" picks={form.analyzers} profiles={ready.profiles} onPick={(i, profile) => update({ analyzers: form.analyzers.map((a, j) => (j === i ? profile : a)) })} />
        <T as="p" k="setup.lists.note" />
      </section>

      <Architectures ready={ready} form={form} update={update} />

      <section id="flags" aria-labelledby="flags-heading">
        <T as="h2" k="setup.flags.heading" id="flags-heading" />
        <T as="p" k="setup.flags.lead" />
        <FlagMatrix ready={ready} />
      </section>

      <Capture form={form} update={update} />
      <Seeds ready={ready} form={form} update={update} />

      <section id="inputs" aria-labelledby="inputs-heading">
        <T as="h2" k="setup.inputs.heading" id="inputs-heading" />
        <T as="p" k="setup.inputs.lead" />
        <ScenarioInputs scenario={scenario} />
      </section>

      <section id="run-section" aria-labelledby="run-heading">
        <T as="h2" k="setup.run.heading" id="run-heading" />
        <T as="p" k="setup.run.lead" />
        {problem && <ErrorBlock problem={problem} />}
        <button id="run" type="button" class="primary" disabled={!spec.ok || running} onClick={() => onRun(form)}>
          <T k={running ? "setup.run.running" : "setup.run.button"} />
        </button>
        {running && <RunStatus progress={state.progress} onCancel={onCancel} />}
      </section>

      <section id="link-section" aria-labelledby="link-heading">
        <T as="h2" k="setup.link.heading" id="link-heading" />
        <T as="p" k="setup.link.lead" />
        <div class="field">
          <T as="label" k="setup.link.label" for="share-link" />
          <input id="share-link" type="text" readOnly value={`${link}#/setup?${toQuery(form, ready)}`} onFocus={(event) => event.currentTarget.select()} />
        </div>
      </section>
    </>
  );
}
