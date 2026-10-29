import type { Param, Profile } from "./generated/profile.schema";

// Profile loader (spec section 4, ADR-0012). Profiles are data: every number is {value, unit, ref} and the engine reads it by
// name and expected unit. Nothing here knows a profile id. The engine reads no files: the caller passes the parsed JSON.

export type { Param, Profile };
export type Params = Profile["params"];
export type ProfileKind = Profile["kind"];
/** Returns the parsed JSON of one profile; the caller decides where it comes from (a file, an import, a fetch). */
export type ProfileLookup = (kind: ProfileKind, id: string) => unknown;

const REF = /^A\d{3}$|^S\d{3}$/;

/** The value of a parameter. The unit must be the one the engine expects, so a changed unit in data fails loudly. */
export const param = (params: Params, name: string, unit: string): number => {
  const p = params[name];
  if (!p) throw new Error(`parameter ${name} is missing`);
  if (p.unit !== unit) throw new Error(`parameter ${name} has unit ${p.unit}, the engine expects ${unit}`);
  return p.value;
};

/** Reads several parameters at once: `{ key: [name, unit] }` gives `{ key: value }`. */
export const readAll = <K extends string>(params: Params, spec: Record<K, readonly [name: string, unit: string]>): Record<K, number> =>
  Object.fromEntries(Object.entries<readonly [string, string]>(spec).map(([key, [name, unit]]) => [key, param(params, name, unit)])) as Record<K, number>;

const isParam = (p: unknown): p is Param => {
  const o = p as Record<string, unknown> | null;
  return !!o && typeof o === "object" && typeof o.value === "number" && Number.isFinite(o.value) && typeof o.unit === "string" && o.unit !== "" && typeof o.ref === "string" && REF.test(o.ref);
};

/** Checks that every entry of a map is {value, unit, ref}; a bare number or a ref that is not A### or S### is an input error. */
export const checkParams = (params: unknown, what: string): Params => {
  if (!params || typeof params !== "object") throw new Error(`${what}: params must be an object`);
  for (const [name, p] of Object.entries(params)) if (!isParam(p)) throw new Error(`${what}: ${name} is not {value, unit, ref} with a ledger ref shape`);
  return params as Params;
};

export const loadProfile = (raw: unknown, kind: ProfileKind): Profile => {
  const doc = raw as Profile | null;
  if (!doc || typeof doc !== "object" || doc.schema_version !== "1") throw new Error(`profile (${kind}): schema_version 1 expected`);
  if (doc.kind !== kind) throw new Error(`profile ${String(doc.profile_id)} is a ${String(doc.kind)} profile, a ${kind} profile is needed`);
  if (typeof doc.profile_id !== "string" || doc.profile_id === "") throw new Error(`profile (${kind}): profile_id missing`);
  checkParams(doc.params, `profile ${doc.profile_id}`);
  if (kind === "analyzer") {
    if (!doc.route || doc.route.length === 0) throw new Error(`profile ${doc.profile_id}: an analyzer profile needs a route`);
    const needs = (name: string | undefined): void => {
      if (name !== undefined && !(name in doc.params)) throw new Error(`profile ${doc.profile_id}: route names ${name}, which is not a param`);
    };
    for (const stage of doc.route) {
      needs(stage.service);
      needs(stage.transfer);
      stage.dilution_factors?.forEach(needs);
      for (const a of stage.analytes) {
        needs(a.noise);
        needs(a.limit);
      }
    }
  }
  return doc;
};
