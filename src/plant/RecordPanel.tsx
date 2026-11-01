import { useContext, useEffect, useRef } from "preact/hooks";
import { text } from "../i18n/index.ts";
import { ErrorBlock } from "../ui/ErrorBlock.tsx";
import { RecordSvg } from "../ui/RecordSvg.tsx";
import { Label, LangContext, T } from "../ui/T.tsx";
import type { PlantRecordState } from "./plant_state.ts";

// The record panel (docs/design/plant_ui.md sections 3.3 and 6): the rows the lens architecture holds for the card that was picked, as the lineage screen draws one record (the boxes of the tables and
// the keys that join them; a field the record does not store is shown as not stored). It carries no truth column, no answer and no verdict: a record never says whether its own rows are right.
// The rows come from the Worker (`plant_record`), from the run it keeps, so nothing is recomputed. It opens with the focus on its heading; Escape or the button closes it and gives the focus back to
// whatever opened it.

export function RecordPanel({ record, onClose }: { record: PlantRecordState; onClose: () => void }) {
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
      {record.view && <RecordSvg column={record.view} sample={record.sample_id} />}
    </section>
  );
}
