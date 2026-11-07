import { useContext } from "preact/hooks";
import { text } from "../i18n/index.ts";
import { Label, LangContext, T } from "./T.tsx";
import type { Progress } from "./state.ts";

/** The progress of the run in flight and the button that cancels it (lab_ui.md section 4: the Worker reads a cancel between seeds). The counts are labels. */
export function RunStatus({ progress, onCancel }: { progress: Progress | null; onCancel: () => void }) {
  const lang = useContext(LangContext);
  return (
    <div class="run-status" role="status" id="run-status">
      <T as="p" k="setup.run.running" class="run-word" />
      {progress && (
        <>
          <progress aria-label={text(lang, "setup.run.running")} id="run-progress" max={progress.total} value={progress.done} />
          <T as="p" k="setup.run.progress" parts={{ done: <Label>{progress.done}</Label>, total: <Label>{progress.total}</Label> }} />
        </>
      )}
      <button id="cancel" type="button" onClick={onCancel}>
        <T k="setup.run.cancel" />
      </button>
    </div>
  );
}
