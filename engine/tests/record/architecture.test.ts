import { readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { ABLATIONS, FLAG_NAMES, ablate, parseArchitecture } from "../../src/record/architecture.ts";
import { ROOT, listFiles, readJson } from "../support/paths.ts";
import type { Json } from "../support/schemas.ts";

// S2a Step 1: the architecture schema, the three presets as data, and the ablation configs. Expected values are typed by hand from
// spec section 5 and ADR-0005, ADR-0017, ADR-0020 (the flag table, the preset table, "no eleventh flag"; the ninth and tenth flags are the lot and equipment links of the break-out extension).

const schema = readJson<Json>("data", "schemas", "architecture.schema.json");
const validate = new Ajv2020({ strict: true, allErrors: true }).compile(schema);
const preset = (name: string): Json => readJson<Json>("data", "scenarios", "architectures", `${name}.json`);
const HAND_FLAGS = ["system_issued_id", "two_clocks", "available_at", "instrument_state_snapshot", "append_only_versions", "write_time_keys", "ingest_idempotency", "audit_trail", "material_lot_links", "equipment_links"];
const none = (): Record<string, boolean> => Object.fromEntries(HAND_FLAGS.map((f) => [f, false]));
const only = (...on: string[]): Record<string, boolean> => ({ ...none(), ...Object.fromEntries(on.map((f) => [f, true])) });

describe("architecture.schema.json", () => {
  it("is a draft 2020-12 schema with schema_version const 1 and exactly the ten flags of spec section 5", () => {
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    const props = schema.properties as Record<string, Json>;
    expect((props.schema_version as Json).const).toBe("1");
    const flags = props.flags as Json;
    expect(Object.keys(flags.properties as Json).sort()).toEqual([...HAND_FLAGS].sort());
    expect([...(flags.required as string[])].sort()).toEqual([...HAND_FLAGS].sort());
    expect(flags.additionalProperties).toBe(false);
  });

  it("names the same ten flags as the flag table of the spec (read from docs/design/simulation_spec.md, not typed here)", () => {
    const spec = readFileSync(join(ROOT, "docs", "design", "simulation_spec.md"), "utf8");
    const section = spec.slice(spec.indexOf("## 5. Data architecture"), spec.indexOf("Planned time is separate"));
    const fromSpec = [...section.matchAll(/^\| `([a-z_]+)` \|/gm)].map((m) => m[1]);
    expect(fromSpec).toEqual(HAND_FLAGS);
    expect([...FLAG_NAMES]).toEqual(HAND_FLAGS);
  });

  it("labelling is one of the three methods of spec section 2.2 and source_of_record is optional", () => {
    const props = schema.properties as Record<string, Json>;
    expect(props.labelling?.enum).toEqual(["handwritten", "preprinted_barcode", "issued_at_draw"]);
    expect(schema.required).toEqual(["schema_version", "id", "flags", "labelling"]);
  });
});

describe("presets A, B and C are data (spec section 5, ADR-0005)", () => {
  it("data/scenarios/architectures holds exactly the three preset files", () => {
    expect(listFiles("data", "scenarios", "architectures")).toEqual(["a_manual.json", "b_lims_lite.json", "c_context.json"]);
  });

  it.each(["a_manual", "b_lims_lite", "c_context"])("%s validates against the schema and carries its own id", (name) => {
    expect(validate(preset(name)), JSON.stringify(validate.errors)).toBe(true);
    expect(preset(name).id).toBe(name);
  });

  it("A has no flag on and a handwritten label", () => {
    expect(preset("a_manual").flags).toEqual(none());
    expect(preset("a_manual").labelling).toBe("handwritten");
  });

  it("B has system_issued_id, ingest_idempotency, audit_trail and equipment_links on, material_lot_links off, and a pre-printed barcode (ADR-0020: B logs the equipment a batch used; ADR-0017: not the lots)", () => {
    expect(preset("b_lims_lite").flags).toEqual(only("system_issued_id", "ingest_idempotency", "audit_trail", "equipment_links"));
    expect((preset("b_lims_lite").flags as Json).material_lot_links).toBe(false);
    expect(preset("b_lims_lite").labelling).toBe("preprinted_barcode");
  });

  it("C has all ten flags on and a label issued at the draw", () => {
    expect(preset("c_context").flags).toEqual(only(...HAND_FLAGS));
    expect(preset("c_context").labelling).toBe("issued_at_draw");
  });

  it("parseArchitecture returns each preset unchanged", () => {
    for (const name of ["a_manual", "b_lims_lite", "c_context"]) expect(parseArchitecture(preset(name))).toEqual(preset(name));
  });
});

describe("rejections: the schema and parseArchitecture agree", () => {
  const c = (): Json => structuredClone(preset("c_context"));
  const bad: [string, (d: Json) => void, RegExp][] = [
    ["an eleventh flag", (d) => { (d.flags as Json).capture_flag = true; }, /capture_flag/],
    ["a missing ninth flag", (d) => { delete (d.flags as Json).material_lot_links; }, /material_lot_links/],
    ["a missing tenth flag", (d) => { delete (d.flags as Json).equipment_links; }, /equipment_links/],
    ["a tenth flag that is not a boolean", (d) => { (d.flags as Json).equipment_links = 1; }, /equipment_links/],
    ["a missing flag", (d) => { delete (d.flags as Json).audit_trail; }, /audit_trail/],
    ["a flag that is not a boolean", (d) => { (d.flags as Json).two_clocks = "yes"; }, /two_clocks/],
    ["an unknown labelling method", (d) => { d.labelling = "typed"; }, /labelling/],
    ["a missing id", (d) => { delete d.id; }, /id/],
    ["an empty id", (d) => { d.id = ""; }, /id/],
    ["a wrong schema_version", (d) => { d.schema_version = "2"; }, /schema_version/],
    ["an unknown top-level key", (d) => { d.surprise = 1; }, /surprise/],
    ["an unknown source_of_record", (d) => { d.source_of_record = "spreadsheet"; }, /source_of_record/],
  ];
  it.each(bad)("%s is rejected by the schema", (_name, mutate) => {
    const doc = c();
    mutate(doc);
    expect(validate(doc)).toBe(false);
  });
  it.each(bad)("%s is refused by parseArchitecture, and the message names the field", (_name, mutate, field) => {
    const doc = c();
    mutate(doc);
    expect(() => parseArchitecture(doc)).toThrow(field);
  });

  it("the message that said there was no ninth flag is replaced: an unknown flag is not one of the ten, and neither the message nor the schema still says there is no ninth flag or that there are eight", () => {
    const doc = c();
    (doc.flags as Json).capture_flag = true;
    expect(() => parseArchitecture(doc)).toThrow(/not one of the ten flags \(there is no eleventh\)/);
    try {
      parseArchitecture(doc);
    } catch (e) {
      expect((e as Error).message).not.toMatch(/no ninth|eight/);
    }
    expect(String(schema.description)).toMatch(/ten independent feature flags/);
    expect(String(schema.description)).not.toMatch(/no ninth|eight independent/);
  });

  it("source_of_record is optional and accepts the two systems of record of spec section 5", () => {
    for (const v of ["lims", "mes_ebr"]) {
      const doc = c();
      doc.source_of_record = v;
      expect(validate(doc)).toBe(true);
      expect(parseArchitecture(doc).source_of_record).toBe(v);
    }
    expect("source_of_record" in parseArchitecture(c())).toBe(false);
  });
});

describe("ablation: C minus one flag, for each of the ten flags", () => {
  const cfg = parseArchitecture(preset("c_context"));

  it("gives ten configs, one per flag, in the order of the flag table", () => {
    const list = ABLATIONS(cfg);
    expect(list.length).toBe(10);
    expect(list.map((a) => a.flag)).toEqual(HAND_FLAGS);
  });

  it.each(HAND_FLAGS)("C minus %s differs from C in that flag only", (flag) => {
    const a = ablate(cfg, flag as (typeof FLAG_NAMES)[number]);
    expect(a.flags).toEqual({ ...only(...HAND_FLAGS), [flag]: false });
    expect(a.id).toBe(`c_context_minus_${flag}`);
    expect(a.labelling).toBe(cfg.labelling);
    expect(cfg.flags[flag as (typeof FLAG_NAMES)[number]]).toBe(true); // the input is not modified
  });

  it("ablating a flag that C does not have on is refused (an ablation removes exactly one flag)", () => {
    expect(() => ablate(parseArchitecture(preset("a_manual")), "two_clocks")).toThrow(/two_clocks/);
  });
});
