import { readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { ROOT, readJson } from "./paths.ts";

export type Json = Record<string, unknown>;

export const SCHEMA_NAMES = ["scenario", "profile", "event", "trace", "trace_result"] as const;

/** All five schemas in one Ajv instance (trace refers to trace_result). `x-visibility` is the project's own annotation. */
export const makeAjv = (): Ajv2020 => {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  ajv.addKeyword("x-visibility");
  for (const n of SCHEMA_NAMES) ajv.addSchema(readJson<Json>("schemas", `${n}.schema.json`));
  return ajv;
};

/** Ids defined in the ledgers (ids only; values are never read here). */
export const ledgerIds = (): Set<string> => {
  const ids = new Set<string>();
  for (const f of ["assumptions.yaml", "sources.yaml"]) {
    for (const m of readFileSync(join(ROOT, "docs", "research", f), "utf8").matchAll(/^\s*- id: ([AS]\d{3})\s*$/gm)) ids.add(m[1] as string);
  }
  return ids;
};

/** Every `ref` string found anywhere in a document. */
export const refsOf = (node: unknown, out: string[] = []): string[] => {
  if (Array.isArray(node)) node.forEach((n) => refsOf(n, out));
  else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      if (k === "ref" && typeof v === "string") out.push(v);
      else refsOf(v, out);
    }
  }
  return out;
};

/** A document is rejected when the schema fails or, for profiles, a ref is not a ledger id (prompts/10 Step 2). */
export const rejected = (ajv: Ajv2020, name: string, doc: unknown): boolean => {
  const validate = ajv.getSchema(`${name}.schema.json`);
  if (!validate) throw new Error(`schema ${name} did not compile`);
  if (!validate(doc)) return true;
  if (name === "profile") {
    const ids = ledgerIds();
    return refsOf(doc).some((r) => !ids.has(r));
  }
  return false;
};

export const isValid = (ajv: Ajv2020, name: string, doc: unknown): boolean => {
  const validate = ajv.getSchema(`${name}.schema.json`);
  if (!validate) throw new Error(`schema ${name} did not compile`);
  return validate(doc) === true;
};
