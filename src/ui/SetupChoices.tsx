import { useContext } from "preact/hooks";
import { hasKey, text } from "../i18n/index.ts";
import type { CapturePath } from "../protocol.ts";
import type { Form } from "./form.ts";
import type { ReadyInfo } from "./state.ts";
import { Label, LangContext, T } from "./T.tsx";

// The choices of Setup that are not numbers: the presets to record under, C with one flag off, and the capture path (lab_ui.md section 3). The presets and the ablations come from
// `ready.presets`, the flag names of the ablations from `ready.flags`; nothing here lists a flag or a preset by hand.

/** One option of the "C with one flag off" picker: the flag's label (or its name) and the id of the architecture. */
function AblationOption({ id, flag }: { id: string; flag: string }) {
  const lang = useContext(LangContext);
  const key = `flag.${flag}.label`;
  return (
    <option value={id} data-flag={flag}>
      {hasKey(key) ? text(lang, key) : flag} ({id})
    </option>
  );
}

export function Architectures({ ready, form, update }: { ready: ReadyInfo; form: Form; update: (patch: Partial<Form>) => void }) {
  const presets = ready.presets.filter((p) => p.role === "preset");
  const ablations = ready.presets.filter((p) => p.role === "ablation");
  const toggle = (id: string, on: boolean) => update({ archs: on ? [...form.archs, id] : form.archs.filter((a) => a !== id) });
  return (
    <section id="architectures" aria-labelledby="arch-heading">
      <T as="h2" k="setup.arch.heading" id="arch-heading" />
      <T as="p" k="setup.arch.lead" />
      <div class="checks">
        {presets.map((p) => (
          <label key={p.id} class="check-option">
            <input id={`arch-${p.id}`} type="checkbox" checked={form.archs.includes(p.id)} onChange={(event) => toggle(p.id, event.currentTarget.checked)} /> <Label>{p.id}</Label>
          </label>
        ))}
      </div>
      {ablations.length > 0 && (
        <div class="field">
          <T as="label" k="setup.arch.ablation" for="ablation" />
          <select id="ablation" value={form.ablation} data-flag-list="setup-ablation" onChange={(event) => update({ ablation: event.currentTarget.value })}>
            <T as="option" k="setup.arch.ablation.none" value="" />
            {ablations.map((a) => (
              <AblationOption key={a.id} id={a.id} flag={a.ablated_flag ?? ""} />
            ))}
          </select>
        </div>
      )}
      {form.archs.length === 0 && form.ablation === "" && <T as="p" k="setup.arch.none" class="warn" data-warn="architectures" />}
    </section>
  );
}

const CAPTURE_KEYS = { manual_transcription: "setup.capture.manual_transcription", adapter_ingest: "setup.capture.adapter_ingest" } as const;

export function Capture({ form, update }: { form: Form; update: (patch: Partial<Form>) => void }) {
  return (
    <section id="capture-path" aria-labelledby="capture-heading">
      <T as="h2" k="setup.capture.heading" id="capture-heading" />
      <div class="field">
        <T as="label" k="setup.capture.label" for="capture" />
        <select id="capture" value={form.capture} onChange={(event) => update({ capture: event.currentTarget.value as "" | CapturePath })}>
          <T as="option" k="setup.capture.default" value="" />
          {(Object.keys(CAPTURE_KEYS) as CapturePath[]).map((path) => (
            <T key={path} as="option" k={CAPTURE_KEYS[path]} value={path} />
          ))}
        </select>
      </div>
      <T as="p" k="setup.capture.note" />
      <p class="dialect">
        <T k="dialect.sentence" />
      </p>
    </section>
  );
}
