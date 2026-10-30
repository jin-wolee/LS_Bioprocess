import { beforeAll, describe, expect, it } from "vitest";
import { evaluationSettings } from "../../src/evaluate/config.ts";
import { runArm } from "../../src/experiments/assembly/closed_loop_arm.ts";
import type { ArmSpec } from "../../src/experiments/assembly/closed_loop_arm.ts";
import { runClosedLoopSeed } from "../../src/experiments/assembly/closed_loop.ts";
import type { ClosedLoopInput, SeedOutcome } from "../../src/experiments/assembly/closed_loop.ts";
import { buildShared } from "../../src/experiments/assembly/closed_loop_shared.ts";
import { pairedMean, METRICS } from "../../src/evaluate/closed_loop.ts";
import { createRng } from "../../src/rng.ts";
import type { StreamKey } from "../../src/rng.ts";
import { runScenario } from "../../src/run.ts";
import { loadScenario } from "../../src/scenario.ts";
import { canonicalJsonl } from "../../src/trace.ts";
import { ALL_ARCHS, PRESETS } from "../support/open_loop_setup.ts";
import { readJson } from "../support/paths.ts";
import { SMALL, lookup, patched, rawScenario } from "../support/scenarios.ts";
import type { Json } from "../support/schemas.ts";

// SC8 (experiment 2, spec 6.2): one shared lab run per seed, the pH loop run once per arm. Small scenario (6 reactors, 8 days) and test-only seeds. Nothing here asserts a sign,
// a size or an ordering of the arms: the structural relations are the invariance of the open loop, the shared draws, the zero-bias identity and C's exclusion rule.

const EVAL = evaluationSettings(readJson("scenarios", "evaluation", "default.json"));
const NAME = "sc08_ph_restandardisation";
const ZERO_STABILITY = [
  { effect: "linear_rate", analyte: "ph", container: "closed", rate: { value: 0, unit: "pH/h", ref: "A043" }, valid_to: { value: 30, unit: "min", ref: "A046" } },
  { effect: "first_order_offset", analyte: "ph", container: "open", offset: { value: 0, unit: "pH", ref: "A041" }, tau: { value: 2.5, unit: "h", ref: "A042" } },
] as unknown as Json;
/**
 * The all-in-one analyzer profile with the pH noise at zero and the over-range limits out of reach (no dilution rerun): with no stability effect either, the offline value is
 * the true pH at the draw and every sample has exactly one pH result.
 */
const quietLookup = (kind: Parameters<typeof lookup>[0], id: string): unknown => {
  const doc = structuredClone(lookup(kind, id)) as { params: Record<string, { value: number }> };
  if (kind === "analyzer") {
    if (doc.params.noise_sd_ph) doc.params.noise_sd_ph.value = 0;
    for (const [name, p] of Object.entries(doc.params)) if (name.startsWith("over_range_")) p.value = 1e12;
  }
  return doc;
};

const config = (over: { settings?: Record<string, number>; fields?: Json; zero?: boolean; feedback?: boolean } = {}) =>
  loadScenario(patched(rawScenario(NAME), { settings: { ...SMALL, ...over.settings }, ...(over.fields && { fields: over.fields }), ...(over.feedback !== undefined && { feedback: over.feedback }) }), over.zero ? quietLookup : lookup);

/** No offline bias at all: no stability effect, no analyzer noise, no rerun, no open container, a hold limit no hold reaches. */
const ZERO = (): ClosedLoopInput => ({
  scenario: config({ settings: { rerun_probability: 0, technique_error_probability: 0 }, fields: { stability: ZERO_STABILITY }, zero: true }),
  seeds: [3, 4], evaluation: { ...EVAL, hold_limit_s: 1e9 }, architectures: PRESETS, variants: [{ id: "c_context_modelled", of: "c_context", bias_handling: "model" }],
});
const input = (over: Partial<ClosedLoopInput> = {}): ClosedLoopInput => ({ scenario: config(), seeds: [3, 4], evaluation: EVAL, architectures: PRESETS, variants: [{ id: "c_context_modelled", of: "c_context", bias_handling: "model" }], ...over });
const arm = (o: SeedOutcome, id: string) => o.arms.find((a) => a.id === id) as SeedOutcome["arms"][number];

describe("SC8 feedback off: the open loop is untouched", () => {
  it("Given the SC8 settings with feedback false When the scenario runs Then the event log equals the default scenario's log, byte for byte (the probe settings are inert)", () => {
    const off = runScenario(config({ feedback: false }));
    const base = runScenario(loadScenario(patched(rawScenario("default"), { settings: SMALL }), lookup));
    expect(canonicalJsonl(off.events)).toBe(canonicalJsonl(base.events));
    expect(Array.from(off.sensors[0]?.pv ?? [])).toEqual(Array.from(base.sensors[0]?.pv ?? []));
  });

  it("Given feedback true When the plain run is asked Then it refuses: the loop belongs to the closed-loop assembly", () => {
    expect(() => runScenario(config())).toThrow(/feedback/);
  });

  it("Given a scenario with feedback false or without the probe settings When the closed loop is asked Then it refuses", () => {
    expect(() => runClosedLoopSeed(input({ scenario: config({ feedback: false }) }), 3)).toThrow(/feedback: true/);
    const bare = loadScenario(patched(rawScenario("default"), { settings: SMALL, feedback: true }), lookup);
    expect(() => runClosedLoopSeed(input({ scenario: bare }), 3)).toThrow(/pH feedback settings/);
  });

  it("Given the closed loop has run Then the shared truth log is byte-identical to the open-loop log of the same scenario and seed", () => {
    const cfg = input().scenario;
    const before = canonicalJsonl(runScenario({ ...cfg, seed: 3, feedback: false }).events);
    const run = runScenario({ ...cfg, seed: 3, feedback: false });
    const shared = buildShared(run, cfg, 3, { architectures: PRESETS, evaluation: EVAL, rng: createRng() });
    for (const spec of [{ id: "oracle", kind: "oracle" }, { id: "a_manual", kind: "architecture", structure: "a_manual" }, { id: "c_context", kind: "architecture", structure: "c_context" }] as ArmSpec[]) runArm(shared, spec, createRng());
    expect(canonicalJsonl(run.events)).toBe(before);
  });
});

describe("SC8 common random numbers: every arm shares every draw", () => {
  const cfg = input().scenario;
  const run = runScenario({ ...cfg, seed: 3, feedback: false });
  const shared = buildShared(run, cfg, 3, { architectures: PRESETS, evaluation: EVAL, rng: createRng() });
  const specs: ArmSpec[] = [
    { id: "oracle", kind: "oracle" }, { id: "a_manual", kind: "architecture", structure: "a_manual" }, { id: "b_lims_lite", kind: "architecture", structure: "b_lims_lite" },
    { id: "c_context", kind: "architecture", structure: "c_context" }, { id: "c_context_modelled", kind: "sensitivity", structure: "c_context", bias_handling: "model" },
  ];

  it("Given the same seed When each arm runs Then each asks for exactly the same keyed streams, and no key carries an arm id", () => {
    const keysOf = (spec: ArmSpec): StreamKey[] => {
      const keys: StreamKey[] = [];
      runArm(shared, spec, createRng((k) => keys.push(k)));
      return keys;
    };
    const first = keysOf(specs[0] as ArmSpec);
    expect(first.length).toBe(shared.reactors.length);
    for (const spec of specs) {
      const keys = keysOf(spec);
      expect(keys, spec.id).toEqual(first);
      for (const k of keys) {
        expect(k[0]).toBe(3);
        expect(k.some((part) => typeof part === "string" && specs.some((s) => part.includes(s.id)))).toBe(false);
      }
    }
  });

  it("Given readjustment switched off (A051) Then no decision exists and every arm's world is identical, bit for bit: the draws are the same ones", () => {
    const off = input({ scenario: config({ settings: { ph_probe_readjust_on: 0 } }) });
    const o = runClosedLoopSeed(off, 3);
    const oracle = arm(o, "oracle");
    expect(oracle.reactors.some((r) => r.offset_mean_abs > 0)).toBe(true);
    for (const a of o.arms) {
      expect(a.reactors, a.id).toEqual(oracle.reactors);
      expect(a.counts.readjusted, a.id).toBe(0);
    }
  });

  it("Given the same seed twice Then the whole outcome is identical (determinism)", () => {
    expect(runClosedLoopSeed(input(), 4)).toEqual(runClosedLoopSeed(input(), 4));
  });
});

describe("SC8 zero bias: no error in the offline value gives exactly zero paired difference", () => {
  let o: SeedOutcome[];
  beforeAll(() => {
    o = [3, 4].map((seed) => runClosedLoopSeed(ZERO(), seed));
  });

  it("Given no stability effect, no analyzer noise, no rerun and no open container When every arm runs Then each arm's reactors equal the oracle's and every paired difference is exactly 0", () => {
    for (const s of o) {
      const oracle = arm(s, "oracle");
      for (const a of s.arms) {
        expect(a.reactors, `${a.id} seed ${s.seed}`).toEqual(oracle.reactors);
        for (const m of METRICS) expect(pairedMean(a.reactors, oracle.reactors, m)).toBe(0);
      }
    }
  });

  it("Then the identity is not vacuous: the probe drifts, the controller acts and readjustments happen in every arm", () => {
    for (const s of o) {
      const oracle = arm(s, "oracle");
      expect(oracle.reactors.some((r) => r.offset_mean_abs > 0)).toBe(true);
      expect(oracle.reactors.some((r) => r.excursion_max_abs > 0)).toBe(true);
      for (const a of s.arms) expect(a.counts.readjusted, a.id).toBeGreaterThan(0);
    }
  });

  it("Given the ledger values of the offline effects instead Then at least one arm differs from the oracle (the bias is what the zero case removed)", () => {
    const s = runClosedLoopSeed(input(), 3);
    const oracle = arm(s, "oracle");
    expect(s.arms.some((a) => a.id !== "oracle" && JSON.stringify(a.reactors) !== JSON.stringify(oracle.reactors))).toBe(true);
  });
});

describe("SC8 context: one rule for A, B and C; an open container is excluded by all, a hold above the limit only where the hold is stored", () => {
  it("Given every pH sample is taken in an open container (technique probability 1) Then A, B and C skip every readjustment they have a value for; the oracle readjusts", () => {
    const s = runClosedLoopSeed(input({ scenario: config({ settings: { technique_error_probability: 1 } }) }), 3);
    for (const id of ["a_manual", "b_lims_lite", "c_context"]) {
      expect(arm(s, id).counts.skipped_known_bias, id).toBeGreaterThan(0);
      expect(arm(s, id).counts.readjusted, id).toBe(0);
    }
    expect(arm(s, "oracle").counts.skipped_known_bias).toBe(0);
    expect(arm(s, "oracle").counts.readjusted).toBeGreaterThan(0);
  });

  it("Given the same samples When C models the bias instead of excluding it Then each architecture subtracts the offset and readjusts onto the values whose hold is within the limit it can see", () => {
    const s = runClosedLoopSeed(input({ scenario: config({ settings: { technique_error_probability: 1 } }) }), 3);
    expect(arm(s, "c_context_modelled").counts.readjusted).toBeGreaterThan(0);
  });

  it("Given no open container (probability 0) Then A and B skip nothing: they store no hold time and the container marks nothing", () => {
    const s = runClosedLoopSeed(input({ scenario: config({ settings: { technique_error_probability: 0 } }) }), 3);
    for (const id of ["a_manual", "b_lims_lite"]) expect(arm(s, id).counts.skipped_known_bias, id).toBe(0);
  });

  it("Given no open container (probability 0) and a hold limit no hold reaches Then C skips nothing", () => {
    const s = runClosedLoopSeed(input({ scenario: config({ settings: { technique_error_probability: 0 } }), evaluation: { ...EVAL, hold_limit_s: 1e9 } }), 3);
    expect(arm(s, "c_context").counts.skipped_known_bias).toBe(0);
  });

  it("Given a validity limit of 1 min on the stability effects Then every offline value an architecture holds is extrapolated and the oracle holds none; given ten years Then none is", () => {
    const limit = (minutes: number) =>
      [
        { effect: "linear_rate", analyte: "ph", container: "closed", rate: { value: -0.025, unit: "pH/h", ref: "A043" }, valid_to: { value: minutes, unit: "min", ref: "A046" } },
        { effect: "first_order_offset", analyte: "ph", container: "open", offset: { value: 0.04, unit: "pH", ref: "A041" }, tau: { value: 2.5, unit: "h", ref: "A042" }, valid_to: { value: minutes, unit: "min", ref: "A046" } },
      ] as unknown as Json;
    const tight = runClosedLoopSeed(input({ scenario: config({ fields: { stability: limit(1) } }) }), 3);
    const loose = runClosedLoopSeed(input({ scenario: config({ fields: { stability: limit(5_256_000) } }) }), 3);
    for (const a of tight.arms.filter((x) => x.kind !== "oracle")) expect([a.counts.values > 0, a.counts.extrapolated], a.id).toEqual([true, a.counts.values]);
    for (const a of loose.arms) expect(a.counts.extrapolated, a.id).toBe(0);
    expect(arm(tight, "oracle").counts).toMatchObject({ values: 0, extrapolated: 0 });
  });

  it("Given each arm Then its slots are accounted for: slots = readjusted + skipped + no new result", () => {
    const s = runClosedLoopSeed(input(), 4);
    for (const a of s.arms) expect(a.counts.slots, a.id).toBe(a.counts.readjusted + a.counts.skipped_known_bias + a.counts.no_new_result);
  });
});

describe("SC8 recorded structure: the record the arms read does not depend on the pH values", () => {
  it("Given the pH values of the lab run are all shifted by 0.5 Then every column of every pH row except the value is identical in A, B and C", () => {
    const cfg = input().scenario;
    const run = runScenario({ ...cfg, seed: 3, feedback: false });
    const shifted = { ...run, events: run.events.map((e) => (e.type === "result_measured" && e.analyte === "ph" ? { ...e, value: e.value + 0.5 } : e)) };
    const a = buildShared(run, cfg, 3, { architectures: ALL_ARCHS.slice(0, 3), evaluation: EVAL, rng: createRng() });
    const b = buildShared(shifted, cfg, 3, { architectures: ALL_ARCHS.slice(0, 3), evaluation: EVAL, rng: createRng() });
    const strip = <T extends { value: number }>(rows: T[]): T[] => rows.map((r) => ({ ...r, value: 0 }));
    for (const id of ["a_manual", "b_lims_lite", "c_context"]) {
      const ra = a.structure[id]?.dataset.result ?? [];
      expect(ra.length).toBeGreaterThan(0);
      expect(strip(b.structure[id]?.dataset.result ?? []), id).toEqual(strip(ra));
    }
  });

  it("Given the technique probability 1 (0) Then the container the plan records is open (closed) for every sample in every architecture, drawn from the sample's own key", () => {
    for (const [p, want] of [[1, "open"], [0, "closed"]] as const) {
      const cfg = config({ settings: { technique_error_probability: p } });
      const run = runScenario({ ...cfg, seed: 3, feedback: false });
      const keys: StreamKey[] = [];
      const sh = buildShared(run, cfg, 3, { architectures: PRESETS, evaluation: EVAL, rng: createRng((k) => keys.push(k)) });
      for (const id of ["a_manual", "b_lims_lite", "c_context"]) {
        const containers = new Set(sh.structure[id]?.dataset.sample.map((s) => s.container));
        expect(containers.size).toBe(1);
        expect(containers.has(want)).toBe(true);
      }
      expect(keys.length).toBeGreaterThan(0);
      for (const k of keys) expect([k[2], k[3], k[4]]).toEqual(["-", 0, "error:technique_error"]);
    }
  });
});
