import type { Key } from "../i18n/index.ts";
import type { ChallengeVariant, Request } from "../protocol.ts";
import { seedOf } from "./lineage_form.ts";
import type { ReadyInfo } from "./state.ts";

// The start form of the Challenge screen (lab_ui.md section 9): the kind of error, the scenario (the sample variant; the decision variant runs on SC8 only), a seed from the list of the
// experiment or typed, and the record to search. Which records can be shown comes from `ready.challenge_records`, so the page names no flag.

export interface ChallengeForm {
  variant: ChallengeVariant;
  scenario: string;
  seed: string;
  shown: string;
}

/** The scenario of the decision variant: reachable from the challenge only, never from the Setup picker. */
export const DECISION_SCENARIO = "sc08_ph_restandardisation";

/** The neutral integers the page offers for a variant: the seed list of experiment 1 for the sample variant, that of experiment 2 for the decision variant. */
export const seedChoices = (ready: ReadyInfo, variant: ChallengeVariant): number[] => (variant === "decision" ? ready.decision_seed_list : ready.seed_list);

/** Whether a record can be searched in a variant, and if not, the dictionary key of the reason. */
export const canShow = (ready: ReadyInfo, variant: ChallengeVariant, id: string): { ok: true } | { ok: false; reason: Key } => {
  const entry = ready.challenge_records.find((r) => r.id === id);
  if (entry?.[variant]) return { ok: true };
  if (variant === "decision") return { ok: false, reason: "challenge.shown.disabled.system_issued_id" };
  return { ok: false, reason: ready.presets.find((p) => p.id === id)?.role === "preset" ? "challenge.shown.disabled.all_prevented" : "challenge.shown.disabled.no_type" };
};

const firstShown = (ready: ReadyInfo, variant: ChallengeVariant): string => ready.presets.find((p) => canShow(ready, variant, p.id).ok)?.id ?? "";

/** The form for a variant: the first seed of its list and the first record that can be searched. */
export const formFor = (ready: ReadyInfo, variant: ChallengeVariant, scenario?: string): ChallengeForm => ({
  variant,
  scenario: variant === "decision" ? DECISION_SCENARIO : (scenario ?? ready.scenarios[0]?.id ?? ""),
  seed: String(seedChoices(ready, variant)[0] ?? 1),
  shown: firstShown(ready, variant),
});

export const defaultChallengeForm = (ready: ReadyInfo): ChallengeForm => formFor(ready, ready.challenge_variants.includes("sample") ? "sample" : (ready.challenge_variants[0] ?? "sample"));

/** The `challenge_start` request of a form, or null while the form cannot make one. */
export const challengeStart = (form: ChallengeForm, ready: ReadyInfo, id: number): Request | null => {
  const seed = seedOf(form.seed);
  if (seed === null || form.shown === "" || !canShow(ready, form.variant, form.shown).ok) return null;
  return { type: "challenge_start", id, variant: form.variant, spec: { schema_version: "1", scenario: form.scenario, settings: {}, architectures: [], seeds: [seed] }, seed, shown: form.shown };
};
