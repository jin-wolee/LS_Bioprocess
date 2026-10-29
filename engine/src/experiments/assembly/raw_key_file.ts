import type { RawQuirkKey } from "../../generated/raw_quirk_key.schema";
import { canonicalJson } from "../../trace.ts";
import type { RawKeyContent } from "./raw_path.ts";

// The experiment assembly writes the raw quirk key from the emitters' plain-data output (spec section 2.4.1, rule 6). The shape is schemas/raw_quirk_key.schema.json, annotated
// hidden: only the evaluator reads the text, and the parser, the recorders and the decision arms never see it.

export const rawKeyFile = (head: { engine_version: string; scenario_id: string; seed: number; architecture: string; capture_path: RawQuirkKey["capture_path"] }, key: RawKeyContent): string => {
  const doc: RawQuirkKey = { schema_version: "1", ...head, files: key.files, entry_errors: key.entry_errors, opportunities: key.opportunities, not_modelled: key.not_modelled };
  return `${canonicalJson(doc, 2)}\n`;
};
