import { beforeAll, describe, expect, it } from "vitest";
import { runSeed } from "../../src/experiments/assembly/run_seed.ts";
import type { SeedOutput } from "../../src/experiments/assembly/run_seed.ts";
import { parseArchitecture } from "../../src/record/architecture.ts";
import type { ResultRow } from "../../src/record/types.ts";
import { loadScenario } from "../../src/scenario.ts";
import { runScenario } from "../../src/run.ts";
import type { CapturePath } from "../../src/raw/types.ts";
import { readJson } from "../support/paths.ts";
import { rawConfigOf, rawInputOf } from "../support/raw_run.ts";
import { lookup, patched, rawScenario } from "../support/scenarios.ts";
import { isValid, makeAjv } from "../support/schemas.ts";

// S2e1 rework W2: the export schedule (A216; the window itself is A098). It is a scenario setting, valid only with the layer on, so that a capture-path contrast can hold the timing
// fixed and change the path alone (spec section 5, "Automatic linkage alone"). per_run: each result leaves at the host instant it is produced, so its received_at is the entry time
// the manual path gives the same result. window_end (the default of spec 2.4.2): the file leaves at the end of the staffed window of that day. Instants are seconds of the scenario,
// day 0 a Monday; the roster is typed by hand from A201: weekdays end at 18:00 (64800 s), weekends at 14:00 (50400 s).

const preset = (name: string) => parseArchitecture(readJson("scenarios", "architectures", `${name}.json`));
const [B, C] = [preset("b_lims_lite"), preset("c_context")];
const END_WEEKDAY = 64800;
const END_WEEKEND = 50400;

describe("the export_schedule setting", () => {
  it("Given a scenario that sets export_schedule with raw_layer off When it is loaded Then it fails, and the message names the setting and the layer", () => {
    const doc = patched(rawScenario("default"), { fields: { export_schedule: "per_run" } });
    expect(() => loadScenario(doc, lookup)).toThrow(/export_schedule/);
    expect(() => loadScenario(doc, lookup)).toThrow(/raw_layer/);
  });
  it("Given the same scenario Then the schema refuses it too, accepts it once raw_layer is true, and refuses a value other than window_end and per_run", () => {
    const ajv = makeAjv();
    const doc = patched(rawScenario("default"), { fields: { export_schedule: "per_run" } });
    expect(isValid(ajv, "scenario", doc)).toBe(false);
    expect(isValid(ajv, "scenario", { ...doc, raw_layer: true })).toBe(true);
    expect(isValid(ajv, "scenario", { ...doc, raw_layer: true, export_schedule: "weekly" })).toBe(false);
  });
  it("Given a layer-on scenario Then the schedule is window_end unless the scenario says per_run", () => {
    expect(rawConfigOf("default", { seed: 1 }).raw?.export_schedule).toBe("window_end");
    expect(rawConfigOf("default", { seed: 1 }, { export_schedule: "per_run" }).raw?.export_schedule).toBe("per_run");
  });
});

describe("SC1 seed 1, the layer on: the schedule decides when a file arrives, the path does not", () => {
  type Rows = Record<string, ResultRow[]>;
  const rows = {} as Record<string, Record<CapturePath, Rows>>;
  beforeAll(() => {
    for (const schedule of ["per_run", "window_end"] as const) {
      rows[schedule] = {} as Record<CapturePath, Rows>;
      for (const path of ["manual_transcription", "adapter_ingest"] as const) {
        const config = rawConfigOf("default", { seed: 1 }, { capture_path: path, export_schedule: schedule });
        const out: SeedOutput = runSeed(rawInputOf(runScenario(config), config, `sc1-${schedule}-${path}`, [B, C], 21));
        rows[schedule][path] = Object.fromEntries(Object.entries(out.datasets).map(([id, ds]) => [id, ds.result]));
      }
    }
  }, 240_000);
  const stamps = (rs: ResultRow[] | undefined, field: "ingested_at" | "available_at"): Map<string, number | null> => new Map((rs ?? []).map((r) => [`${r.request_id}|${r.analyte}|${r.version}`, r[field]]));

  it.each([B, C])("Given per_run When %s is recorded on each path Then adapter ingested_at equals manual ingested_at for every result key", (arch) => {
    const manual = stamps(rows.per_run?.manual_transcription[arch.id], "ingested_at");
    const adapter = stamps(rows.per_run?.adapter_ingest[arch.id], "ingested_at");
    expect(manual.size).toBeGreaterThan(300);
    expect(adapter).toEqual(manual);
    expect([...manual.values()].every((v) => typeof v === "number")).toBe(true);
  });
  it("Given per_run Then C's available_at is equal on both paths too, so the path alone no longer moves a result's availability", () => {
    expect(stamps(rows.per_run?.adapter_ingest[C.id], "available_at")).toEqual(stamps(rows.per_run?.manual_transcription[C.id], "available_at"));
  });
  it("Given window_end Then every adapter row is ingested at the end of the staffed window of its day (18:00 on a weekday, 14:00 on a weekend), or at its own instant when that is later", () => {
    const adapter = rows.window_end?.adapter_ingest[C.id] ?? [];
    expect(adapter.length).toBeGreaterThan(300);
    for (const r of adapter) {
      const day = Math.floor(r.measured_at / 86400);
      const end = day * 86400 + (day % 7 >= 5 ? END_WEEKEND : END_WEEKDAY);
      expect(r.ingested_at, `${r.request_id} ${r.analyte}`).toBe(Math.max(r.measured_at, end));
    }
  });
  it("Given window_end Then the manual path is not delayed (no entry delay is modelled, spec 2.4.8): its ingested_at is the instant of the result", () => {
    for (const r of rows.window_end?.manual_transcription[C.id] ?? []) expect(r.ingested_at).toBe(r.measured_at);
  });
  it("Given the two schedules Then the manual path is the same under both: the schedule changes the file, not the entry", () => {
    expect(stamps(rows.window_end?.manual_transcription[C.id], "ingested_at")).toEqual(stamps(rows.per_run?.manual_transcription[C.id], "ingested_at"));
  });
});
