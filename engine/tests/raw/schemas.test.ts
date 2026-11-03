import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT, listFiles, readJson } from "../support/paths.ts";
import { casesOf, runCase } from "../support/raw_fixtures.ts";
import { isValid, ledgerIds, makeAjv, refsOf } from "../support/schemas.ts";
import type { Json } from "../support/schemas.ts";

// Step 5 gate and Step 8 (ADR-0014 rules R1 to R3): the schemas validate every dialect and profile file, every ref and every modeled_on id resolves in the ledgers, the ids, prefixes and
// labels are vendor-neutral, every description says that the format is synthetic and modeled on public documentation, and the raw quirk key is hidden.

const ajv = makeAjv();
for (const n of ["dialect", "controller_profile", "raw_quirk_key", "canonical_record"]) ajv.addSchema(readJson<Json>("data", "schemas", `${n}.schema.json`));
const DIALECTS = listFiles("data", "scenarios", "profiles", "dialect");
const CONTROLLERS = listFiles("data", "scenarios", "profiles", "controller");
const sources = (): Set<string> => new Set([...ledgerIds()].filter((i) => i.startsWith("S")));
const BANNER = "synthetic, modeled on public documentation; not a real instrument file";

describe("dialect and controller profile files", () => {
  it("Given the directories Then there are three analyzer dialects and two controller families, with the ids of ADR-0014", () => {
    expect(DIALECTS.map((f) => f.replace(".json", ""))).toEqual(["allinone_csv", "cds_table", "counter_csv"]);
    expect(CONTROLLERS.map((f) => f.replace(".json", ""))).toEqual(["ctrl_bench", "ctrl_neutral"]);
  });
  it.each(DIALECTS)("dialect %s: valid, its file name is its id, every ref is a ledger id and every modeled_on id is a source", (f) => {
    const doc = readJson<Json>("data", "scenarios", "profiles", "dialect", f);
    expect(isValid(ajv, "dialect", doc)).toBe(true);
    expect(doc.dialect_id).toBe(f.replace(".json", ""));
    const ids = ledgerIds();
    for (const r of refsOf(doc)) expect(ids.has(r), r).toBe(true);
    for (const s of doc.modeled_on as string[]) expect(sources().has(s), s).toBe(true);
    expect(doc.banner).toBe(BANNER);
  });
  it.each(CONTROLLERS)("controller family %s: valid, its file name is its id, every ref is a ledger id and every modeled_on id is a source", (f) => {
    const doc = readJson<Json>("data", "scenarios", "profiles", "controller", f);
    expect(isValid(ajv, "controller_profile", doc)).toBe(true);
    expect(doc.profile_id).toBe(f.replace(".json", ""));
    const ids = ledgerIds();
    for (const r of refsOf(doc)) expect(ids.has(r), r).toBe(true);
    for (const s of doc.modeled_on as string[]) expect(sources().has(s), s).toBe(true);
  });
  it("Given a dialect with no banner, a wrong banner, a bare number, a ref that is no ledger id shape or a modeled_on that is not S followed by 3 digits Then the schema refuses it", () => {
    const base = readJson<Json>("data", "scenarios", "profiles", "dialect", "allinone_csv.json");
    const noBanner: Json = { ...base };
    delete noBanner.banner;
    expect(isValid(ajv, "dialect", noBanner)).toBe(false);
    expect(isValid(ajv, "dialect", { ...base, banner: "a real instrument file" })).toBe(false);
    expect(isValid(ajv, "dialect", { ...base, params: { resolution_s: 1 } })).toBe(false);
    expect(isValid(ajv, "dialect", { ...base, params: { resolution_s: { value: 1, unit: "s", ref: "X1" } } })).toBe(false);
    expect(isValid(ajv, "dialect", { ...base, modeled_on: ["A161"] })).toBe(false);
    expect(isValid(ajv, "dialect", { ...base, extra: 1 })).toBe(false);
  });
  it("Given an analyzer profile Then every stage of its route names a dialect that exists, and the dialect has a value column for each analyte of the stage", () => {
    for (const f of listFiles("data", "scenarios", "profiles", "analyzer")) {
      const doc = readJson<{ route: { dialect?: string; analytes: { id: string }[] }[] }>("data", "scenarios", "profiles", "analyzer", f);
      for (const st of doc.route) {
        expect(st.dialect, `${f} stage`).toBeDefined();
        const d = readJson<{ columns: { analyte?: string }[] }>("data", "scenarios", "profiles", "dialect", `${st.dialect}.json`);
        for (const a of st.analytes) expect(d.columns.some((c) => c.analyte === a.id), `${f} ${a.id}`).toBe(true);
      }
    }
  });
});

describe("the raw quirk key and the canonical record", () => {
  it("Given the raw quirk key schema Then it is annotated hidden: the evaluator is its only reader", () => {
    expect(readJson<Json>("data", "schemas", "raw_quirk_key.schema.json")["x-visibility"]).toBe("hidden");
  });
  it("Given a key document Then the schema accepts it and refuses an unknown property", () => {
    const doc = { schema_version: "1", engine_version: "0.1.0", scenario_id: "s", seed: 1, architecture: "c_context", capture_path: "adapter_ingest", files: [{ file_name: "f.csv", instrument: "AN-1", dialect_id: "allinone_csv", replay_of: null, rows: [{ line: 3, sample_id: "S1", intended_s: 33000, resolution_s: 1, ambiguous: false, repeat: false, quirks: [], unreadable: false }] }], entry_errors: [], opportunities: [{ purpose: "raw:RQ4", id: "S1/1/1", u: 0.5 }], not_modelled: [] };
    expect(isValid(ajv, "raw_quirk_key", doc)).toBe(true);
    expect(isValid(ajv, "raw_quirk_key", { ...doc, true_value: 1 })).toBe(false);
    expect(isValid(ajv, "raw_quirk_key", { ...doc, opportunities: [{ purpose: "other", id: "S1", u: 0.5 }] })).toBe(false);
  });
  it("Given the canonical records the parser makes from the clean files Then each validates against the canonical record schema (the envelope with raw_ref as file and line, and the payload)", () => {
    for (const [dialect, name] of [["allinone_csv", "clean"], ["counter_csv", "clean"], ["cds_table", "clean"], ["allinone_csv", "range_note"], ["allinone_csv", "reanalysis"]] as const) {
      const c = casesOf(dialect, name)[0];
      if (!c) throw new Error("no case");
      const { last } = runCase(dialect, name, c);
      expect(last.records.length).toBeGreaterThan(0);
      for (const r of last.records) expect(isValid(ajv, "canonical_record", r), JSON.stringify(r)).toBe(true);
    }
  });
  it("Given a canonical record with a state other than loaded, held or quarantined, or with no raw_ref, Then the schema refuses it", () => {
    const c = casesOf("allinone_csv", "clean")[0];
    if (!c) throw new Error("no case");
    const r = runCase("allinone_csv", "clean", c).last.records[0];
    expect(isValid(ajv, "canonical_record", { ...r, state: "rejected" })).toBe(false);
    expect(isValid(ajv, "canonical_record", { ...r, envelope: { ...r?.envelope, raw_ref: undefined } })).toBe(false);
  });
});

describe("ADR-0014 rules R1 to R3 (Step 8)", () => {
  const dirs = [["dialect", DIALECTS], ["controller", CONTROLLERS]] as const;
  it("R2: the dialect ids, controller ids and file-name prefixes are the vendor-neutral ones, and every label is a short field name", () => {
    expect(DIALECTS.map((f) => readJson<{ file: { name_prefix: string } }>("data", "scenarios", "profiles", "dialect", f).file.name_prefix)).toEqual(["analysis_export", "cds_export", "counter_export"]);
    expect(CONTROLLERS.flatMap((f) => readJson<{ logs: { file_prefix: string }[] }>("data", "scenarios", "profiles", "controller", f).logs.map((l) => l.file_prefix))).toEqual(["bench_process", "bench_user", "bench_alarms", "bench_steps", "bench_errors", "ctrl_tags", "ctrl_alarms", "ctrl_phases"]);
    for (const f of DIALECTS) {
      for (const c of readJson<{ columns: { label: string }[] }>("data", "scenarios", "profiles", "dialect", f).columns) expect(c.label.length <= 24 && c.label.split(" ").length <= 3, c.label).toBe(true);
    }
  });
  it("R3: every description says that the format is synthetic and modeled on public documentation, and none claims support, compatibility or certification", () => {
    for (const [kind, files] of dirs) {
      for (const f of files) {
        const d = readJson<{ description: string }>("data", "scenarios", "profiles", kind, f).description;
        expect(d).toMatch(/^Synthetic format modeled on public documentation, not a real instrument file/);
        expect(d).not.toMatch(/compatible with|supports (the |an |any )?(real |actual )?(instrument|analy[sz]er|controller|device)|certified|conformant|validated against|reads real/i);
      }
    }
  });
  it("R1: no fixture holds more than a short table; every fixture and dialect file is the repository's own text, and no Allotrope or AnIML file is present, only concept names", () => {
    const files = execFileSync("git", ["ls-files", "-co", "--exclude-standard"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
    expect(files.filter((f) => /\.(asm|animl)(\.json)?$/i.test(f) || /(^|\/)(allotrope|animl)[^/]*\//i.test(f))).toEqual([]);
    for (const dir of readdirSync(join(ROOT, "tests", "fixtures", "raw"))) {
      for (const f of readdirSync(join(ROOT, "tests", "fixtures", "raw", dir)).filter((x) => x.endsWith(".csv"))) {
        expect(readFileSync(join(ROOT, "tests", "fixtures", "raw", dir, f), "utf8").split("\n").length, `${dir}/${f}`).toBeLessThanOrEqual(8);
      }
    }
  });
});
