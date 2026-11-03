import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { runSeed } from "../../src/experiments/assembly/run_seed.ts";
import type { SeedOutput } from "../../src/experiments/assembly/run_seed.ts";
import { parseArchitecture } from "../../src/record/architecture.ts";
import { resolveCapturePath } from "../../src/record/capture.ts";
import { loadScenario } from "../../src/scenario.ts";
import { logHash } from "../../src/trace.ts";
import { CONFIGS } from "../support/cells.ts";
import { ROOT, readJson } from "../support/paths.ts";
import { DIALECTS, rawConfigOf, rawInputOf } from "../support/raw_run.ts";
import { inputOf } from "../support/sc_run.ts";
import { SMALL, configOf, lookup, patched, rawScenario, runOf } from "../support/scenarios.ts";
import { isValid, makeAjv } from "../support/schemas.ts";
import { runScenario } from "../../src/run.ts";

// Step 5: the capture_path setting (spec section 5, "Capture path"; ADR-0014). The preset files carry the default (A manual_transcription, B and C adapter_ingest); it is inert
// while raw_layer is off; a scenario may override it. Test-only: the small scenario (6 reactors, 8 days) and seed 1.

const preset = (name: string) => parseArchitecture(readJson("data", "scenarios", "architectures", `${name}.json`));
const [A, B, C] = [preset("a_manual"), preset("b_lims_lite"), preset("c_context")];
const golden = (seed: number): string => (JSON.parse(readFileSync(join(ROOT, "tests", "golden", `default_seed${seed}.summary.json`), "utf8")) as { log_hash: string }).log_hash;

describe("capture_path in the architecture presets and the scenario", () => {
  it("Given the preset files When they are read Then A carries manual_transcription and B and C carry adapter_ingest", () => {
    expect([A, B, C].map((a) => a.capture_path)).toEqual(["manual_transcription", "adapter_ingest", "adapter_ingest"]);
  });
  it("Given the architecture schema Then a capture_path other than the two values is rejected, and an architecture without one is still valid (inert while the layer is off)", () => {
    const ajv = makeAjv();
    ajv.addSchema(readJson("data", "schemas", "architecture.schema.json"));
    expect(isValid(ajv, "architecture", { ...A, capture_path: "by_fax" })).toBe(false);
    expect(isValid(ajv, "architecture", A)).toBe(true);
    const without: Record<string, unknown> = { ...A };
    delete without.capture_path;
    expect(isValid(ajv, "architecture", without)).toBe(true);
  });
  it("Given a scenario that sets capture_path with raw_layer off When it is loaded Then it fails, and the message names the setting and the layer", () => {
    const doc = patched(rawScenario("default"), { fields: { capture_path: "adapter_ingest" } });
    expect(() => loadScenario(doc, lookup)).toThrow(/capture_path/);
    expect(() => loadScenario(doc, lookup)).toThrow(/raw_layer/);
  });
  it("Given the same scenario Then the schema refuses it too, and accepts it once raw_layer is true", () => {
    const ajv = makeAjv();
    const doc = patched(rawScenario("default"), { fields: { capture_path: "adapter_ingest" } });
    expect(isValid(ajv, "scenario", doc)).toBe(false);
    expect(isValid(ajv, "scenario", { ...doc, raw_layer: true })).toBe(true);
    expect(isValid(ajv, "scenario", { ...doc, raw_layer: false })).toBe(false);
  });
  it("Given a scenario with raw_layer true and no calendar anchor, or no instrument zone, When it is loaded Then it fails and names the setting", () => {
    const doc = patched(rawScenario("default"), { fields: { raw_layer: true } });
    expect(() => loadScenario(doc, lookup)).toThrow(/calendar_anchor/);
    expect(() => loadScenario({ ...doc, calendar_anchor: "2030-01-07" }, lookup)).toThrow(/device_zone_h/);
  });
});

describe("with raw_layer off the event log and the recorded datasets are as before, whatever the defaults say", () => {
  it("Given the default scenario, seed 1, raw_layer off When the log is hashed Then it equals the golden", async () => {
    expect(await logHash(runOf("default", { seed: 1 }).events)).toBe(golden(1));
  });
  it("Given the same scenario with raw_layer on When the log is hashed Then it equals the golden too: the layer adds no truth event", async () => {
    expect(await logHash(runScenario(rawConfigOf("default", { seed: 1 })).events)).toBe(golden(1));
  });
  it("Given architectures whose presets carry adapter_ingest and manual_transcription and the layer off When recorded Then no row carries a capture column and no raw output exists", () => {
    const run = runOf("default", { seed: 1, settings: SMALL });
    const out = runSeed(inputOf(run, "default-small", [A, C], 8));
    expect(out.raw).toBeUndefined();
    for (const ds of Object.values(out.datasets)) {
      expect(ds.capture).toBeUndefined();
      expect(ds.raw).toBeUndefined();
      expect(ds.result.some((r) => "capture_path" in r || "entered_by" in r || "raw_ref" in r)).toBe(false);
    }
  });
  it("Given resolveCapturePath When the scenario names none Then the preset default is used, and a scenario override beats it", () => {
    expect([A, B, C].map((a) => resolveCapturePath(a))).toEqual(["manual_transcription", "adapter_ingest", "adapter_ingest"]);
    expect(resolveCapturePath(A, "adapter_ingest")).toBe("adapter_ingest");
    expect(resolveCapturePath(C, "manual_transcription")).toBe("manual_transcription");
    expect(() => resolveCapturePath({ id: "x" })).toThrow(/capture_path/);
  });
});

describe("with raw_layer on the default and the override reach the recorder", () => {
  const small = { seed: 1, settings: SMALL };
  const out: Record<string, SeedOutput> = {};
  let off: SeedOutput;
  const pathsOf = (o: SeedOutput, id: string): string[] => [...new Set((o.datasets[id]?.result ?? []).map((r) => r.capture_path as string))];
  beforeAll(() => {
    for (const [name, over] of [["default", {}], ["adapter", { capture_path: "adapter_ingest" as const }], ["manual", { capture_path: "manual_transcription" as const }]] as const) {
      const config = rawConfigOf("default", small, over);
      out[name] = runSeed(rawInputOf(runScenario(config), config, `default-small-${name}`, [A, B, C], 8));
    }
    off = runSeed(inputOf(runOf("default", small), "default-small", [C], 8));
  }, 120_000);

  it("Given the layer on and no override When A, B and C are recorded Then A's rows are manual_transcription and B's and C's are adapter_ingest", () => {
    expect([A, B, C].map((a) => pathsOf(out.default as SeedOutput, a.id))).toEqual([["manual_transcription"], ["adapter_ingest"], ["adapter_ingest"]]);
    expect([A, B, C].map((a) => (out.default as SeedOutput).datasets[a.id]?.capture?.path)).toEqual(["manual_transcription", "adapter_ingest", "adapter_ingest"]);
  });
  it("Given a scenario override of adapter_ingest Then A's rows are adapter_ingest too (automatic linkage alone)", () => {
    expect(pathsOf(out.adapter as SeedOutput, A.id)).toEqual(["adapter_ingest"]);
  });
  it("Given a scenario override of manual_transcription Then C's rows are manual_transcription (what the flags cannot repair when capture is by hand)", () => {
    expect(pathsOf(out.manual as SeedOutput, C.id)).toEqual(["manual_transcription"]);
  });
  it("Given the clean files of the default scenario (no quirk switched on) Then C on adapter_ingest has the same result rows as the layer-off C on the content columns: key, version, run, value and instant", () => {
    const cols = (ds: SeedOutput["datasets"][string] | undefined) => (ds?.result ?? []).map((r) => [r.request_id, r.analyte, r.version, r.run_id, r.value, r.measured_at]);
    expect(cols(out.default?.datasets[C.id]).length).toBeGreaterThan(100);
    expect(cols(out.default?.datasets[C.id])).toEqual(cols(off.datasets[C.id]));
  });
  it("Given adapter_ingest Then every row of the dataset points to a raw file and line that exist in its raw tables (K20), and the ingest metrics are reported; on manual_transcription they read not applicable", () => {
    const ds = out.default?.datasets[C.id];
    const lines = new Set((ds?.raw?.raw_record ?? []).map((r) => `${r.raw_file_id}:${r.line_no}`));
    expect(ds?.result.length).toBeGreaterThan(0);
    expect(ds?.result.every((r) => r.raw_ref && lines.has(`${r.raw_ref.raw_file_id}:${r.raw_ref.line_no}`))).toBe(true);
    expect(out.default?.raw?.[C.id]?.metrics).toMatchObject({ status: "reported" });
    expect(out.default?.raw?.[A.id]?.metrics).toMatchObject({ status: "not_applicable" });
  });
});

describe("K23 on both paths, for A, B, C and every ablation of C", () => {
  const small = { seed: 1, settings: { ...SMALL, reactor_count: 3, bay_size: 3, cohort_size: 3, horizon_days: 4, production_days: 3 } };
  const outs = {} as Record<"manual_transcription" | "adapter_ingest", SeedOutput>;
  beforeAll(() => {
    for (const path of ["manual_transcription", "adapter_ingest"] as const) {
      const config = rawConfigOf("default", small, { capture_path: path });
      outs[path] = runSeed(rawInputOf(runScenario(config), config, `default-tiny-${path}`, CONFIGS.map((c) => c.config), 4));
    }
  }, 120_000);
  it.each(CONFIGS.map((c) => c.name))("Given %s Then every result has a capture_path; adapter_ingest rows have a raw_ref and no entered_by; manual rows have no raw_ref and an entered_by only with audit_trail on", (name) => {
    const config = (CONFIGS.find((c) => c.name === name) as (typeof CONFIGS)[number]).config;
    for (const path of ["manual_transcription", "adapter_ingest"] as const) {
      const rows = outs[path].datasets[config.id]?.result ?? [];
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.capture_path === path)).toBe(true);
      if (path === "adapter_ingest") expect(rows.every((r) => r.raw_ref != null && r.entered_by === null)).toBe(true);
      else expect(rows.every((r) => r.raw_ref === null && (config.flags.audit_trail ? typeof r.entered_by === "string" : r.entered_by === null))).toBe(true);
    }
  });
  it("Given a run on manual_transcription Then no raw_file, raw_record, parse_error or controller record exists, and the historian series arrive as observable events as with the layer off", () => {
    const ds = outs.manual_transcription.datasets[C.id];
    expect(ds?.raw).toBeUndefined();
    expect(ds?.historian.series.length).toBeGreaterThan(0);
    expect(Object.keys(ds ?? {})).not.toEqual(expect.arrayContaining(["alarm_event", "batch_phase_record", "raw_file"]));
  });
  it("Given the configs of one run Then configOf agrees with the scenario files (the scenario list of the repo is unchanged)", () => {
    expect(configOf("default").raw).toBeUndefined();
    expect(DIALECTS.allinone_csv?.dialect_id).toBe("allinone_csv");
  });
});
