import { beforeAll, describe, expect, it } from "vitest";
import type { SeedOutput } from "../src/experiments/assembly/run_seed.ts";
import { runSeed } from "../src/experiments/assembly/run_seed.ts";
import type { ScenarioRun } from "../src/run.ts";
import { CONFIGS } from "./support/cells.ts";
import { eventsOf, inputOf, mixedUp } from "./support/sc_run.ts";
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

  // Pending S2e (the capture path, spec section 5 "Capture path"): with the raw layer off no architecture setting says who types the dilution factor
  // (spec section 5 names B, and A transcribes, but nothing is said for C) and the injector has no dilution-entry error (spec 2.4.8: no ledger entry).
  it.todo("Given the raw layer off When dilution-factor errors are injected Then they occur only on manual paths (pending S2e, capture path: manual_transcription against adapter_ingest)");
});
