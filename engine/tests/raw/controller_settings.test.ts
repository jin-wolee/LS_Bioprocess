import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadScenario } from "../../src/scenario.ts";
import { ROOT, readJson } from "../support/paths.ts";
import { rawConfigOf } from "../support/raw_run.ts";
import { lookup, patched, rawScenario } from "../support/scenarios.ts";
import { isValid, ledgerIds, makeAjv } from "../support/schemas.ts";
import type { Json } from "../support/schemas.ts";

// Step 7: the controller side of the scenario settings. controller_log_cut (A217) says how a controller cuts its log files; bay_controllers says which controller profile each bay
// uses (spec 2.4.2: a bay uses one controller profile, and the default raw-layer scenario puts one bay on each family). Both are additive and read only with raw_layer on, like
// export_schedule and capture_path: with the layer off a scenario that sets one fails validation and the message names the setting and the layer, because a silent no-op would mislead.

describe("the controller_log_cut and bay_controllers settings", () => {
  it.each([["controller_log_cut", "per_row"], ["bay_controllers", ["ctrl_neutral", "ctrl_bench"]]] as const)("Given a scenario that sets %s with raw_layer off When it is loaded Then it fails, and the message names the setting and the layer", (name, value) => {
    const doc = patched(rawScenario("default"), { fields: { [name]: value } as Json });
    expect(() => loadScenario(doc, lookup)).toThrow(new RegExp(name));
    expect(() => loadScenario(doc, lookup)).toThrow(/raw_layer/);
  });
  it.each([["controller_log_cut", "per_row"], ["bay_controllers", ["ctrl_neutral", "ctrl_bench"]]] as const)("Given the same scenario Then the schema refuses %s too, and accepts it once raw_layer is true", (name, value) => {
    const ajv = makeAjv();
    const doc = patched(rawScenario("default"), { fields: { [name]: value } as Json });
    expect(isValid(ajv, "scenario", doc)).toBe(false);
    expect(isValid(ajv, "scenario", { ...doc, raw_layer: true })).toBe(true);
  });
  it("Given a cut other than daily and per_row, an empty list of bay controllers or a bay controller that is no text Then the schema refuses it", () => {
    const ajv = makeAjv();
    const doc = patched(rawScenario("default"), { fields: { raw_layer: true } });
    expect(isValid(ajv, "scenario", { ...doc, controller_log_cut: "weekly" })).toBe(false);
    expect(isValid(ajv, "scenario", { ...doc, bay_controllers: [] })).toBe(false);
    expect(isValid(ajv, "scenario", { ...doc, bay_controllers: [1] })).toBe(false);
  });
  it("Given a layer-on scenario Then the cut is daily (A217) unless the scenario says per_row", () => {
    expect(rawConfigOf("default", { seed: 1 }).raw?.controller_log_cut).toBe("daily");
    expect(rawConfigOf("default", { seed: 1 }, { controller_log_cut: "per_row" }).raw?.controller_log_cut).toBe("per_row");
  });
  it("Given the default raw-layer scenario Then it puts one bay on each family: the first on ctrl_neutral and the second on ctrl_bench", () => {
    expect(rawConfigOf("default", { seed: 1 }).raw?.bay_controllers).toEqual(["ctrl_neutral", "ctrl_bench"]);
  });
  it("Given a layer-on scenario that names no bay controllers Then the layer stays analyzer-side only: no controller log is emitted", () => {
    expect(rawConfigOf("default", { seed: 1 }, { bay_controllers: null }).raw?.bay_controllers).toBeUndefined();
  });
  it("Given the scenario's set points Then they are the ones of A198 (pH 7, DO 30, temperature 37)", () => {
    const raw = rawConfigOf("default", { seed: 1 }).raw;
    expect(raw?.set_points).toEqual({ pH: 7, DO: 30, temperature: 37 });
  });
});

describe("A217 in the ledger", () => {
  const ledger = readFileSync(join(ROOT, "docs", "research", "assumptions.yaml"), "utf8");
  const entry = ledger.slice(ledger.indexOf("- id: A217"));
  it("Given the ledger Then A217 is controller_log_file_cut, grade A, with no source, the daily cut as its default and the per-row delivery in its range", () => {
    expect(entry).toMatch(/^- id: A217\n {4}name: controller_log_file_cut\n {4}default: "one file per record type per day"\n {4}range: \["one file per record type per day", "each row as written"\]\n {4}unit: schedule\n {4}grade: A\n {4}sources: \[\]/);
  });
  it("Given the simulation spec Then section 2.4.2 cites A217 where it says the controller logs are cut one file per record type per day", () => {
    const spec = readFileSync(join(ROOT, "docs", "design", "simulation_spec.md"), "utf8");
    expect(spec).toMatch(/Controller logs are cut one file per record type per day \(A217;/);
  });
});

describe("the controller profile data", () => {
  const ajv = makeAjv();
  ajv.addSchema(readJson<Json>("schemas", "controller_profile.schema.json"));
  it.each(["ctrl_neutral", "ctrl_bench"])("Given %s Then every log names the role of each of its columns, one role per column", (id) => {
    const doc = readJson<{ logs: { columns: string[]; roles: string[] }[] }>("scenarios", "profiles", "controller", `${id}.json`);
    expect(isValid(ajv, "controller_profile", doc)).toBe(true);
    for (const log of doc.logs) expect(log.roles.length).toBe(log.columns.length);
  });
  it("Given the controller files (ADR-0014 R1 and R2) Then every column label is a short field name of at most three words, every modeled_on id resolves in the source ledger, and the ids are the vendor-neutral ones", () => {
    const sources = ledgerIds();
    for (const id of ["ctrl_neutral", "ctrl_bench"]) {
      const doc = readJson<{ profile_id: string; modeled_on: string[]; logs: { columns: string[]; file_prefix: string }[]; stamp: { ref: string }; phase_model: { ref: string } }>("scenarios", "profiles", "controller", `${id}.json`);
      expect(doc.profile_id).toBe(id);
      for (const l of doc.logs) for (const c of l.columns) expect(c.length <= 24 && c.split(" ").length <= 3, c).toBe(true);
      for (const s of doc.modeled_on) expect(sources.has(s), s).toBe(true);
      expect([doc.stamp.ref, doc.phase_model.ref].every((r) => sources.has(r))).toBe(true);
    }
  });
  it("Given a profile with a log whose roles are missing, or a stamp form that does not exist Then the schema refuses it", () => {
    const doc = readJson<{ logs: Record<string, unknown>[]; stamp: Record<string, unknown> }>("scenarios", "profiles", "controller", "ctrl_neutral.json");
    const noRoles: Record<string, unknown> = { ...(doc.logs[0] as Record<string, unknown>) };
    delete noRoles.roles;
    expect(isValid(ajv, "controller_profile", { ...doc, logs: [noRoles] })).toBe(false);
    expect(isValid(ajv, "controller_profile", { ...doc, stamp: { ...doc.stamp, form: "epoch" } })).toBe(false);
  });
});

// S2f F6: bay_controllers names one controller profile per bay (spec 2.4.2: "A bay uses one controller profile"). With fewer profiles than bays the units of the later bays had no
// controller and lost every process value on adapter_ingest, without an error; with more, a profile named a bay that does not exist. Bays are reactor_count in bays of bay_size,
// the layout of the process (24 reactors in bays of 12 is 2 bays; the SMALL variant, 6 reactors in one bay of 6, is 1).
describe("S2f F6: bay_controllers has exactly one entry per bay", () => {
  const SMALL_BAY = { reactor_count: 6, bay_size: 6, cohort_size: 6 };
  it("Given 2 bays and one profile When the scenario is loaded Then it fails, naming bay_controllers and both counts (1 profile, 2 bays)", () => {
    expect(() => rawConfigOf("default", { seed: 1 }, { bay_controllers: ["ctrl_neutral"] })).toThrow(/bay_controllers.*1.*2|1.*2.*bay_controllers/);
    expect(() => rawConfigOf("default", { seed: 1 }, { bay_controllers: ["ctrl_neutral"] })).toThrow(/1 controller profile.* 2 bays/);
  });
  it("Given 2 bays and three profiles Then it fails too (3 profiles, 2 bays)", () => {
    expect(() => rawConfigOf("default", { seed: 1 }, { bay_controllers: ["ctrl_neutral", "ctrl_bench", "ctrl_neutral"] })).toThrow(/3 controller profiles.* 2 bays/);
  });
  it("Given 1 bay (6 reactors in a bay of 6) and two profiles Then it fails (2 profiles, 1 bay), and with one profile the scenario loads", () => {
    expect(() => rawConfigOf("default", { seed: 1, settings: SMALL_BAY }, { bay_controllers: ["ctrl_neutral", "ctrl_bench"] })).toThrow(/2 controller profiles.* 1 bay\b/);
    expect(rawConfigOf("default", { seed: 1, settings: SMALL_BAY }, { bay_controllers: ["ctrl_bench"] }).raw?.bay_controllers).toEqual(["ctrl_bench"]);
  });
  it("Given 25 reactors in bays of 12 (a third bay with one reactor) Then three profiles are needed", () => {
    const three = { reactor_count: 25, bay_size: 12 };
    expect(() => rawConfigOf("default", { seed: 1, settings: three }, { bay_controllers: ["ctrl_neutral", "ctrl_bench"] })).toThrow(/2 controller profiles.* 3 bays/);
    expect(rawConfigOf("default", { seed: 1, settings: three }, { bay_controllers: ["ctrl_neutral", "ctrl_bench", "ctrl_neutral"] }).raw?.bay_controllers?.length).toBe(3);
  });
  it("Given one profile per bay Then the scenario loads as before", () => {
    expect(rawConfigOf("default", { seed: 1 }).raw?.bay_controllers).toEqual(["ctrl_neutral", "ctrl_bench"]);
  });
  it("Given a layer-on scenario with no bay_controllers Then there is nothing to count and it loads", () => {
    expect(rawConfigOf("default", { seed: 1 }, { bay_controllers: null }).raw?.bay_controllers).toBeUndefined();
  });
});
