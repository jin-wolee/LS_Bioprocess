import { describe, expect, it } from "vitest";
import { createChallenges } from "../../src/experiments/assembly/lab/challenges.ts";
import { scenarioConfig, scenarioDoc } from "../../src/experiments/assembly/lab/setup.ts";
import { checkRunSpec } from "../../src/experiments/assembly/lab/spec.ts";
import type { RunSpec } from "../../src/experiments/assembly/lab/spec.ts";
import { runScenario } from "../../src/run.ts";
import { logHash } from "../../src/trace.ts";
import { labData } from "../support/lab_data.ts";
import { SMALL } from "../support/scenarios.ts";

// Audit A1, finding F7, rework (2026-11-02): the lock of a challenge named the spec, resolved against the scenario's defaults, and not the truth. A capture path is a lab setting that leaves
// the truth log as it is (plant_ui.md section 5.3), yet a challenge on `{}` did not lock the same run asked with a capture path, so `lineage` read the truth column of the challenge's own run;
// so did every setting the run does not read (the staggered windows under the burst plan, the deadline of earliest-deadline-first under first-in-first-out). The orchestrator's rule: a request
// is locked when its run, with its actions stripped, has the truth of an open challenge's run (lab_ui.md section 4, rule 2). The expected side of every test is the SHA-256 of the canonical
// truth log, computed here from the engine's own run, never from the lock.

const data = labData();
const ALL: RunSpec = { schema_version: "1", scenario: "default", settings: {}, architectures: ["a_manual", "b_lims_lite", "c_context"], seeds: [1] };
const truthHash = (spec: RunSpec, seed: number): Promise<string> =>
  logHash(runScenario(scenarioConfig(data, spec.scenario, spec.settings, seed, { ...(spec.bay_profiles && { bay_profiles: spec.bay_profiles }), ...(spec.analyzer_profiles && { analyzer_profiles: spec.analyzer_profiles }), ...(spec.capture_path && { capture_path: spec.capture_path }) })).events);

describe("F7 rework: a capture path does not make another truth", () => {
  it.each(["manual_transcription", "adapter_ingest"] as const)("Given a sample challenge open on the default run, seed 1 When the same run is asked with the capture path %s Then its truth log hash is the challenge's and it is locked", async (path) => {
    const challenges = createChallenges(data);
    expect(challenges.start({ variant: "sample", spec: ALL, seed: 1, shown: "a_manual" }).ok).toBe(true);
    const asked = { ...ALL, capture_path: path };
    expect(await truthHash(asked, 1)).toBe(await truthHash(ALL, 1));
    expect(challenges.locked(asked, 1)).toBe(true);
  });
});

// The first round of F7, kept: a setting written out at its default value (24 reactors, A001), the scenario's own lists (`bench_manual` for 2 bays and `allinone_atline` for 2 analyzers,
// scenarios/default.json) and `-0` for the default initial lactate of 0 (A209) are the same run and locked; 6 reactors, another analyzer list and seed 2 are other runs and are not; the
// architectures and the operator actions are not part of a run's truth.
describe("F7: the lock holds for every expression of the same run", () => {
  it("Given a sample challenge open on the default run, seed 1 Then the expressions of that run are locked and other runs are not", () => {
    const challenges = createChallenges(data);
    const started = challenges.start({ variant: "sample", spec: ALL, seed: 1, shown: "a_manual" });
    expect(started.ok).toBe(true);
    const sameRun: Partial<RunSpec>[] = [{ settings: { reactor_count: 24 } }, { bay_profiles: ["bench_manual", "bench_manual"], analyzer_profiles: ["allinone_atline", "allinone_atline"] }, { settings: { initial_lactate_g_per_l: -0 } }, { architectures: ["c_context"] }];
    for (const same of sameRun) expect(challenges.locked({ ...ALL, ...same }, 1), JSON.stringify(same)).toBe(true);
    for (const other of [{ settings: { reactor_count: 6 } }, { analyzer_profiles: ["allinone_atline", "hplc"] }]) expect(challenges.locked({ ...ALL, ...other }, 1), JSON.stringify(other)).toBe(false);
    expect(challenges.locked(ALL, 2)).toBe(false);
  });

  it("Given the key the challenge answers with Then it is the key the Worker gives the same run asked another way, and another run has another key", () => {
    const challenges = createChallenges(data);
    const started = challenges.start({ variant: "sample", spec: ALL, seed: 1, shown: "a_manual" });
    if (!started.ok) throw new Error(started.message);
    expect(challenges.keyOf({ ...ALL, settings: { reactor_count: 24 }, capture_path: "adapter_ingest" }, 1)).toBe(started.key);
    expect(challenges.keyOf(ALL, 2)).not.toBe(started.key);
  });
});

/** The first value, in a fixed order of tries, that differs from the setting's own, passes the spec check and loads: none for a setting the run accepts at its own value only. */
const perturbed = (base: RunSpec, name: string, own: number): RunSpec | null => {
  const tries = [own + 1, own - 1, Number.isInteger(own) ? Math.round(own * 1.1) : own * 1.1, own / 2, own * 2, 1, 0];
  for (const value of tries) {
    if (value === own) continue;
    const spec = { ...base, settings: { ...base.settings, [name]: value } };
    if (!checkRunSpec(spec, data).ok) continue;
    try {
      runScenario(scenarioConfig(data, spec.scenario, spec.settings, 1));
      return spec;
    } catch {
      // the engine refuses this value; the next one is tried
    }
  }
  return null;
};

describe("F7 rework: the lock is exactly the truth, setting by setting", () => {
  // The small default plant (6 reactors, 8 days), seed 1. Each setting of the bundled default scenario is moved to the first value of the tries that the run accepts; the request is locked
  // exactly when its truth log hash equals the challenge's, so no setting can be in the key without being in the truth, or in the truth without being in the key. Two settings take no other
  // value alone (typed by hand from scenarios/default.json and the engine's checks): the sensor cadence must be a whole multiple of the 60 s step and divide one minute, so 60 s only
  // (sensors.ts, process.ts), and the run plans one regular sample per reactor and day (sampling.ts, S1b).
  it("Given a challenge on the small default run When each setting is moved alone Then the request is locked if and only if the truth log is the challenge's", async () => {
    const base: RunSpec = { ...ALL, settings: SMALL };
    const challenges = createChallenges(data);
    expect(challenges.start({ variant: "sample", spec: base, seed: 1, shown: "a_manual" }).ok).toBe(true);
    const baseHash = await truthHash(base, 1);
    const fixed: string[] = [];
    const wrong: string[] = [];
    let same = 0;
    for (const [name, s] of Object.entries(scenarioDoc(data, "default").settings)) {
      const spec = perturbed(base, name, SMALL[name] ?? s.value);
      if (spec === null) {
        fixed.push(name);
        continue;
      }
      const sameTruth = (await truthHash(spec, 1)) === baseHash;
      if (sameTruth) same += 1;
      if (challenges.locked(spec, 1) !== sameTruth) wrong.push(`${name}=${spec.settings[name]} (same truth: ${sameTruth})`);
    }
    expect(fixed).toEqual(["sensor_cadence_s", "samples_per_reactor_per_day"]);
    expect(wrong).toEqual([]);
    expect(same).toBeGreaterThan(0);
  }, 120_000);
});
