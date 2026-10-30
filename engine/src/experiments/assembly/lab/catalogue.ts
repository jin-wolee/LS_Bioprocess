import type { Architecture } from "../../../record/architecture.ts";
import { architecturesOf } from "./spec.ts";
import type { LabData } from "./setup.ts";

// The catalogues of `ready` (docs/design/lab_ui.md section 4, spec section 4.5.6): the profiles with the bundle their file names and the analytes they measure, the presets and the ablations
// of C with their flags, and the inputs of the evaluation. All of it is read from the bundled files, so the pickers, the flag matrix and the grade chips need no table of their own.

export interface RefValue {
  name: string;
  value: number | string;
  unit: string;
  ref: string;
}

export interface ProfileInfo {
  kind: "bioreactor" | "analyzer" | "staff";
  id: string;
  /** The bundle (A065 to A073) the profile file names; its grade comes from the ledger view. */
  bundle: string;
  description: string;
  /** Analyzer profiles only: the stages of the route with the analytes each measures. */
  stages?: { group: string; analytes: string[] }[];
}

export interface PresetInfo {
  id: string;
  role: "preset" | "ablation";
  ablated_flag: string | null;
  flags: Record<string, boolean>;
  labelling: string;
  capture_path: string | null;
}

interface ProfileDoc {
  kind: ProfileInfo["kind"];
  profile_id: string;
  bundle: string;
  description: string;
  route?: { group: string; analytes: { id: string }[] }[];
}

const KIND_ORDER: ProfileInfo["kind"][] = ["bioreactor", "analyzer", "staff"];

/** Bioreactor, then analyzer, then staff profiles; by id inside a kind. */
export const profileInfos = (data: LabData): ProfileInfo[] =>
  (data.profiles as ProfileDoc[])
    .map((p): ProfileInfo => ({
      kind: p.kind,
      id: p.profile_id,
      bundle: p.bundle,
      description: p.description,
      ...(p.route && { stages: p.route.map((s) => ({ group: s.group, analytes: s.analytes.map((a) => a.id) })) }),
    }))
    .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || (a.id < b.id ? -1 : 1));

/** The presets, then the ablations of the preset with every flag on, each with its flags (an ablation is told from a preset by `role`). */
export const presetInfos = (data: LabData): PresetInfo[] => {
  const presets = new Set(data.architectures.map((doc) => (doc as Architecture).id));
  return architecturesOf(data).map((a) => {
    const ablation = !presets.has(a.id);
    return {
      id: a.id,
      role: ablation ? "ablation" : "preset",
      // the base of an ablation has every flag on, so the flag that is off is the one ablated
      ablated_flag: ablation ? (Object.entries(a.flags).find(([, on]) => !on)?.[0] ?? null) : null,
      flags: { ...a.flags },
      labelling: a.labelling,
      capture_path: a.capture_path ?? null,
    };
  });
};

/** The inputs of the metrics (the SLA threshold, the staffed window, the hold limit and the seed minimum) as the evaluation file gives them. */
export const evaluationRefs = (data: LabData): RefValue[] =>
  Object.entries((data.evaluation as { params: Record<string, Omit<RefValue, "name">> }).params).map(([name, p]) => ({ name, value: p.value, unit: p.unit, ref: p.ref }));
