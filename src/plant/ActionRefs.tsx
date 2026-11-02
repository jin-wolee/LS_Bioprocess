import { useContext } from "preact/hooks";
import { text } from "../i18n/index.ts";
import type { Key } from "../i18n/index.ts";
import { Ref } from "../ui/Ref.tsx";
import { Label, LangContext, T } from "../ui/T.tsx";
import type { ActionKind } from "./act_form.ts";
import { clockOf } from "./view.ts";

// The ledger ids an action prints (docs/design/plant_ui.md section 5.2, "As built in P6a"): every instant the reader chooses with its entry A228, printed as assumed the way Setup prints an assumed input, and
// under a form the entries of what the action perturbs. The ids are written in the dictionary (`plant.act.ids.*`), which is what puts them in the ledger view the page reads.

const IDS: Partial<Record<ActionKind, Key>> = {
  add_feed: "plant.act.ids.add_feed", move_draw: "plant.act.ids.move_draw", analyzer_down: "plant.act.ids.analyzer_down",
  change_lot: "plant.act.ids.change_lot", set_capture_path: "plant.act.ids.set_capture_path", set_labelling: "plant.act.ids.set_labelling",
};
const WHAT: Partial<Record<ActionKind, Key>> = {
  add_feed: "plant.act.what.add_feed", move_draw: "plant.act.what.move_draw", analyzer_down: "plant.act.what.analyzer_down",
  change_lot: "plant.act.what.change_lot", set_capture_path: "plant.act.what.set_capture_path", set_labelling: "plant.act.what.set_labelling",
};

/** An instant as a clock reading with the ledger entry of an instant an operator chooses. */
export function Instant({ t }: { t: number }) {
  const lang = useContext(LangContext);
  const c = clockOf(t);
  return (
    <Ref ids={text(lang, "plant.act.ids.instant").split(" ")}>
      <T k="plant.clock.reading" parts={{ day: <Label>{c.day}</Label>, time: <Label>{c.time}</Label> }} />
    </Ref>
  );
}

/** The entries behind an action; the flag switch has none (its entry is the flag's decision record, which the notes screen states). */
export function ActionRefs({ kind }: { kind: ActionKind }) {
  const lang = useContext(LangContext);
  const ids = IDS[kind];
  const what = WHAT[kind];
  if (!ids || !what) return null;
  return (
    <p class="plant-act-refs" data-act-refs>
      <T k="plant.act.ids.lead" />{" "}
      <Ref ids={text(lang, ids).split(" ")}>
        <T k={what} />
      </Ref>
    </p>
  );
}
