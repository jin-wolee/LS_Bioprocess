import Ajv2020 from "ajv/dist/2020.js";
import { readJson } from "./paths.ts";
import type { Json } from "./schemas.ts";

/** The two S2b schemas (metrics, answer key) in one Ajv instance; `x-visibility` is a project annotation. */
export const makeEvalAjv = (): Ajv2020 => {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  ajv.addKeyword("x-visibility");
  for (const n of ["metrics", "answer_key"]) ajv.addSchema(readJson<Json>("schemas", `${n}.schema.json`));
  return ajv;
};

export const validates = (ajv: Ajv2020, name: "metrics" | "answer_key", doc: unknown): boolean => {
  const validate = ajv.getSchema(`${name}.schema.json`);
  if (!validate) throw new Error(`schema ${name} did not compile`);
  return validate(doc) === true;
};
