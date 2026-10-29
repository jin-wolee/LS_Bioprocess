import { beforeAll, describe, expect, it } from "vitest";
import type { SeedOutput } from "../src/experiments/assembly/run_seed.ts";
import { runSeed } from "../src/experiments/assembly/run_seed.ts";
import type { ScenarioRun } from "../src/run.ts";
import { CONFIGS } from "./support/cells.ts";
import { eventsOf, inputOf, mixedUp } from "./support/sc_run.ts";
import { RAW_ROWS, runRaw } from "./support/raw_cells.ts";
import { SMALL, runOf } from "./support/scenarios.ts";

// SC7 Re-run and dilution (spec 7): how are reruns and dilutions recorded? A small variant of the default scenario with the run-level rerun probability
// raised to 0.5 (test-only; the ledger default is A088), seed 1, recorded as A (overwrite in place, no versions) and C (append-only versions). Structural
// relations only (prompts/20 Step 4): where the first attempt of a rerun request survives, and where it does not. The expected values come from the truth
// log (the attempts and values the instrument reported), never from the recorder.

const A = CONFIGS[0];
const C = CONFIGS[2];

/** For each (request, analyte) with more than one attempt: the values the instrument reported, in attempt order. */
const attemptsOf = (run: ScenarioRun): Map<string, number[]> => {
  const byKey = new Map<string, Map<number, number>>();
  for (const e of eventsOf(run, "result_measured")) {
    const k = `${e.request_id}/${e.analyte}`;
    byKey.set(k, (byKey.get(k) ?? new Map<number, number>()).set(e.attempt, e.value));
  }
  return new Map([...byKey].filter(([, m]) => m.size > 1).map(([k, m]) => [k, [...m].sort((a, b) => a[0] - b[0]).map(([, v]) => v)]));
};

describe("SC7 re-run and dilution", () => {
  let reruns: Map<string, number[]>;
  let out: SeedOutput;
  /** A rerun key whose request a label error touched is left out: its results are recorded under another id (another relation). */
  const skip = (arch: string, key: string): boolean => mixedUp(out.key_text, arch).has(key.split("/")[0] as string);
  const rows = (arch: string, key: string) => (out.datasets[arch]?.result ?? []).filter((r) => `${r.request_id}/${r.analyte}` === key);

  beforeAll(() => {
    const run = runOf("default", { seed: 1, settings: { ...SMALL, rerun_probability: 0.5 } });
    reruns = attemptsOf(run);
    out = runSeed(inputOf(run, "default-small-reruns", [(A as (typeof CONFIGS)[number]).config, (C as (typeof CONFIGS)[number]).config], 8));
  }, 120_000);

  it("Given a rerun probability of 0.5 When the truth log is read Then some requests have two or more attempts for an analyte", () => {
    expect(reruns.size).toBeGreaterThan(10);
  });

  it("Given A (append_only_versions off) Then the rerun overwrote the first attempt: one row per rerun key, holding the last attempt's value, and no row keeps the first", () => {
    for (const [key, values] of reruns) {
      if (skip("a_manual", key)) continue;
      const kept = rows("a_manual", key);
      expect(kept.length, key).toBe(1);
      expect(kept[0]?.value, key).toBe(values[values.length - 1]);
      if (values[0] !== values[values.length - 1]) expect(kept.map((r) => r.value), key).not.toContain(values[0]);
    }
  });

  it("Given C (append_only_versions on) Then every attempt is a version in order, the first attempt's value is version 1, and each version supersedes the one before", () => {
    for (const [key, values] of reruns) {
      const kept = rows("c_context", key).sort((a, b) => a.version - b.version);
      expect(kept.map((r) => r.value), key).toEqual(values);
      expect(kept.map((r) => r.version), key).toEqual(values.map((_, i) => i + 1));
      kept.slice(1).forEach((r, i) => expect(r.supersedes, key).toBe((kept[i] as (typeof kept)[number]).result_id));
    }
  });

  it("Given A with audit_trail off Then no audit event records that the first attempt was replaced, and C holds one audit event per replaced attempt", () => {
    expect(out.datasets["a_manual"]?.audit_event).toEqual([]);
    const replaced = [...reruns.values()].reduce((n, v) => n + v.length - 1, 0);
    expect(out.datasets["c_context"]?.audit_event.length).toBe(replaced);
  });

  // Closed by S2e1 (the capture path, spec section 5 "Capture path"; A048 "manual path only: factor missing or unit mismatch"): the dilution factor is typed from the screen or printout only on
  // manual_transcription; on adapter_ingest the parser reads it from the file and there is no copy step. Expected cells typed by hand from that table, for A, B and C on each path.
  describe("dilution-factor entry errors occur only where a person copies the result (manual_transcription)", () => {
    const row = RAW_ROWS.find((r) => r.name.startsWith("transcription: a dilution factor of 3")) as (typeof RAW_ROWS)[number];
    const presets = [CONFIGS[0], CONFIGS[1], CONFIGS[2]] as (typeof CONFIGS)[number][];
    it.each(presets.map((c) => c.name))("Given %s on manual_transcription When a dilution factor of 3 is typed (the method offers 1, 2 and 4) Then the entry error arises and VR-013 holds the row", (name) => {
      const { out, cell } = runRaw(row, (presets.find((c) => c.name === name) as (typeof CONFIGS)[number]).config, "manual_transcription");
      expect([out.key.entry_errors.map((e) => [e.kind, e.typed]), cell]).toEqual([[["dilution", 3]], "detected:VR-013"]);
    });
    it.each(presets.map((c) => c.name))("Given %s on adapter_ingest Then no dilution entry error arises: the parser reads the factor of the file (1, the default ratio) and nothing is typed", (name) => {
      const { out, ds, cell } = runRaw(row, (presets.find((c) => c.name === name) as (typeof CONFIGS)[number]).config, "adapter_ingest");
      expect([out.key.entry_errors, ds.result.map((r) => r.dilution_factor), cell]).toEqual([[], [1], "not_applicable"]);
    });
  });
  // The pre-dilution multiplier that an operator types at the analyzer (A090 notes; preset B's limit "dilution factor typed by hand") is typed by hand on both paths (spec 2.4.8, last bullet;
  // orchestrator ruling 2026-10-30): an error in it enters the value before any file or printout exists, so it is in both paths alike and does not depend on the path. It is not modelled: there is
  // no rate (A048) and whether the export carries the field is unsettled (A165 lists it as a screen field). No cell is asserted; the todo stays until a source settles it.
  it.todo("Given the pre-dilution multiplier typed by hand at the analyzer When it is wrong Then the error is in both paths alike (not modelled: no rate, A048; whether the export carries the field is unsettled, spec 2.4.8)");
});
