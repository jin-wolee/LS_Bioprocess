import type { Request, RunSpec } from "../protocol.ts";
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

/** The `lineage` request of a form, or null while the form cannot make one. */
export const lineageRequest = (form: LineageForm, id: number): Request | null => {
  const seed = seedOf(form.seed);
  const architectures = architecturesOf(form);
  if (seed === null || architectures.length === 0 || (form.pick === "reader" && form.sample.trim() === "")) return null;
  const spec: RunSpec = { schema_version: "1", scenario: form.scenario, settings: {}, architectures, seeds: [seed] };
  return { type: "lineage", id, spec, seed, pick: form.pick === "rule" ? { rule: "sc3" } : { sample_id: form.sample.trim() } };
};
