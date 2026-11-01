import type { PlantSpec, Request, RunSpec } from "../protocol.ts";
import type { ReadyInfo } from "./state.ts";

// The form of the Lineage screen (lab_ui.md section 8) and the request it makes. The run is a scenario with its own settings, one seed, and the records to compare: the presets chosen and,
// optionally, C with one flag off. The page draws no random number: the seed is typed, and its default is seed 1, the first seed of the goldens (spec section 7).

export interface LineageForm {
  scenario: string;
  seed: string;
  pick: "rule" | "reader";
  sample: string;
  archs: string[];
  ablation: string;
  /** The plant the screen was opened from (plant_ui.md section 7, "As built in P5c"): the request then is for the run the plant shows, with its actions. Dropped when the reader changes the run. */
  plant?: PlantSpec;
}

/** The scenario the pick rule of the single-sample trace is stated for. */
export const RULE_SCENARIO = "sc03_feed_in_gap";

export const defaultLineageForm = (ready: ReadyInfo): LineageForm => ({
  scenario: ready.scenarios.some((s) => s.id === RULE_SCENARIO) ? RULE_SCENARIO : (ready.scenarios[0]?.id ?? ""),
  seed: "1",
  pick: "rule",
  sample: "",
  archs: ready.presets.filter((p) => p.role === "preset").map((p) => p.id),
  ablation: "",
});

/** The seed as a non-negative whole number, or null: the Worker applies the rules of the experiment config (not date-shaped) and answers `invalid_spec` for the rest. */
export const seedOf = (text: string): number | null => (/^\d{1,15}$/.test(text.trim()) ? Number(text.trim()) : null);

export const architecturesOf = (form: LineageForm): string[] => [...form.archs, ...(form.ablation === "" ? [] : [form.ablation])];

/** The form of a screen opened from the plant: the plant's run, and the sample of the drill-down picked by the reader. The records shown are the presets among the halls and the ablation of C, if the plant has one. */
export const plantLineageForm = (ready: ReadyInfo, plant: PlantSpec, sample: string): LineageForm => {
  const role = (id: string) => ready.presets.find((p) => p.id === id)?.role;
  const halls = plant.run.architectures;
  return {
    scenario: plant.run.scenario,
    seed: String(plant.seed),
    pick: "reader",
    sample,
    archs: halls.filter((id) => role(id) === "preset"),
    ablation: halls.find((id) => role(id) === "ablation") ?? "",
    plant,
  };
};

/** A change of the form. The run the plant shows is a scenario, a seed and the halls; change any of them and the form is the reader's own (the settings, the lists and the actions of the plant are not theirs to keep). */
export const editLineage = (form: LineageForm, patch: Partial<LineageForm>): LineageForm => {
  const next = { ...form, ...patch };
  const changesRun = ["scenario", "seed", "archs", "ablation"].some((k) => k in patch);
  if (!changesRun) return next;
  const own: LineageForm = { ...next };
  delete own.plant;
  return own;
};

/** The `lineage` request of a form, or null while the form cannot make one. A form opened from the plant asks for the plant's run, with its actions (an empty list included). */
export const lineageRequest = (form: LineageForm, id: number): Request | null => {
  const seed = seedOf(form.seed);
  const architectures = architecturesOf(form);
  if (seed === null || architectures.length === 0 || (form.pick === "reader" && form.sample.trim() === "")) return null;
  const pick = form.pick === "rule" ? { rule: "sc3" as const } : { sample_id: form.sample.trim() };
  if (form.plant) return { type: "lineage", id, spec: { ...form.plant.run, seeds: [form.plant.seed] }, seed: form.plant.seed, pick, actions: form.plant.actions };
  const spec: RunSpec = { schema_version: "1", scenario: form.scenario, settings: {}, architectures, seeds: [seed] };
  return { type: "lineage", id, spec, seed, pick };
};
