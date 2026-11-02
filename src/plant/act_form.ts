import type { PlantAction, ScenePlan } from "../protocol.ts";
import { DAY } from "./clock.ts";
import { clockOf } from "./view.ts";
import type { Picked } from "./view.ts";

// What an action form sends (docs/design/plant_ui.md section 5.1, "As built in P6a"): the instant of the action and the action a form builds from its fields. Pure functions, no DOM. A form is complete
// when every field has a value that has the shape of its kind; whether the value is allowed (a past instant, a unit out of culture, a duplicate) is the Worker's, and the page checks none of it
// (one rule, one place).

export type ActionKind = PlantAction["kind"];

/** The five core actions in the bar, and the three optional ones in the overflow (section 5.2). */
export const CORE: readonly ActionKind[] = ["add_feed", "move_draw", "analyzer_down", "set_flag", "set_capture_path"];
export const OPTIONAL: readonly ActionKind[] = ["raise_alarm", "change_lot", "set_labelling"];

export const CAPTURE_PATHS = ["manual_transcription", "adapter_ingest"] as const;
export const LABEL_METHODS = ["handwritten", "preprinted_barcode", "issued_at_draw"] as const;

/** The clock reading as the `at` of an action: rounded up to the next whole minute, because scheduled events sit at whole minutes (A200). A reading already on a whole minute stays. */
export const atOf = (clock_s: number): number => Math.ceil(clock_s / 60) * 60;

/** An instant typed as a day of the run and a time of day (`HH:MM`), in seconds of the run; null when either is not there or not of that shape. */
export const instantOf = (day: string, time: string): number | null => {
  const clock = /^(\d{2}):(\d{2})$/.exec(time);
  if (!clock || !/^\d{1,6}$/.test(day)) return null;
  const [h, m] = [Number(clock[1]), Number(clock[2])];
  return h < 24 && m < 60 ? Number(day) * DAY + h * 3600 + m * 60 : null;
};

/** What the fields of a form hold, as the strings the controls give. */
export interface Fields {
  unit?: string;
  sample?: string;
  analyzer?: string;
  day?: string;
  time?: string;
  length?: string;
  architecture?: string;
  flag?: string;
  on?: string;
  path?: string;
  method?: string;
}

const whole = (text: string | undefined): number | null => (text !== undefined && /^\d{1,9}$/.test(text) ? Number(text) : null);
const said = (text: string | undefined): string | null => (text === undefined || text === "" ? null : text);

/**
 * The action of a form at the instant `at`, or null when the form is not complete. A move's new instant is a time of day on the day of the sample's planned instant (the form never offers another
 * day); the plan is read for that day and for nothing else.
 */
export const actionOf = (kind: ActionKind, f: Fields, at: number, plan: ScenePlan): PlantAction | null => {
  switch (kind) {
    case "add_feed":
    case "raise_alarm": {
      const unit_id = said(f.unit);
      return unit_id === null ? null : { kind, at, unit_id };
    }
    case "move_draw": {
      const row = plan.samples.find((s) => s.id === f.sample);
      const to = row === undefined ? null : instantOf(String(Math.floor(row.planned_s / DAY)), f.time ?? "");
      return row === undefined || to === null ? null : { kind, at, sample_id: row.id, to };
    }
    case "analyzer_down": {
      const analyzer = said(f.analyzer);
      const from = instantOf(f.day ?? "", f.time ?? "");
      const length_min = whole(f.length);
      return analyzer === null || from === null || length_min === null ? null : { kind, at, analyzer, from, length_min };
    }
    case "change_lot": {
      const analyzer = said(f.analyzer);
      const effective = instantOf(f.day ?? "", f.time ?? "");
      return analyzer === null || effective === null ? null : { kind, at, analyzer, effective };
    }
    case "set_flag": {
      const architecture = said(f.architecture);
      const flag = said(f.flag);
      const on = f.on === "true" ? true : f.on === "false" ? false : null;
      return architecture === null || flag === null || on === null ? null : { kind, at, architecture, flag, on };
    }
    case "set_capture_path": {
      const path = CAPTURE_PATHS.find((p) => p === f.path);
      return path === undefined ? null : { kind, at, path };
    }
    case "set_labelling": {
      const method = LABEL_METHODS.find((m) => m === f.method);
      return method === undefined ? null : { kind, at, method };
    }
  }
};

/** The switch a flag form offers: the opposite of what the hall has, as the plan has it ("true" when the hall's record has not arrived or has the flag off). */
export const flagOnFor = (plan: ScenePlan, architecture: string, flag: string): "true" | "false" =>
  plan.records.find((r) => r.architecture === architecture)?.flags_on.includes(flag) ? "false" : "true";

/** What a form opens with: the picked object where there is one (a reactor for a feed or an alarm, an analyzer for a window or a lot change), the clock's day and time for an instant, and no length of window. */
export const initialFields = (kind: ActionKind, { plan, flags, picked, at }: { plan: ScenePlan; flags: readonly string[]; picked: Picked | null; at: number }): Fields => {
  const unit = (picked?.kind === "reactor" ? plan.units[picked.index]?.id : undefined) ?? plan.units[0]?.id ?? "";
  const analyzer = (picked?.kind === "analyzer" ? plan.analyzers[picked.index]?.id : undefined) ?? plan.analyzers[0]?.id ?? "";
  const { day, time } = clockOf(at);
  switch (kind) {
    case "add_feed": case "raise_alarm": return { unit };
    case "move_draw": return {};
    case "analyzer_down": return { analyzer, day: String(day), time, length: "" };
    case "change_lot": return { analyzer, day: String(day), time };
    case "set_flag": {
      const architecture = plan.layout.architectures[0] ?? "";
      const flag = flags[0] ?? "";
      return { architecture, flag, on: flagOnFor(plan, architecture, flag) };
    }
    case "set_capture_path": return { path: CAPTURE_PATHS[0] };
    case "set_labelling": return { method: LABEL_METHODS[0] };
  }
};
