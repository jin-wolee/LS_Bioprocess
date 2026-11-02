import type { ComponentChildren } from "preact";
import type { Key } from "../i18n/index.ts";
import { T } from "../ui/T.tsx";
import type { ScenePlan } from "../protocol.ts";
import { ActionRefs, Instant } from "./ActionRefs.tsx";
import { BoardRows } from "./BoardList.tsx";
import { CAPTURE_PATHS, LABEL_METHODS, actionOf, flagOnFor, instantOf } from "./act_form.ts";
import type { ActionKind, Fields } from "./act_form.ts";
import { boardsAt } from "./board.ts";
import { isLabKind } from "./action_list.ts";
import { hallOf } from "./flags_board.ts";
import type { ActRefusal } from "./plant_state.ts";
import { Refusal } from "./Refusal.tsx";
import { clockOf } from "./view.ts";

// The small form an action opens (docs/design/plant_ui.md section 5.1, "As built in P6a"): native controls with labels, the targets the plan and `ready` have, the instant the action acts at and every
// instant the reader chooses printed as assumed (A228), the ledger entries behind the action, and the refusal, if there was one, below the buttons. The form is complete when every field has a value; whether
// a value is allowed is the Worker's.

const Field = ({ label, children }: { label: Key; children: ComponentChildren }) => (
  <label class="plant-act-field">
    <T k={label} /> {children}
  </label>
);

/** A select over ids: the value is the id. */
const Choice = ({ name, value, options, onChange, words, shown }: { name: string; value: string | undefined; options: readonly string[]; onChange: (v: string) => void; words?: (v: string) => ComponentChildren; shown?: (v: string) => string }) => (
  <select name={name} value={value ?? ""} onChange={(e) => onChange(e.currentTarget.value)}>
    {options.map((o) => (
      <option key={o} value={o} {...(!words && { "data-label": "" })}>
        {words ? words(o) : (shown?.(o) ?? o)}
      </option>
    ))}
  </select>
);

export interface FormProps {
  kind: ActionKind;
  plan: ScenePlan;
  flags: readonly string[];
  /** The records of the spec, which a `set_flag` names (the plan may show one by a derived id). */
  halls: readonly string[];
  fields: Fields;
  /** The instant the action acts at: the clock reading rounded up to the whole minute. */
  at: number;
  /** The clock reading, for the boards. */
  now: number;
  /** The board the reader asked for from the objects list, or null. */
  bay: number | null;
  busy: boolean;
  refusal: ActRefusal | null;
  set: (patch: Fields) => void;
  onSubmit: () => void;
  onClose: () => void;
  /** The words of a select option that is not an id (the capture paths, the labelling methods, on and off). */
  word: (key: string) => string;
}

/** The day and the time of day of an instant a form lets the reader choose, and the instant they make, printed with its ledger entry. */
function Chosen({ label, f, set }: { label: "plant.act.field.from" | "plant.act.field.effective"; f: Fields; set: (p: Fields) => void }) {
  const t = instantOf(f.day ?? "", f.time ?? "");
  return (
    <>
      <Field label="plant.act.field.day">
        <input type="number" name="day" min="0" step="1" value={f.day ?? ""} onInput={(e) => set({ day: e.currentTarget.value })} />
      </Field>
      <Field label="plant.act.field.time">
        <input type="time" name="time" step="60" value={f.time ?? ""} onInput={(e) => set({ time: e.currentTarget.value })} />
      </Field>
      <T as="span" k={label} class="plant-act-key" />
      <span data-act-instant>{t === null ? "–" : <Instant t={t} />}</span>
    </>
  );
}

export function ActionForm(p: FormProps) {
  const { kind, plan, flags, halls, fields: f, set } = p;
  const unitIds = plan.units.map((u) => u.id);
  const analyzerIds = plan.analyzers.map((a) => a.id);
  const complete = actionOf(kind, f, p.at, plan) !== null;
  return (
    <form
      class="plant-act-form"
      id="plant-act-form"
      data-action-form={kind}
      aria-labelledby="plant-act-legend"
      onSubmit={(e) => {
        e.preventDefault();
        if (complete && !p.busy) p.onSubmit();
      }}
    >
      <fieldset disabled={p.busy}>
        <T as="legend" k={`plant.bar.${kind}`} id="plant-act-legend" />
        <div class="plant-act-body">
          <T as="p" k={`plant.act.about.${kind}`} class="plant-act-about" />
          <div class="plant-act-grid">
            <T as="span" k="plant.act.field.at" class="plant-act-key" />
            <span data-act-at>
              <Instant t={p.at} />
            </span>
            {(kind === "add_feed" || kind === "raise_alarm") && (
              <Field label="plant.act.field.unit">
                <Choice name="unit" value={f.unit} options={unitIds} onChange={(unit) => set({ unit })} />
              </Field>
            )}
            {kind === "move_draw" && (
              <>
                <T as="span" k="plant.act.field.sample" class="plant-act-key" />
                <BoardRows
                  boards={boardsAt(plan, p.now)}
                  sample={f.sample}
                  first={p.bay}
                  onPick={(row) => set({ sample: row.id, time: clockOf(row.planned_s).time })}
                />
                <Field label="plant.act.field.to">
                  <input type="time" name="time" step="60" value={f.time ?? ""} onInput={(e) => set({ time: e.currentTarget.value })} />
                </Field>
                <T as="span" k="plant.act.same_day" class="plant-act-note" />
              </>
            )}
            {(kind === "analyzer_down" || kind === "change_lot") && (
              <>
                <Field label="plant.act.field.analyzer">
                  <Choice name="analyzer" value={f.analyzer} options={analyzerIds} onChange={(analyzer) => set({ analyzer })} />
                </Field>
                <Chosen label={kind === "analyzer_down" ? "plant.act.field.from" : "plant.act.field.effective"} f={f} set={set} />
              </>
            )}
            {kind === "analyzer_down" && (
              <Field label="plant.act.field.length">
                <input type="number" name="length" min="1" step="1" value={f.length ?? ""} onInput={(e) => set({ length: e.currentTarget.value })} />
              </Field>
            )}
            {kind === "set_flag" && (
              <>
                <Field label="plant.act.field.architecture">
                  <Choice
                    name="architecture"
                    value={f.architecture}
                    options={halls}
                    shown={(id) => hallOf(plan, halls, id)}
                    onChange={(architecture) => set({ architecture, on: flagOnFor(plan, halls, architecture, f.flag ?? "") })}
                  />
                </Field>
                <Field label="plant.act.field.flag">
                  <Choice name="flag" value={f.flag} options={flags} onChange={(flag) => set({ flag, on: flagOnFor(plan, halls, f.architecture ?? "", flag) })} />
                </Field>
                <Field label="plant.act.field.on">
                  <Choice name="on" value={f.on} options={["true", "false"]} onChange={(on) => set({ on })} words={(v) => p.word(v === "true" ? "plant.act.state.on" : "plant.act.state.off")} />
                </Field>
              </>
            )}
            {kind === "set_capture_path" && (
              <Field label="plant.act.field.path">
                <Choice name="path" value={f.path} options={CAPTURE_PATHS} onChange={(path) => set({ path })} words={(v) => p.word(`plant.act.path.${v}`)} />
              </Field>
            )}
            {kind === "set_labelling" && (
              <Field label="plant.act.field.method">
                <Choice name="method" value={f.method} options={LABEL_METHODS} onChange={(method) => set({ method })} words={(v) => p.word(`plant.act.method.${v}`)} />
              </Field>
            )}
          </div>
          {isLabKind(kind) && <T as="p" k="plant.act.whole_run" class="plant-act-note" />}
          <ActionRefs kind={kind} />
        </div>
      </fieldset>
      <div class="plant-act-buttons">
        <button type="submit" data-act-apply disabled={!complete || p.busy}>
          <T k="plant.act.form.apply" />
        </button>
        <button type="button" data-act-close onClick={p.onClose}>
          <T k="plant.act.form.close" />
        </button>
      </div>
      {p.refusal && <Refusal refusal={p.refusal} />}
    </form>
  );
}
