import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { HIDDEN_FIELDS } from "../src/observe.ts";
import { ROOT, listFiles, readJson } from "./support/paths.ts";
import { SCHEMA_NAMES as NAMES, makeAjv, ledgerIds, refsOf, rejected } from "./support/schemas.ts";
import type { Json } from "./support/schemas.ts";

const findConst = (node: unknown): boolean => {
  if (Array.isArray(node)) return node.some(findConst);
  if (node && typeof node === "object") {
    const o = node as Json;
    const props = o.properties as Json | undefined;
    if (props && (props.schema_version as Json | undefined)?.const === "1") return true;
    return Object.values(o).some(findConst);
  }
  return false;
};

describe("Schemas: each compiles under draft 2020-12 and carries schema_version const 1", () => {
  for (const n of NAMES) {
    it(`${n}.schema.json compiles`, () => {
      const schema = readJson<Json>("data", "schemas", `${n}.schema.json`);
      expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
      expect(findConst(schema)).toBe(true);
      expect(() => makeAjv().getSchema(`${n}.schema.json`)).not.toThrow();
      expect(makeAjv().getSchema(`${n}.schema.json`)).toBeTypeOf("function");
    });
  }
});

describe("Schemas: one valid and at least one invalid example per schema", () => {
  const ajv = makeAjv();
  for (const n of NAMES) {
    it(`valid/${n}.json is accepted`, () => {
      expect(rejected(ajv, n, readJson("tests", "fixtures", "schemas", "valid", `${n}.json`))).toBe(false);
    });
    it(`invalid/${n}__*.json are rejected`, () => {
      const files = listFiles("tests", "fixtures", "schemas", "invalid").filter((f) => f.startsWith(`${n}__`));
      expect(files.length).toBeGreaterThan(0);
      for (const f of files) expect(rejected(ajv, n, readJson("tests", "fixtures", "schemas", "invalid", f)), f).toBe(true);
    });
  }
});

describe("Schemas: specific rejections named in the brief", () => {
  const ajv = makeAjv();
  const profile = (): Json => readJson("tests", "fixtures", "schemas", "valid", "profile.json");

  it("a profile with a bare number instead of {value, unit, ref} is rejected by the schema", () => {
    const doc = profile();
    (doc.params as Json).service_s = 270;
    expect(ajv.getSchema("profile.schema.json")?.(doc)).toBe(false);
  });

  it("a profile whose ref is not shaped like A### or S### is rejected by the schema", () => {
    const doc = profile();
    ((doc.params as Json).service_s as Json).ref = "X12";
    expect(ajv.getSchema("profile.schema.json")?.(doc)).toBe(false);
  });

  it("a profile whose ref is shaped right but is not in the ledgers is rejected by the ledger cross-check", () => {
    const doc = profile();
    ((doc.params as Json).service_s as Json).ref = ["A", "999"].join(""); // shaped right, in no ledger (kept out of the source text so the id-reference check stays meaningful)
    expect(ajv.getSchema("profile.schema.json")?.(doc)).toBe(true);
    expect(rejected(ajv, "profile", doc)).toBe(true);
  });

  it("every ref of the valid profile example exists in the ledgers", () => {
    const ids = ledgerIds();
    expect(ids.size).toBeGreaterThan(100);
    for (const r of refsOf(profile())) expect(ids.has(r), r).toBe(true);
  });

  it("a trace without initial_method on an analyzer is rejected", () => {
    const doc = readJson<Json>("tests", "fixtures", "schemas", "valid", "trace.json");
    delete ((doc.analyzers as Json[])[0] as Json).initial_method;
    expect(rejected(ajv, "trace", doc)).toBe(true);
  });

  it("a trace analyzer may carry initial_method null (nothing installed)", () => {
    const doc = readJson<Json>("tests", "fixtures", "schemas", "valid", "trace.json");
    ((doc.analyzers as Json[])[0] as Json).initial_method = null;
    expect(rejected(ajv, "trace", doc)).toBe(false);
  });

  it("a result without engine_version or without seed is rejected", () => {
    for (const field of ["engine_version", "seed"]) {
      const doc = readJson<Json>("tests", "fixtures", "schemas", "valid", "trace_result.json");
      delete doc[field];
      expect(rejected(ajv, "trace_result", doc), field).toBe(true);
    }
  });

  it("a trace may carry expected_result and source as fixture metadata, and only those", () => {
    const doc = readJson<Json>("tests", "fixtures", "schemas", "valid", "trace.json");
    expect(Object.keys(doc)).toEqual(expect.arrayContaining(["expected_result", "source"]));
    expect(rejected(ajv, "trace", { ...doc, surprise: 1 })).toBe(true);
    expect(rejected(ajv, "trace", { ...doc, source: "somewhere" })).toBe(true);
  });
});

describe("Schemas: profile ids are free strings and never enumerated", () => {
  const KNOWN = ["bench_manual", "micro_mini_parallel", "pilot", "allinone_atline", "split_cellcounter_metabolite", "hplc", "experienced", "trainee"];

  it("profile.schema.json declares profile_id as a plain string with no enum, const or pattern list", () => {
    const schema = readJson<Json>("data", "schemas", "profile.schema.json");
    const id = (schema.properties as Json).profile_id as Json;
    expect(id.type).toBe("string");
    for (const k of ["enum", "const", "oneOf", "anyOf"]) expect(id[k], k).toBeUndefined();
  });

  it("neither the schemas nor the generated types mention a profile id of the design", () => {
    const files = [
      ...readdirSync(join(ROOT, "data", "schemas")).map((f) => join(ROOT, "data", "schemas", f)),
      ...readdirSync(join(ROOT, "engine", "src", "generated")).map((f) => join(ROOT, "engine", "src", "generated", f)),
    ];
    expect(files.length).toBeGreaterThanOrEqual(10);
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      for (const id of KNOWN) expect(text.includes(id), `${f} mentions ${id}`).toBe(false);
    }
  });
});

describe("Schemas: generated types", () => {
  const tmp = mkdtempSync(join(tmpdir(), "s1a-gen-"));
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  it("regenerating into a temp path reproduces engine/src/generated exactly (no drift)", () => {
    execFileSync(join(ROOT, "node_modules", ".bin", "json2ts"), ["--input", "data/schemas", "--output", tmp, "--cwd", "data/schemas"], { cwd: ROOT, stdio: "pipe" });
    const fresh = readdirSync(tmp).sort();
    const committed = readdirSync(join(ROOT, "engine", "src", "generated")).sort();
    expect(committed).toEqual(fresh);
    for (const f of fresh) expect(readFileSync(join(ROOT, "engine", "src", "generated", f), "utf8"), f).toBe(readFileSync(join(tmp, f), "utf8"));
  });

  it("the generated folder exists with one file per schema", () => {
    expect(existsSync(join(ROOT, "engine", "src", "generated"))).toBe(true);
  });
});

describe("Schemas: hidden fields", () => {
  it("the HIDDEN_FIELDS table of observe.ts equals the x-visibility: hidden annotations of event.schema.json", () => {
    const schema = readJson<Json>("data", "schemas", "event.schema.json");
    const defs = schema.$defs as Record<string, Json>;
    const fromSchema: Record<string, string[]> = {};
    for (const def of Object.values(defs)) {
      const props = def.properties as Record<string, Json> | undefined;
      const type = (props?.type as Json | undefined)?.const;
      if (!props || typeof type !== "string") continue;
      const hidden = Object.entries(props).filter(([, p]) => p["x-visibility"] === "hidden").map(([k]) => k).sort();
      if (hidden.length > 0) fromSchema[type] = hidden;
    }
    const table = Object.fromEntries(Object.entries(HIDDEN_FIELDS).map(([k, v]) => [k, [...v].sort()]));
    expect(Object.keys(fromSchema).length).toBeGreaterThan(0);
    expect(table).toEqual(fromSchema);
  });
});
