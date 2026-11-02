import type { ComponentChildren } from "preact";
import { useContext } from "preact/hooks";
import { text } from "../i18n/index.ts";
import type { RefValue } from "../protocol.ts";
import { Ref } from "./Ref.tsx";
import { Label, LangContext, T } from "./T.tsx";

// The inputs a sentence about the hold-time rule names (lab_ui.md section 23, items 2 and 3): the limit as the evaluation setting gives it (A046, value and unit) and the fixed rejection at review
// (A213). Each goes through `Ref`, so the id, its grade and the provisional chip of its sources show with it (invariant 3). The id of the review is written in the dictionary
// (`results.hold_limit.review_ids`), which is what puts it in the ledger view the page reads; the limit comes with `ready.evaluation`. A page that has no `ready` yet shows the id alone.

/** The fixed rejection of the review, with its entry. A component of its own so that the screens that call it as a function stay free of hooks. */
function ReviewRef() {
  const lang = useContext(LangContext);
  return (
    <Ref ids={text(lang, "results.hold_limit.review_ids").split(" ")}>
      <T k="results.hold_limit.review_value" />
    </Ref>
  );
}

export const holdParts = (evaluation: readonly RefValue[]): Record<string, ComponentChildren> => {
  const limit = evaluation.find((e) => e.name === "hold_limit_min");
  return {
    limit: <Ref ids={[limit?.ref ?? "A046"]}>{limit ? `${limit.value} ${limit.unit}` : <Label>A046</Label>}</Ref>,
    review: <ReviewRef />,
  };
};
