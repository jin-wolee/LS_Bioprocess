import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT, readJson } from "../support/paths.ts";
import { isValid, ledgerIds, makeAjv, refsOf, rejected } from "../support/schemas.ts";
import type { Json } from "../support/schemas.ts";
import { breakoutProfile, docOf, fx12a, fx12e, h, runOfDoc, set } from "./support.ts";

// The break-out profile, the scenario block and the new events are data and schema first (ADR-0012, spec 11.8.5 row 2): every number is {value, unit, ref}; the ids are ledger ids; the
// values are the ones the ledger entries give (A139 12 h, A141 6 h and 0.3, A197 10, A142 5 d, A143 14 d, A148 20 mL and two media); the engine branches on no profile id.

describe("The bacterial profile", () => {
  const profile = breakoutProfile("bacterial") as { profile_id: string; kind: string; params: Record<string, { value: number; unit: string; ref: string }> };

  it("Given the profile schema When the file is validated Then it is valid (one schema for every kind of profile), and the same file with its kind changed or an unknown key is rejected", () => {
    const ajv = makeAjv();
    expect(rejected(ajv, "profile", profile)).toBe(false);
    expect(rejected(ajv, "profile", { ...profile, kind: "volcano" })).toBe(true);
    expect(rejected(ajv, "profile", { ...profile, surprise: 1 })).toBe(true);
    expect(rejected(ajv, "profile", { ...profile, alarm_signal: "temperature" })).toBe(true);
    expect(rejected(ajv, "profile", { ...profile, tests: [] })).toBe(true);
  });

  it("Given the file When it is read Then its id is its file name, it is the break-out kind, and every parameter is {value, unit, ref}", () => {
    expect(profile.profile_id).toBe("bacterial");
    expect(profile.kind).toBe("breakout");
    for (const [name, p] of Object.entries(profile.params)) {
      expect(typeof p.value, name).toBe("number");
      expect(p.unit, name).not.toBe("");
      expect(p.ref, name).toMatch(/^A\d{3}$/);
    }
  });

  it("Given the ledgers When every ref of the file is looked up Then each is a ledger id", () => {
    const ids = ledgerIds();
    const refs = refsOf(profile);
    expect(refs.length).toBeGreaterThan(8);
    for (const r of refs) expect(ids.has(r), r).toBe(true);
  });

  it("Given the ledger entries A139, A141, A197, A142, A143 and A148 When the numbers are compared Then the profile carries exactly them, under those ids", () => {
    const p = profile.params;
    expect(p.onset_to_signal_lag_h).toEqual({ value: 12, unit: "h", ref: "A139" });
    expect(p.signal_ramp_h).toEqual({ value: 6, unit: "h", ref: "A141" });
    expect(p.do_alarm_offset_pct).toEqual({ value: -10, unit: "% air saturation", ref: "A197" });
    expect(p.ph_change).toEqual({ value: -0.3, unit: "pH", ref: "A141" });
    expect(p.bioburden_turnaround_d).toEqual({ value: 5, unit: "d", ref: "A142" });
    expect(p.sterility_turnaround_d).toEqual({ value: 14, unit: "d", ref: "A143" });
    expect(p.sterility_volume_ml_per_medium).toEqual({ value: 20, unit: "mL", ref: "A148" });
    expect(p.sterility_media).toEqual({ value: 2, unit: "media", ref: "A148" });
  });

  it("Given the bioburden volume has no ledger number When the profile is read Then it is declared as a scenario input of A225 and carries no value", () => {
    const doc = profile as unknown as { scenario_inputs: Record<string, unknown>; params: Record<string, unknown> };
    expect(doc.scenario_inputs).toEqual({ bioburden_sample_volume_ml: { unit: "mL", ref: "A225" } });
    expect("bioburden_sample_volume_ml" in doc.params).toBe(false);
  });
});

describe("The scenario schema and the event schema", () => {
  const ajv = makeAjv();

  it("Given FX12a and FX12e as scenarios When they are validated Then both are valid", () => {
    expect(isValid(ajv, "scenario", docOf(fx12a()))).toBe(true);
    expect(isValid(ajv, "scenario", docOf(fx12e()))).toBe(true);
  });

  it("Given a block with an unknown key, an unknown origin kind, an empty confirm list or a bare number for a delay When validated Then each is invalid", () => {
    const bad: Json[] = [
      { ...fx12a(), speed: 1 },
      set(fx12a(), "origin.kind", "ceiling"),
      set(fx12a(), "confirm", []),
      set(fx12a(), "response.signal_to_response", 2),
      set(fx12a(), "topology.consumption.0.surprise", true),
    ];
    for (const block of bad) expect(isValid(ajv, "scenario", docOf(block))).toBe(false);
  });

  it("Given a block without response, topology or confirm When validated Then it is invalid (the loader refuses it by name; the schema says it is required)", () => {
    for (const key of ["response", "topology", "confirm", "origin", "profile"]) expect(isValid(ajv, "scenario", docOf(set(fx12a(), key, undefined))), key).toBe(false);
  });

  it("Given every event of the FX12a run When validated against the event schema Then every one is valid (the new types, the lot and equipment fields included)", () => {
    const run = runOfDoc(docOf(fx12a()));
    const invalid = run.events.filter((e) => !isValid(ajv, "event", e));
    expect(invalid).toEqual([]);
    expect(new Set(run.events.map((e) => e.type)).has("confirm_result")).toBe(true);
  });

  it("Given the new events with a field removed or added When validated Then they are invalid", () => {
    const onset = { type: "contamination_onset", t: 1, unit_id: "U01", batch_id: "B-U01", contamination_type: "bacterial", origin_kind: "medium_lot", origin_id: "ML-2" };
    expect(isValid(ajv, "event", onset)).toBe(true);
    expect(isValid(ajv, "event", { ...onset, origin_kind: "ceiling" })).toBe(false);
    expect(isValid(ajv, "event", { ...onset, extra: 1 })).toBe(false);
    const result = { type: "confirm_result", t: 1, sample_id: "U01-CONF", aliquot_id: "U01-CONF-A1", test: "bioburden", outcome: "detected" };
    expect(isValid(ajv, "event", result)).toBe(true);
    expect(isValid(ajv, "event", { ...result, outcome: "invalid" })).toBe(false);
    expect(isValid(ajv, "event", { ...result, outcome: undefined })).toBe(false);
  });

  it("Given the existing inoculation and process events When validated Then they stay valid without the new optional fields (additive change)", () => {
    expect(isValid(ajv, "event", { type: "inoculation", t: 0, unit_id: "U01", batch_id: "B-U01", density_e6_per_ml: 1 })).toBe(true);
    expect(isValid(ajv, "event", { type: "process_event", t: 5, unit_id: "U01", batch_id: "B-U01", kind: "feed", source: "rule", amount: 0.1, amount_unit: "L" })).toBe(true);
    expect(isValid(ajv, "event", { type: "process_event", t: 5, unit_id: "U01", batch_id: "B-U01", kind: "medium_addition", source: "scripted", lot_id: "ML-1" })).toBe(true);
  });
});

describe("The engine is generic about the event type", () => {
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p, out);
      else out.push(p);
    }
    return out;
  };
  const IDS = /['"](bacterial|fungal|mycoplasma|viral)['"]/;

  it("Given engine/src/breakout and the files that call it When they are searched for the name of a contamination type Then none is spelled out (the type is data)", () => {
    const files = [...walk(join(ROOT, "engine", "src", "breakout")), ...["process", "run", "scenario", "observe"].map((n) => join(ROOT, "engine", "src", `${n}.ts`))];
    expect(files.length).toBeGreaterThan(5);
    const hits = files.filter((f) => IDS.test(readFileSync(f, "utf8"))).map((f) => relative(ROOT, f));
    expect(hits).toEqual([]);
  });

  it("Given the same block with the lag changed in the scenario When the profile id is untouched Then only data changed: the lag of 20 h moves the signal to 25 h", () => {
    const run = runOfDoc(docOf(set(fx12a(), "lag", h(20, "A139"))));
    expect(run.events.filter((e) => e.type === "signal_observed").map((e) => e.t)).toEqual([25 * 3600]);
    expect(readJson<{ params: Record<string, { value: number }> }>("scenarios", "profiles", "breakout", "bacterial.json").params.onset_to_signal_lag_h?.value).toBe(12);
  });
});
