import type { AnswerKey } from "../generated/answer_key.schema";
import type { ErrorType } from "../inject/types.ts";

// The error answer key (spec section 3, rule 2): the record of which errors the injector materialised where. The experiment assembly writes
// it as plain data (assembly/key_file.ts) and this module, importable only inside engine/src/evaluate (eslint.config.js, zone 2), is the one
// place that reads it. A recorder, the injector and the decision arms never see it.

type Slice = AnswerKey["architectures"][string];

export interface ArchitectureKey {
  scenario_id: string;
  seed: number;
  engine_version: string;
  architecture: string;
  errors: Slice["errors"];
  not_modelled: Slice["not_modelled"];
}

const fail = (why: string): never => {
  throw new Error(`answer key: ${why}`);
};

export const parseKey = (text: string, architecture: string): ArchitectureKey => {
  const doc = JSON.parse(text) as AnswerKey;
  if (doc.schema_version !== "1") fail('schema_version must be "1"');
  const slice = doc.architectures?.[architecture];
  if (!slice) return fail(`no entry for architecture ${architecture}`);
  return { scenario_id: doc.scenario_id, seed: doc.seed, engine_version: doc.engine_version, architecture, errors: slice.errors, not_modelled: slice.not_modelled };
};

/** The realised errors of one type, by the true id of their sample. */
export const realised = (key: ArchitectureKey, type: ErrorType): string[] => key.errors.filter((e) => e.type === type).map((e) => e.sample_id);

/** The id under which the record holds the results of a physical sample: the id the label read where a label error was realised, else its own. */
export const recordedId = (key: ArchitectureKey, sampleId: string): string => {
  const wrong = key.errors.find((e) => e.type === "label_error" && e.sample_id === sampleId)?.detail.as_id;
  return typeof wrong === "string" ? wrong : sampleId;
};
