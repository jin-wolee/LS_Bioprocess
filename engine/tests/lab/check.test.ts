import { afterEach, describe, expect, it, vi } from "vitest";
import { CHECK_SEEDS, REPEATS, computeReference, makeDeps, runCheck } from "../../src/experiments/assembly/lab/check.ts";
import type { CheckDeps, Reference } from "../../src/experiments/assembly/lab/check.ts";
import { ENGINE_VERSION } from "../../src/trace.ts";
import { labData } from "../support/lab_data.ts";
import { readJson } from "../support/paths.ts";

// The browser check of ADR-0016 under ADR-0019 (docs/design/lab_ui.md section 7): three truth hashes (seeds 1 to 3) against the reference, five repeats of seed 1 that must
// agree, and the digest of the metric cells of seed 1 under A, B and C. One strict comparison, no tolerance. Most cases use deps with hand-typed answers; the last two run the engine.

const HASH = (c: string): string => c.repeat(64);
const NODE = { version: "v0.0.0", flags: ["--no-maglev-escape-analysis"] };
const ARCHITECTURES = ["a_manual", "b_lims_lite", "c_context"];

/** Deps that answer a fixed hash per seed and a fixed digest; `ms` counts up by 10 per call so the timings are known by hand. */
const fakeDeps = (over: Partial<CheckDeps> = {}): CheckDeps => {
  let calls = 0;
  return {
    engine_version: ENGINE_VERSION,
    truth: async (seed) => ({ log_hash: HASH(String(seed)), ms: 10 * ++calls }),
    cells: async () => ({ architectures: ARCHITECTURES, digest: HASH("c") }),
    ...over,
  };
};

const reference = async (): Promise<Reference> => computeReference(fakeDeps(), NODE);

/** The reference with one hex digit of one hash changed. */
const flipped = (ref: Reference, where: "seed1" | "seed2" | "seed3" | "cells"): Reference => {
  const copy = structuredClone(ref);
  const bump = (h: string): string => (h.startsWith("a") ? "b" : "a") + h.slice(1);
  if (where === "cells") copy.cells.digest = bump(copy.cells.digest);
  else {
    const row = copy.truth.find((t) => t.seed === Number(where.slice(4)));
    if (row) row.log_hash = bump(row.log_hash);
  }
  return copy;
};

describe("computeReference", () => {
  it("Given deps When the reference is computed Then it holds the engine version, the node facts, one hash per check seed and the cell digest", async () => {
    expect(await reference()).toEqual({
      schema_version: "1",
      engine_version: ENGINE_VERSION,
      node: NODE,
      truth: [{ seed: 1, log_hash: HASH("1") }, { seed: 2, log_hash: HASH("2") }, { seed: 3, log_hash: HASH("3") }],
      cells: { seed: 1, architectures: ARCHITECTURES, digest: HASH("c") },
    });
    expect([...CHECK_SEEDS]).toEqual([1, 2, 3]);
    expect(REPEATS).toBe(5);
  });
});

describe("runCheck: identical", () => {
  it("Given a browser that gives the reference Then the state is identical and every part is equal", async () => {
    const out = await runCheck(await reference(), fakeDeps());
    expect(out.state).toBe("identical");
    expect(out.detail).toMatchObject({
      truth: [{ seed: 1, equal: true }, { seed: 2, equal: true }, { seed: 3, equal: true }],
      repeats_equal: true,
      cells_equal: true,
    });
    expect(out.detail.reason).toBeUndefined();
  });

  it("Given a clock that moves 10 per call Then the detail holds the five timed runs of seed 1, in order, and none for seeds 2 and 3", async () => {
    const out = await runCheck(await reference(), fakeDeps());
    expect(out.detail.runs_ms).toEqual([10, 20, 30, 40, 50]);
  });
});

describe("runCheck: failed (a strict difference in any one part; there is no softer state)", () => {
  it.each(["seed1", "seed2", "seed3"] as const)("Given a reference whose %s hash differs by one digit Then the state is failed and only that seed reads unequal", async (where) => {
    const out = await runCheck(flipped(await reference(), where), fakeDeps());
    expect(out.state).toBe("failed");
    expect(out.detail.truth.filter((t) => !t.equal).map((t) => `seed${t.seed}`)).toEqual([where]);
    expect(out.detail.repeats_equal).toBe(true);
    expect(out.detail.cells_equal).toBe(true);
  });

  it("Given a reference whose cell digest differs by one digit Then the state is failed, cells_equal is false and the truth parts are equal", async () => {
    const out = await runCheck(flipped(await reference(), "cells"), fakeDeps());
    expect(out.state).toBe("failed");
    expect(out.detail).toMatchObject({ cells_equal: false, repeats_equal: true });
    expect(out.detail.truth.every((t) => t.equal)).toBe(true);
  });

  it("Given a browser whose third repeat of seed 1 differs from the others Then repeats_equal is false and the state is failed even if the first repeat equals the reference", async () => {
    let n = 0;
    const deps = fakeDeps({ truth: async (seed) => ({ log_hash: seed === 1 && ++n === 3 ? HASH("9") : HASH(String(seed)), ms: 1 }) });
    const out = await runCheck(await reference(), deps);
    expect(out.state).toBe("failed");
    expect(out.detail.repeats_equal).toBe(false);
    expect(out.detail.truth[0]).toEqual({ seed: 1, equal: true });
  });

  it("Given a browser that gives other cells than the reference Then cells_equal is false", async () => {
    const out = await runCheck(await reference(), fakeDeps({ cells: async () => ({ architectures: ARCHITECTURES, digest: HASH("d") }) }));
    expect(out.state).toBe("failed");
    expect(out.detail.cells_equal).toBe(false);
  });

  it("Given cells recorded for other architectures than the reference's Then cells_equal is false even if the digest matches", async () => {
    const out = await runCheck(await reference(), fakeDeps({ cells: async () => ({ architectures: ["a_manual", "c_context"], digest: HASH("c") }) }));
    expect(out.detail.cells_equal).toBe(false);
  });
});

describe("runCheck: error (the check could not run)", () => {
  it.each([
    ["missing", undefined],
    ["not an object", "reference"],
    ["without a schema_version", { truth: [], cells: {} }],
  ])("Given a reference that is %s Then the state is error and the reason says the reference is unusable", async (_name, ref) => {
    const out = await runCheck(ref, fakeDeps());
    expect(out.state).toBe("error");
    expect(out.detail.reason).toMatch(/reference/);
    expect(out.detail.runs_ms).toEqual([]);
  });

  it("Given a reference that lacks seed 3 Then the state is error and the reason names the seed", async () => {
    const ref = await reference();
    const out = await runCheck({ ...ref, truth: ref.truth.slice(0, 2) }, fakeDeps());
    expect(out).toMatchObject({ state: "error", detail: { reason: expect.stringMatching(/seed 3/) } });
  });

  it("Given a reference whose hash is not 64 hex digits Then the state is error", async () => {
    const ref = await reference();
    const out = await runCheck({ ...ref, cells: { ...ref.cells, digest: "xyz" } }, fakeDeps());
    expect(out).toMatchObject({ state: "error", detail: { reason: expect.stringMatching(/digest/) } });
  });

  it("Given deps that throw Then the state is error with the message as the reason, not a crash", async () => {
    const out = await runCheck(await reference(), fakeDeps({ truth: async () => Promise.reject(new Error("boom")) }));
    expect(out).toMatchObject({ state: "error", detail: { reason: "boom" } });
  });

  describe("without crypto.subtle", () => {
    afterEach(() => vi.unstubAllGlobals());
    it("Given a browser without crypto.subtle (an insecure context) Then the state is error and the reason says so", async () => {
      const ref = await reference();
      vi.stubGlobal("crypto", {});
      const out = await runCheck(ref, fakeDeps());
      expect(out).toMatchObject({ state: "error", detail: { reason: expect.stringMatching(/crypto\.subtle/) } });
    });
  });
});

describe("the real engine", () => {
  const goldenHash = (seed: number): string => readJson<{ log_hash: string }>("tests", "golden", `default_seed${seed}.summary.json`).log_hash;

  it("Given the bundled data and a clock When the reference is computed Then its truth hashes equal the log_hash of the goldens, and the check against it reads identical", async () => {
    let t = 0;
    const deps = makeDeps(labData(), () => (t += 3));
    const ref = await computeReference(deps, NODE);
    expect(ref.truth).toEqual([1, 2, 3].map((seed) => ({ seed, log_hash: goldenHash(seed) })));
    expect(ref.cells.architectures).toEqual(ARCHITECTURES);
    expect(ref.cells.digest).toMatch(/^[0-9a-f]{64}$/);

    const out = await runCheck(ref, deps);
    expect(out.state).toBe("identical");
    // each timed run reads the clock twice (START before runScenario, STOP after it), so with a clock that moves 3 per call each run measured exactly 3
    expect(out.detail.runs_ms).toEqual([3, 3, 3, 3, 3]);
  }, 60_000);

  it("Given the bundled data When the check runs against a reference with one wrong hash digit Then the state is failed", async () => {
    const deps = makeDeps(labData(), () => 0);
    const ref = await computeReference(deps, NODE);
    const out = await runCheck(flipped(ref, "seed2"), deps);
    expect(out.state).toBe("failed");
    expect(out.detail.truth.map((t) => t.equal)).toEqual([true, false, true]);
  }, 60_000);
});
