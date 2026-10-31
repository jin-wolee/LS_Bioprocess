import { evaluationSettings } from "../../../evaluate/config.ts";
import { prevented } from "../../../inject/catalogue.ts";
import { FLAG_NAMES } from "../../../record/architecture.ts";
import { ENGINE_VERSION } from "../../../trace.ts";
import { parseExperimentConfig } from "../config.ts";
import { breakoutOffer } from "./breakout.ts";
import type { BreakoutOffer } from "./breakout.ts";
import { decisionSeeds } from "./challenge_decision.ts";
import { offeredTypes } from "./challenge_plant.ts";
import { evaluationRefs, presetInfos, profileInfos } from "./catalogue.ts";
import type { PresetInfo, ProfileInfo, RefValue } from "./catalogue.ts";
import { scenarioDoc } from "./setup.ts";
import { architecturesOf } from "./spec.ts";
import type { LabData } from "./setup.ts";

// What the Worker tells the page at start-up, as plain data (docs/design/lab_ui.md section 4, `ready`): the engine version, the schema version, the flags the engine has (the page never
// types how many there are), the scenarios the lab offers with every setting, its unit and its ledger id (ADR-0012: each parameter is {value, unit, ref}), the presets and the ablations of
// C, the seed minimum and the seed list (A103, experiment 1), the evaluation inputs and the profile catalogue (spec section 4.5.6).

export type { BreakoutOffer, PresetInfo, ProfileInfo, RefValue };

export interface ScenarioInfo {
  id: string;
  description: string;
  settings: RefValue[];
  profiles: Record<string, string>;
}

export interface Ready {
  engine_version: string;
  schema_version: "1";
  flags: string[];
  min_seeds: number;
  seed_list: number[];
  scenarios: ScenarioInfo[];
  profiles: ProfileInfo[];
  presets: PresetInfo[];
  evaluation: RefValue[];
  /** The variants of the challenge this build offers: the sample variant always, the decision variant when the build bundles SC8 (`LabData.decision`). */
  challenge_variants: ("sample" | "decision")[];
  /** The seed list of experiment 2 (A103), the neutral integers the decision variant offers; empty when the variant is not offered. */
  decision_seed_list: number[];
  /** Which records each variant of the challenge can show, per preset and ablation: the sample variant needs a drawn type the record does not prevent, the decision variant a label error it does not prevent. */
  challenge_records: { id: string; sample: boolean; decision: boolean }[];
  /** The Break-out screen (lab_ui.md section 3, S3g): the cases, the seed list and the flags direction 3 needs; null when the build bundles no break-out data (the public build while a source is below main-reread). */
  breakout: BreakoutOffer | null;
}

export const scenarioInfos = (data: LabData): ScenarioInfo[] =>
  Object.keys(data.scenarios).map((id) => {
    const doc = scenarioDoc(data, id) as ReturnType<typeof scenarioDoc> & { description: string };
    return {
      id,
      description: doc.description,
      settings: Object.entries(doc.settings).map(([name, s]) => ({ name, value: s.value, unit: s.unit, ref: s.ref })),
      profiles: { ...doc.profiles },
    };
  });

export const readyOf = (data: LabData): Ready => {
  const { min_seeds } = evaluationSettings(data.evaluation);
  return {
    engine_version: ENGINE_VERSION,
    schema_version: "1",
    flags: [...FLAG_NAMES],
    min_seeds,
    seed_list: parseExperimentConfig(data.experiment, min_seeds).seeds,
    scenarios: scenarioInfos(data),
    profiles: profileInfos(data),
    presets: presetInfos(data),
    evaluation: evaluationRefs(data),
    challenge_variants: data.decision ? ["sample", "decision"] : ["sample"],
    decision_seed_list: decisionSeeds(data),
    breakout: breakoutOffer(data),
    challenge_records: architecturesOf(data).map((a) => ({ id: a.id, sample: offeredTypes(a).length > 0, decision: data.decision !== undefined && !prevented("label_error", a.flags) })),
  };
};
