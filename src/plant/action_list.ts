import type { Key } from "../i18n/index.ts";
import type { PlantAction } from "../protocol.ts";

// The reader's list of actions (docs/design/plant_ui.md sections 5.4 and 5.5, "As built in P6a"). The page imports no engine module, so the canonical order of the Worker (`canonicalActions` of
// engine/src/experiments/assembly/lab/actions.ts: plant actions before lab settings, then by instant, kind, target id and the canonical JSON of the action) is written here again;
// engine/tests/lab/action_order.test.ts compares the two for every fixture and every order of entry. Pure functions, no DOM.

/** The three kinds that change what is recorded and not what happened; they apply to the whole run (section 5.3). */
const LAB_KINDS: readonly PlantAction["kind"][] = ["set_flag", "set_capture_path", "set_labelling"];

export const isLabKind = (kind: PlantAction["kind"]): boolean => LAB_KINDS.includes(kind);
export const isLabSetting = (a: PlantAction): boolean => isLabKind(a.kind);

/** The id an action names: its unit, sample, analyzer or architecture and flag; empty for the two settings that name none. */
const targetOf = (a: PlantAction): string => {
  switch (a.kind) {
    case "add_feed": case "raise_alarm": return a.unit_id;
    case "move_draw": return a.sample_id;
    case "analyzer_down": case "change_lot": return a.analyzer;
    case "set_flag": return `${a.architecture}:${a.flag}`;
    default: return "";
  }
};

/** JSON with the keys sorted at every depth, as the engine writes it. */
const sorted = (value: unknown): unknown =>
  Array.isArray(value) ? value.map(sorted) : value !== null && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((k) => [k, sorted((value as Record<string, unknown>)[k])])) : value;
const canonicalJson = (value: unknown): string => JSON.stringify(sorted(value));

const byCode = (a: string | number, b: string | number): number => (a < b ? -1 : a > b ? 1 : 0);
const byKey = (a: readonly (string | number)[], b: readonly (string | number)[]): number => {
  for (const [i, k] of a.entries()) {
    const d = byCode(k, b[i] as string | number);
    if (d !== 0) return d;
  }
  return 0;
};

/** The list in the one order the Worker applies it in, whatever the order of entry. The list given is not changed. */
export const canonicalOrder = (actions: readonly PlantAction[]): PlantAction[] =>
  actions
    .map((action) => ({ action, key: [isLabSetting(action) ? 1 : 0, action.at, action.kind, targetOf(action), canonicalJson(action)] as const }))
    .sort((a, b) => byKey(a.key, b.key))
    .map(({ action }) => action);

/**
 * The kinds Results over many seeds carries (docs/design/lab_ui.md section 22): the plant's actions that name a unit or an analyzer, which mean the same in every seed. A copy of `RESULTS_KINDS` of the engine
 * (the page imports no engine module); engine/tests/lab/action_order.test.ts holds the two the same.
 */
export const RESULTS_KINDS: readonly PlantAction["kind"][] = ["add_feed", "raise_alarm", "analyzer_down", "change_lot"];

/** What Results carries of a list, in the order of the list. */
export const resultsKept = (list: readonly PlantAction[]): PlantAction[] => list.filter((a) => RESULTS_KINDS.includes(a.kind));

/** Why an action is not carried: a draw names the sample of one seed; a lab setting is a control of Setup's own. */
export type LeftOutWhy = "draw" | "lab_setting";

/** The actions of a list that Results does not carry, each with its reason, in the order of the list. */
export const leftOutOf = (list: readonly PlantAction[]): { action: PlantAction; why: LeftOutWhy }[] =>
  list.filter((a) => !RESULTS_KINDS.includes(a.kind)).map((action) => ({ action, why: action.kind === "move_draw" ? "draw" : "lab_setting" }));

/** The list with an action added at the end (the order of entry; the list given is not changed). */
export const plus = (list: readonly PlantAction[], action: PlantAction): PlantAction[] => [...list, action];

/** The list without the action named (the same kind, target, instant and parameters); the others keep their places. An action the list does not hold changes nothing. */
export const without = (list: readonly PlantAction[], action: PlantAction): PlantAction[] => {
  const key = canonicalJson(action);
  const at = list.findIndex((a) => canonicalJson(a) === key);
  return at < 0 ? [...list] : list.filter((_, i) => i !== at);
};

/** One piece of the sentence of an action: an instant (printed as a clock reading with its ledger entry), an id or a count (a label), or a word of the dictionary. */
export type Slot = { instant: number } | { label: string } | { word: Key };

/** The dictionary key of the sentence for an action, and the pieces that fill its placeholders. */
export interface Words {
  key: Key;
  slots: Record<string, Slot>;
}

const instant = (t: number): Slot => ({ instant: t });
const label = (text: string): Slot => ({ label: text });

export const wordsOf = (a: PlantAction): Words => {
  switch (a.kind) {
    case "add_feed": return { key: "plant.act.words.add_feed", slots: { at: instant(a.at), unit: label(a.unit_id) } };
    case "raise_alarm": return { key: "plant.act.words.raise_alarm", slots: { at: instant(a.at), unit: label(a.unit_id) } };
    case "move_draw": return { key: "plant.act.words.move_draw", slots: { at: instant(a.at), sample: label(a.sample_id), to: instant(a.to) } };
    case "analyzer_down": return { key: "plant.act.words.analyzer_down", slots: { at: instant(a.at), analyzer: label(a.analyzer), from: instant(a.from), length: label(String(a.length_min)) } };
    case "change_lot": return { key: "plant.act.words.change_lot", slots: { at: instant(a.at), analyzer: label(a.analyzer), effective: instant(a.effective) } };
    case "set_flag": return { key: "plant.act.words.set_flag", slots: { at: instant(a.at), flag: label(a.flag), architecture: label(a.architecture), state: { word: a.on ? "plant.act.state.on" : "plant.act.state.off" } } };
    case "set_capture_path": return { key: "plant.act.words.set_capture_path", slots: { at: instant(a.at), path: { word: `plant.act.path.${a.path}` } } };
    case "set_labelling": return { key: "plant.act.words.set_labelling", slots: { at: instant(a.at), method: { word: `plant.act.method.${a.method}` } } };
  }
};
