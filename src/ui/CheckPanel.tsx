import type { Key } from "../i18n/index.ts";
import type { CheckDetail, CheckState } from "../protocol.ts";
import { Label, T } from "./T.tsx";

// The browser check of ADR-0016 under ADR-0019 (lab_ui.md section 7): a chip and a banner (the status line, `CheckStatus`), and, in the fold of Home, what it covers and what was compared
// (`CheckDetails`). Shape and text carry the meaning, colour only repeats it. The word "reproduces" and the passed chip appear only in the state `identical`.

const ICON: Record<CheckState, string> = { pending: "…", identical: "✓", failed: "✕", error: "!" };

/** What the check covers (P9; audit item 20): the default scenario's open loop only, the truth log of the seeds the Worker checks and the metric cells of seed 1, each against the reference made in Node.
 *  The figures reach the text as labels (invariant 3). The seeds are those of `CHECK_SEEDS` of the engine's check (a unit test keeps them equal; the page imports no engine module). */
export const CHECK_SCOPE = { seeds: "1, 2, 3", cell_seed: "1", closed_loop: "SC8" } as const;

/** The sentence that says what the check covers, for the chip on Home (which it describes) and for the Notes screen. */
export function CheckScope({ id }: { id?: string }) {
  return (
    <T
      as="p"
      k="check.scope"
      class="check-scope"
      {...(id && { id })}
      parts={{ seeds: <Label>{CHECK_SCOPE.seeds}</Label>, cell_seed: <Label>{CHECK_SCOPE.cell_seed}</Label>, closed_loop: <Label>{CHECK_SCOPE.closed_loop}</Label> }}
    />
  );
}

/** The status line of the check on Home (P11): the chip and the banner, which stay in the page and announced whatever the state. The banner is the live region; it is not inside the fold of Home. */
export function CheckStatus({ state, detail }: { state: CheckState; detail: CheckDetail }) {
  return (
    <section id="check" class={`check check-${state}`} aria-labelledby="check-heading">
      <T as="h2" k="check.label" id="check-heading" />
      <p class="check-line">
        <span id="check-chip" class={`chip chip-${state}`} data-check-state={state} data-detail={JSON.stringify(detail)} aria-describedby="check-scope">
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
    </section>
  );
}

/** What the status line stands on (P11: in the fold of Home, "About this run"): the sentence of what the check covers, which the chip is described by, and what was compared. */
export function CheckDetails({ state, detail }: { state: CheckState; detail: CheckDetail }) {
  const parts: [Key, boolean][] = [
    ["check.part.truth", detail.truth.length > 0 && detail.truth.every((t) => t.equal)],
    ["check.part.repeats", detail.repeats_equal],
    ["check.part.cells", detail.cells_equal],
  ];
  return (
    <div class="check-more">
      <CheckScope id="check-scope" />
      {(state === "identical" || state === "failed") && (
        <div class="check-detail">
          <T as="h3" k="check.detail.heading" />
          <ul>
            {parts.map(([key, equal]) => (
              <li key={key}>
                <T k={key} /> <T as="strong" k={equal ? "check.part.equal" : "check.part.differs"} class={equal ? "equal" : "differs"} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
