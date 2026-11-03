import type { AnswerKey } from "../../generated/answer_key.schema";
import type { InjectResult } from "../../inject/types.ts";
import { canonicalJson } from "../../trace.ts";

// The experiment assembly writes the error answer key from the injector's plain-data output (spec section 3, rule 2; docs/prompts/20 Step 2).
// It does not import the key module: the shape is data/schemas/answer_key.schema.json, and only engine/src/evaluate reads the file.

export const keyFile = (head: { engine_version: string; scenario_id: string; seed: number }, byArchitecture: Readonly<Record<string, Pick<InjectResult, "materialised" | "not_modelled">>>): string => {
  const doc: AnswerKey = {
    schema_version: "1",
    ...head,
    architectures: Object.fromEntries(Object.entries(byArchitecture).map(([id, r]) => [id, { errors: r.materialised, not_modelled: r.not_modelled }])),
  };
  return `${canonicalJson(doc, 2)}\n`;
};
