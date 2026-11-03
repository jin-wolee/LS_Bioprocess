import { useContext } from "preact/hooks";
import type { Key } from "../i18n/index.ts";
import { text } from "../i18n/index.ts";
import type { ScenePlan, TruthOverlay } from "../protocol.ts";
import { Label, LangContext, T } from "../ui/T.tsx";
import { cardsOf } from "./tour.ts";
import type { TourSample } from "./tour.ts";

// The two small tables of the guided scene (docs/design/plant_ui.md section 3.5): the card of the sample in each record hall side by side (step 4), from the plan alone, and the verdict of each record for the
// three questions (step 5), from the answer of `plant_truth`. Shape and text carry the meaning (ADR-0011): a stored slot is a solid square and the word "stored", a slot the record does not store a dashed
// hollow square and "not stored"; a verdict is its word inside a solid outline (correct), a heavy one with a cross (wrong) or a dashed one (not stored). Every figure is a label.

const SLOTS = ["unit", "sampled_at", "context", "value"] as const;
const QUESTIONS = [["unit", "plant.tour.slot.unit"], ["sampled_at", "plant.tour.slot.sampled_at"], ["process_context", "plant.tour.slot.context"]] as const satisfies readonly (readonly [string, Key])[];

/** The card of the sample in each hall: a column for each hall, a row for each of the four slots of a card. The head of a column opens that hall's full record. */
export function TourCards({ plan, sample, onOpen }: { plan: ScenePlan; sample: TourSample; onOpen: (architecture: string) => void }) {
  const lang = useContext(LangContext);
  const halls = cardsOf(plan, sample.index);
  return (
    <div class="plant-table-wrap">
      <table class="plant-tour-table" data-tour-table="cards">
        <T as="caption" k="plant.tour.cards.caption" parts={{ sample: <Label>{sample.id}</Label> }} />
        <thead>
          <tr>
            <td />
            {halls.map((h) => (
              <th key={h.architecture} scope="col" data-tour-hall={h.architecture}>
                <button type="button" data-tour-open={h.architecture} disabled={h.state === "pending"} title={text(lang, "plant.tour.cards.open", { architecture: h.architecture })} onClick={() => onOpen(h.architecture)}>
                  <Label>{h.architecture}</Label>
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {SLOTS.map((name, row) => (
            <tr key={name}>
              <th scope="row">
                <T k={`plant.tour.slot.${name}` as Key} />
              </th>
              {halls.map((h) => {
                if (h.state === "pending") return <td key={h.architecture}>{row === 0 && <T k="plant.lens.pending" params={{ name: h.architecture }} />}</td>;
                const slot = h.slots.find((s) => s.name === name);
                return (
                  <td key={h.architecture} data-tour-slot={`${h.architecture}:${name}`} data-stored={slot?.stored ? "1" : "0"}>
                    <span class="plant-tour-slot" aria-hidden="true" />
                    <T k={slot?.stored ? "plant.tour.slot.stored" : "plant.tour.slot.missing"} />
                    {slot?.stored && slot.basis && (
                      <span class="plant-tour-basis" data-tour-basis={slot.basis}>
                        <T k="plant.tour.slot.basis" parts={{ basis: <Label>{slot.basis}</Label> }} />
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** What each record answered to the three questions about the sample, with the simulation's own verdict. It is the overlay: marked, and it carries the sentence of the label. */
export function TourVerdicts({ sample, view }: { sample: TourSample; view: Extract<TruthOverlay, { kind: "sample" }> | null }) {
  const lang = useContext(LangContext);
  return (
    <section class="plant-tour-verdicts" data-overlay data-tour-verdicts>
      <T as="p" k="plant.truth.label" class="plant-overlay-label" data-note="label" />
      {view === null ? (
        <T as="p" k="plant.truth.loading" class="plant-record-status" />
      ) : (
        <div class="plant-table-wrap">
          <table class="plant-tour-table" data-tour-table="verdicts" aria-label={text(lang, "plant.tour.verdicts.caption", { sample: sample.id })}>
            <thead>
              <tr>
                <td />
                {view.columns.map((c) => (
                  <th key={c.architecture} scope="col">
                    <Label>{c.architecture}</Label>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {QUESTIONS.map(([question, label]) => (
                <tr key={question}>
                  <th scope="row">
                    <T k={label} />
                  </th>
                  {view.columns.map((c) => {
                    const verdict = c.answers.find((a) => a.question === question)?.verdict;
                    return (
                      <td key={c.architecture} class={`v-${verdict ?? "none"}`} data-tour-verdict={`${c.architecture}:${question}`} data-verdict={verdict}>
                        {verdict && <T k={`lineage.verdict.${verdict}` as Key} />}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
