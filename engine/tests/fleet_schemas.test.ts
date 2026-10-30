import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT, listFiles, readJson } from "./support/paths.ts";
import { isValid, makeAjv } from "./support/schemas.ts";
import type { Json } from "./support/schemas.ts";

// The additive fields of ADR-0015 (spec section 4.5): `bay_profiles` and `analyzer_profiles` in the scenario schema, `bundle` in the profile schema.

const ajv = makeAjv();
const scenario = (): Json => structuredClone(readJson<Json>("tests", "fixtures", "schemas", "valid", "scenario.json"));
const profile = (): Json => structuredClone(readJson<Json>("tests", "fixtures", "schemas", "valid", "profile.json"));

describe("scenario.schema.json: the two lists", () => {
  it("Given a scenario without the lists Then it is valid as before", () => {
    expect(isValid(ajv, "scenario", scenario())).toBe(true);
  });

  it("Given both lists of profile ids Then it is valid", () => {
    expect(isValid(ajv, "scenario", { ...scenario(), bay_profiles: ["bench_manual", "micro_mini_parallel"], analyzer_profiles: ["allinone_atline", "hplc"] })).toBe(true);
  });

  it.each([[[]], [[""]], [[7]], ["bench_manual"], [null]])("Given the list %j for bay_profiles Then it is refused", (list) => {
    expect(isValid(ajv, "scenario", { ...scenario(), bay_profiles: list })).toBe(false);
  });

  it.each([[[]], [[""]], [[7]], ["hplc"], [null]])("Given the list %j for analyzer_profiles Then it is refused", (list) => {
    expect(isValid(ajv, "scenario", { ...scenario(), analyzer_profiles: list })).toBe(false);
  });
});

describe("profile.schema.json: the bundle", () => {
  it("Given a profile with a bundle id Then it is valid, and without one it is valid as before", () => {
    expect(isValid(ajv, "profile", { ...profile(), bundle: "A069" })).toBe(true);
    expect(isValid(ajv, "profile", profile())).toBe(true);
  });

  it.each(["", "69", "S069", "A69", "A0690", 69])("Given the bundle %j Then the profile is refused", (bundle) => {
    expect(isValid(ajv, "profile", { ...profile(), bundle })).toBe(false);
  });
});

describe("The bundled profile files name their bundle (A065 to A073, ADR-0012)", () => {
  const ledger = readFileSync(join(ROOT, "docs", "research", "assumptions.yaml"), "utf8");
  const entry = (id: string): string => (new RegExp(`^ {2}- id: ${id}$[\\s\\S]*?(?=^ {2}- id: |(?![\\s\\S]))`, "m").exec(ledger)?.[0] ?? "");
  // hand-typed from the ledger and spec section 4: which bundle each profile file is
  const EXPECTED: Record<string, string> = {
    "bioreactor/bench_manual": "A067", "bioreactor/micro_mini_parallel": "A065", "bioreactor/pilot": "A068",
    "analyzer/allinone_atline": "A069", "analyzer/split_cellcounter_metabolite": "A070", "analyzer/hplc": "A071",
    "staff/experienced": "A072", "staff/trainee": "A073",
  };
  const KIND_WORD: Record<string, string> = { bioreactor: "profile_bioreactor", analyzer: "profile_analyzer", staff: "profile_staff" };

  it("Given the profile folders Then every file is in the table above and carries the bundle typed there", () => {
    const files = ["bioreactor", "analyzer", "staff"].flatMap((kind) => listFiles("scenarios", "profiles", kind).map((f) => `${kind}/${f.replace(/\.json$/, "")}`));
    expect(files.sort()).toEqual(Object.keys(EXPECTED).sort());
    for (const [file, bundle] of Object.entries(EXPECTED)) expect(readJson<Json>("scenarios", "profiles", `${file}.json`).bundle, file).toBe(bundle);
  });

  it("Given each bundle id Then the ledger has it as a bundle (components) of the profile's own kind", () => {
    for (const [file, bundle] of Object.entries(EXPECTED)) {
      const text = entry(bundle);
      expect(text, bundle).toMatch(/\n {4}components: \[/);
      expect(text, bundle).toContain(`name: ${KIND_WORD[file.split("/")[0] as string]}`);
    }
  });
});
