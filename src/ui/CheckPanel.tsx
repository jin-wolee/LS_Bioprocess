import type { Key } from "../i18n/index.ts";
import type { CheckDetail, CheckState } from "../protocol.ts";
import { Label, T } from "./T.tsx";

// The browser check of ADR-0016 under ADR-0019 (lab_ui.md section 7): a chip and a banner. Shape and text carry the meaning, colour only repeats it. The word "reproduces" and the
// passed chip appear only in the state `identical`.

const ICON: Record<CheckState, string> = { pending: "…", identical: "✓", failed: "✕", error: "!" };

export function CheckPanel({ state, detail }: { state: CheckState; detail: CheckDetail }) {
  const parts: [Key, boolean][] = [
    ["check.part.truth", detail.truth.length > 0 && detail.truth.every((t) => t.equal)],
    ["check.part.repeats", detail.repeats_equal],
    ["check.part.cells", detail.cells_equal],
  ];
  return (
    <section id="check" class={`check check-${state}`} aria-labelledby="check-heading">
      <T as="h2" k="check.label" id="check-heading" />
      <p class="check-line">
        <span id="check-chip" class={`chip chip-${state}`} data-check-state={state} data-detail={JSON.stringify(detail)}>
          <span aria-hidden="true">{ICON[state]}</span> <T k={`check.chip.${state}`} />
        </span>
      </p>
      <p id="check-banner" role="status" class="banner">
        <T k={`check.banner.${state}`} />
        {state === "error" && detail.reason && (
          <>
            {" "}
            <code>
              <Label engine>{detail.reason}</Label>
            </code>
          </>
        )}
      </p>
      {(state === "identical" || state === "failed") && (
        <details class="check-detail">
          <T as="summary" k="check.detail.heading" />
          <ul>
            {parts.map(([key, equal]) => (
              <li key={key}>
                <T k={key} /> <T as="strong" k={equal ? "check.part.equal" : "check.part.differs"} class={equal ? "equal" : "differs"} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
