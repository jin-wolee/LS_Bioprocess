import type { Param } from "../../../generated/profile.schema";
import type { CapturePath } from "../../../raw/types.ts";
import { FLAG_NAMES } from "../../../record/architecture.ts";
import type { Architecture } from "../../../record/architecture.ts";
import { canonicalJson } from "../../../trace.ts";
import type { RefValue } from "./catalogue.ts";
import type { ScenarioDoc } from "./setup.ts";

// The operator actions of the plant (docs/design/plant_ui.md section 5): plain data that says what the reader did and when, in the units of the run. `parseActions` checks a list that came in a
// link (user input), `canonicalActions` puts it in the one order the scenario is built in, `applyActions` writes it into a copy of the scenario document and the record halls, and
// `resultsActions` keeps what Results over many seeds may carry. Nothing here runs the engine or reads a hidden field.

export const ACTION_KINDS = ["add_feed", "raise_alarm", "move_draw", "analyzer_down", "change_lot", "set_flag", "set_capture_path", "set_labelling"] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

export type Action =
  | { kind: "add_feed"; at: number; unit_id: string }
  | { kind: "raise_alarm"; at: number; unit_id: string }
  | { kind: "move_draw"; at: number; sample_id: string; to: number }
  | { kind: "analyzer_down"; at: number; analyzer: string; from: number; length_min: number }
  | { kind: "change_lot"; at: number; analyzer: string; effective: number }
  | { kind: "set_flag"; at: number; architecture: string; flag: string; on: boolean }
  | { kind: "set_capture_path"; at: number; path: CapturePath }
  | { kind: "set_labelling"; at: number; method: "handwritten" | "preprinted_barcode" | "issued_at_draw" };

/** Plant actions change the truth run from their instant on; lab settings change what is recorded, for the whole run (section 5.3). */
export const ACTION_CLASS: Record<ActionKind, "plant" | "lab"> = {
  add_feed: "plant", raise_alarm: "plant", move_draw: "plant", analyzer_down: "plant", change_lot: "plant", set_flag: "lab", set_capture_path: "lab", set_labelling: "lab",
};

/** The random draws an action takes for itself, as `(run_seed, <target id>, "-", 0, "operator:<kind>")` (section 5.4). None of the eight needs one, so the table is empty. */
export const ACTION_DRAWS: readonly { kind: ActionKind; purpose: string }[] = [];

/** The cap on the actions of one run: a view constant that bounds the link and the recompute, not a domain number (section 5.4). */
export const MAX_ACTIONS = 16;

/** The ledger entry of every instant an operator chooses (A228) and of the length of an analyzer window (A096). */
export const INSTANT_REF = "A228";
const WINDOW_REF = "A096";

export type RefusalReason = "past" | "unknown_target" | "outside_window" | "closed_loop" | "limit";

/** What the Worker answers for a request it will not run (section 6): `invalid_spec` for a malformed one, `refused` for a well-formed action that a rule refuses, `locked` for a run that is a challenge. */
export type PlantRefusal =
  | { ok: false; code: "invalid_spec" | "locked"; message: string }
  | { ok: false; code: "refused"; reason: RefusalReason; index: number; message: string };

/** Kinds that would act on a recorded result: the plant is open loop (ADR-0004), so they are refused as such and not as an unknown kind. */
const CLOSED_LOOP = ["hold", "release", "reject", "readjust", "stop_unit"];

type Field = "instant" | "id" | "length" | "bool" | readonly string[];
const FIELDS: Record<ActionKind, Record<string, Field>> = {
  add_feed: { at: "instant", unit_id: "id" },
  raise_alarm: { at: "instant", unit_id: "id" },
  move_draw: { at: "instant", sample_id: "id", to: "instant" },
  analyzer_down: { at: "instant", analyzer: "id", from: "instant", length_min: "length" },
  change_lot: { at: "instant", analyzer: "id", effective: "instant" },
  set_flag: { at: "instant", architecture: "id", flag: "id", on: "bool" },
  set_capture_path: { at: "instant", path: ["manual_transcription", "adapter_ingest"] },
  set_labelling: { at: "instant", method: ["handwritten", "preprinted_barcode", "issued_at_draw"] },
};

const invalid = (message: string): PlantRefusal => ({ ok: false, code: "invalid_spec", message });
const refused = (reason: RefusalReason, index: number, message: string): PlantRefusal => ({ ok: false, code: "refused", reason, index, message });

const fieldFault = (field: Field, v: unknown): string | null => {
  if (field === "instant") return Number.isInteger(v) && (v as number) >= 0 && (v as number) % 60 === 0 ? null : "must be a whole minute in integer seconds, not before the start of the run";
  if (field === "length") return Number.isInteger(v) && (v as number) >= 1 ? null : "must be a whole number of minutes, at least 1";
  if (field === "bool") return typeof v === "boolean" ? null : "must be true or false";
  if (field === "id") return typeof v === "string" && /^[\w.-]{1,64}$/.test(v) ? null : "must be an id of at most 64 letters, digits, dots, dashes and underscores";
  return typeof v === "string" && field.includes(v) ? null : `must be one of ${field.join(", ")}`;
};

/** The id an action names: its unit, sample, analyzer or architecture (and flag); empty for the two settings that name none. */
export const targetOf = (a: Action): string => {
  switch (a.kind) {
    case "add_feed": case "raise_alarm": return a.unit_id;
    case "move_draw": return a.sample_id;
    case "analyzer_down": case "change_lot": return a.analyzer;
    case "set_flag": return `${a.architecture}:${a.flag}`;
    default: return "";
  }
};

const byCode = (a: string | number, b: string | number): number => (a < b ? -1 : a > b ? 1 : 0);
const byKey = (a: readonly (string | number)[], b: readonly (string | number)[]): number => {
  for (const [i, k] of a.entries()) {
    const d = byCode(k, b[i] as string | number);
    if (d !== 0) return d;
  }
  return 0;
};

/**
 * A list of actions as a link carries it. Every entry is checked field by field; a kind outside the table is refused (`closed_loop` for an action on a recorded result, `unknown_target` for
 * anything else, a contamination placement included), as are the seventeenth action and a duplicate (same kind, target and instant). The order of the list is kept: indices refer to it.
 */
export const parseActions = (raw: unknown): { ok: true; actions: Action[] } | PlantRefusal => {
  if (!Array.isArray(raw)) return invalid("actions must be a list");
  const seen = new Set<string>();
  const actions: Action[] = [];
  for (const [i, entry] of raw.entries()) {
    if (i >= MAX_ACTIONS) return refused("limit", i, `at most ${MAX_ACTIONS} actions per run; the action number ${i + 1} is refused`);
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return invalid(`actions[${i}] must be an object`);
    const doc = entry as Record<string, unknown>;
    const kind = doc.kind;
    if (typeof kind !== "string") return invalid(`actions[${i}].kind must be a string`);
    if (!(ACTION_KINDS as readonly string[]).includes(kind)) {
      return CLOSED_LOOP.includes(kind)
        ? refused("closed_loop", i, `actions[${i}]: ${kind} acts on a recorded result, which closes the loop; the plant is open loop (ADR-0004)`)
        : refused("unknown_target", i, `actions[${i}]: ${JSON.stringify(kind)} is not an action of the plant (offered: ${ACTION_KINDS.join(", ")})`);
    }
    const fields = FIELDS[kind as ActionKind];
    for (const key of Object.keys(doc)) if (key !== "kind" && !Object.hasOwn(fields, key)) return invalid(`actions[${i}]: unknown key "${key}" for ${kind}`);
    for (const [name, field] of Object.entries(fields)) {
      const fault = fieldFault(field, doc[name]);
      if (fault) return invalid(`actions[${i}].${name} ${fault}`);
    }
    const action = structuredClone(doc) as unknown as Action;
    const key = `${action.kind}|${targetOf(action)}|${action.at}`;
    if (seen.has(key)) return refused("limit", i, `actions[${i}] repeats an action of the same kind, target and instant`);
    seen.add(key);
    actions.push(action);
  }
  return { ok: true, actions };
};

/**
 * The one order a set of actions is applied in, whatever order the reader entered them: plant actions before lab settings, then by instant, kind, target id and parameters. The names `act-1`,
 * `act-2` ... follow that order. The entry order never reaches the scenario (section 5.4).
 */
export const canonicalActions = (actions: readonly Action[]): { name: string; action: Action }[] =>
  actions
    .map((action) => ({ action, key: [ACTION_CLASS[action.kind] === "plant" ? 0 : 1, action.at, action.kind, targetOf(action), canonicalJson(action)] }))
    .sort((a, b) => byKey(a.key, b.key))
    .map(({ action }, i) => ({ name: `act-${i + 1}`, action }));

/** The kinds Results over many seeds carries: the actions that name a unit or an analyzer, which mean the same in every seed. Never an action that names a sample, and not the lab settings (Setup's own). */
export const RESULTS_KINDS: readonly ActionKind[] = ["add_feed", "raise_alarm", "analyzer_down", "change_lot"];
export const resultsActions = (actions: readonly Action[]): Action[] => actions.filter((a) => RESULTS_KINDS.includes(a.kind));

/**
 * The list of a `run` request (docs/design/lab_ui.md section 22): checked as `parseActions` checks a plant's list, then a kind Results does not carry is refused as `unknown_target` with the place of the
 * first one as entered, so that the Worker says what it will not carry and drops none silently. The bounds against the run are `checkBounds`'s.
 */
export const parseResultsActions = (raw: unknown): { ok: true; actions: Action[] } | PlantRefusal => {
  const parsed = parseActions(raw);
  if (!parsed.ok) return parsed;
  const at = parsed.actions.findIndex((a) => !RESULTS_KINDS.includes(a.kind));
  const other = parsed.actions[at];
  return other
    ? refused("unknown_target", at, `actions[${at}]: ${other.kind} is not carried by Results over many seeds; Results carries ${RESULTS_KINDS.slice(0, -1).join(", ")} and ${RESULTS_KINDS.at(-1)}, the actions that name a unit or an analyzer and mean the same in every seed`)
    : parsed;
};

/** The scenario document and the record halls an action list is applied to. */
export interface PlantBase {
  scenario: ScenarioDoc;
  /** The capture path of the run spec; `set_capture_path` replaces it (the caller turns the raw layer on for the final one). */
  capture_path: CapturePath | undefined;
  architectures: Architecture[];
}

const minutes = (seconds: number, ref = INSTANT_REF): Param => ({ value: seconds / 60, unit: "min", ref });
const windowLength = (length_min: number): Param => ({ value: length_min / 60, unit: "h", ref: WINDOW_REF });

/**
 * The inputs a run prints for its actions (docs/design/lab_ui.md section 22, item 6): each value that enters the scenario as the scenario receives it, with its ledger entry, so that it prints as an assumed
 * input like the others: the instant of a feed or an alarm, the start and the length of a window, the instant a lot change takes effect. Named by the place of the action in the canonical order.
 */
export const actionInputs = (actions: readonly Action[]): RefValue[] =>
  canonicalActions(actions).flatMap(({ name, action: a }) => {
    const input = (field: string, p: Param): RefValue => ({ name: `${name} ${a.kind} ${targetOf(a)} ${field}`, value: p.value, unit: p.unit, ref: p.ref });
    switch (a.kind) {
      case "add_feed": case "raise_alarm": return [input("at", minutes(a.at))];
      case "analyzer_down": return [input("from", minutes(a.from)), input("length", windowLength(a.length_min))];
      case "change_lot": return [input("effective", minutes(a.effective))];
      default: return [];
    }
  });

const pushed = (doc: ScenarioDoc, field: "scripted_events" | "maintenance" | "lot_changes", entry: unknown): void => {
  doc[field] = [...((doc[field] as unknown[] | undefined) ?? []), entry];
};

/** The id of a record with some flags overridden: the base id, then `_minus_<flag>` for each flag it turns off and `_plus_<flag>` for each it turns on, in the order of the flag table. */
const derivedId = (base: Architecture, flags: Architecture["flags"]): string =>
  base.id + FLAG_NAMES.filter((f) => base.flags[f] && !flags[f]).map((f) => `_minus_${f}`).join("") + FLAG_NAMES.filter((f) => !base.flags[f] && flags[f]).map((f) => `_plus_${f}`).join("");

/**
 * The plant after the actions (pure; `base` is not changed): plant actions become scripted events, maintenance windows and lot changes of the scenario document; `set_labelling` sets
 * `label_method`; `set_capture_path` sets the capture path; `set_flag` overrides a flag of the named record for the whole run and names the result by `derivedId`. Applied in the canonical order,
 * so of two switches of one thing the later instant wins. The caller has checked the list against the run (`checkBounds`); a flag or record that does not exist throws.
 */
export const applyActions = (base: PlantBase, actions: readonly Action[]): PlantBase => {
  const out: PlantBase = { scenario: structuredClone(base.scenario), capture_path: base.capture_path, architectures: structuredClone(base.architectures) };
  const doc = out.scenario;
  for (const { action: a } of canonicalActions(actions)) {
    switch (a.kind) {
      case "add_feed": pushed(doc, "scripted_events", { type: "feed", unit_id: a.unit_id, at: minutes(a.at) }); break;
      case "raise_alarm": pushed(doc, "scripted_events", { type: "alarm", unit_id: a.unit_id, at: minutes(a.at) }); break;
      case "move_draw": pushed(doc, "scripted_events", { type: "move_draw", sample_id: a.sample_id, at: minutes(a.at), to: minutes(a.to) }); break;
      case "analyzer_down": pushed(doc, "maintenance", { analyzer: a.analyzer, start: minutes(a.from), length: windowLength(a.length_min) }); break;
      case "change_lot": pushed(doc, "lot_changes", { analyzer: a.analyzer, at: minutes(a.effective) }); break;
      case "set_labelling": doc.label_method = a.method; break;
      case "set_capture_path": out.capture_path = a.path; break;
      case "set_flag": {
        const i = base.architectures.findIndex((x) => x.id === a.architecture);
        const found = out.architectures[i];
        if (!found || !(FLAG_NAMES as readonly string[]).includes(a.flag)) throw new Error(`set_flag: no record ${a.architecture} with a flag ${a.flag}`);
        out.architectures[i] = { ...found, flags: { ...found.flags, [a.flag]: a.on } };
        break;
      }
    }
  }
  // the ids are made once, against the documents the run began with, so two switches on one record give one id
  out.architectures = out.architectures.map((x, i) => ({ ...x, id: derivedId(base.architectures[i] as Architecture, x.flags) }));
  const ids = out.architectures.map((x) => x.id);
  const dup = ids.find((id, i) => ids.indexOf(id) !== i);
  if (dup) throw new Error(`set_flag: two record halls would both be ${dup}`);
  return out;
};
