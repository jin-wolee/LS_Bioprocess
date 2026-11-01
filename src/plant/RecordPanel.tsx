import { useContext, useEffect, useRef } from "preact/hooks";
import { text } from "../i18n/index.ts";
import { ErrorBlock } from "../ui/ErrorBlock.tsx";
import { LineageTruth, RealisedErrors } from "../ui/LineageView.tsx";
import { RecordSvg } from "../ui/RecordSvg.tsx";
import { Label, LangContext, T } from "../ui/T.tsx";
import type { Drill } from "./drill.ts";
import { DrillLink, DrillLinks } from "./DrillLinks.tsx";
import type { PlantRecordState, PlantTruthState } from "./plant_state.ts";

// The record panel (docs/design/plant_ui.md sections 3.3 and 6): the rows the lens architecture holds for the card that was picked, as the lineage screen draws one record (the boxes of the tables and
// the keys that join them; a field the record does not store is shown as not stored). It carries no truth column, no answer and no verdict: a record never says whether its own rows are right.
// The rows come from the Worker (`plant_record`), from the run it keeps, so nothing is recomputed. It opens with the focus on its heading; Escape or the button closes it and gives the focus back to
// whatever opened it.
//
// P5b: with the truth overlay on, the panel shows beside the record what the simulation knows of the sample (section 3.3, "As built in P5b"): the truth column and the three answers of this record
// with their verdicts and the errors the injector materialised on the sample in it, drawn by the lineage screen's own parts. Every part of it is marked `data-overlay` and carries the label. With the
// overlay off the panel is as it was.
//
// P5c: at its foot, the links to Lineage on the sample and to Results for this architecture (docs/design/plant_ui.md section 7).

export function RecordPanel({ record, drill, onClose, truth }: { record: PlantRecordState; drill: Drill; onClose: () => void; truth: PlantTruthState }) {
  const lang = useContext(LangContext);
  const root = useRef<HTMLElement>(null);

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    root.current?.focus();
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, [record.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape" || e.ctrlKey || e.metaKey || e.altKey) return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const state = record.problem ? "failed" : record.view ? "ready" : "loading";
  // the overlay's answer for this very sample, and the column of the architecture this panel reads
  const slot = truth.on && truth.sample?.sample_id === record.sample_id ? truth.sample : null;
  const overlay = slot?.view ?? null;
  const column = overlay?.columns.find((c) => c.architecture === record.architecture) ?? null;
  return (
    <section
      ref={root}
      class="plant-record"
      tabIndex={-1}
      role="region"
      aria-labelledby="plant-record-heading"
      data-plant-record={state}
      data-record-architecture={record.architecture}
      data-record-sample={record.sample_id}
      data-record-truth={truth.on ? "on" : "off"}
    >
      <div class="plant-record-head">
        <T as="h2" k="plant.record.heading" id="plant-record-heading" parts={{ sample: <Label>{record.sample_id}</Label>, architecture: <Label>{record.architecture}</Label> }} />
        <button type="button" class="plant-record-close" data-record="close" aria-label={text(lang, "plant.record.close")} title={text(lang, "plant.record.close")} onClick={onClose}>
          ×
        </button>
      </div>
      <T as="p" k="plant.record.lead" class="plant-record-lead" />
      {state === "loading" && <T as="p" k="plant.record.loading" class="plant-record-status" />}
      {record.problem && <ErrorBlock problem={{ id: record.id, code: record.problem.code, message: record.problem.message }} />}
      <div class="plant-record-body" data-truth-layout={truth.on ? "beside" : "single"}>
      {truth.on && (
        <section class="plant-truth-block" data-overlay data-truth-block aria-labelledby="plant-truth-heading">
          <T as="h3" k="plant.truth.heading" id="plant-truth-heading" parts={{ sample: <Label>{record.sample_id}</Label> }} />
          <T as="p" k="plant.truth.label" class="plant-overlay-label" data-note="label" />
          {slot?.problem ? <T as="p" k="plant.truth.locked" class="warn" data-truth-locked /> : null}
          {!overlay && !slot?.problem && <T as="p" k="plant.truth.loading" class="plant-record-status" />}
          {overlay && (
            <>
              <T as="p" k="plant.truth.lead" class="plant-record-lead" />
              <LineageTruth view={overlay} />
              {column && <RealisedErrors column={column} />}
            </>
          )}
        </section>
      )}
      {record.view && <RecordSvg column={{ ...record.view, ...(column && { answers: column.answers }) }} sample={record.sample_id} {...(overlay && column && { truth: overlay.truth })} />}
      </div>
      <DrillLinks>
        <DrillLink name="lineage" href={drill.lineage(record.sample_id)} k="plant.drill.lineage" parts={{ sample: <Label>{record.sample_id}</Label> }} />
        <DrillLink name="results" href={drill.results([record.architecture])} k="plant.drill.results" />
      </DrillLinks>
    </section>
  );
}
