import Ajv2020 from "ajv/dist/2020.js";
import { readJson } from "./paths.ts";
import type { Json } from "./schemas.ts";

/** The S2b, S2c2, S2c3 and break-out schemas (metrics, answer key, experiment report, closed-loop report, break-out report) in one Ajv instance; `x-visibility` is a project annotation. */
export const makeEvalAjv = (): Ajv2020 => {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  ajv.addKeyword("x-visibility");
  for (const n of ["metrics", "answer_key", "experiment_report", "closed_loop_report", "breakout_report"]) ajv.addSchema(readJson<Json>("data", "schemas", `${n}.schema.json`));
  return ajv;
};

export const validates = (ajv: Ajv2020, name: "metrics" | "answer_key" | "experiment_report" | "closed_loop_report" | "breakout_report", doc: unknown): boolean => {
  const validate = ajv.getSchema(`${name}.schema.json`);
  if (!validate) throw new Error(`schema ${name} did not compile`);
  return validate(doc) === true;
};
