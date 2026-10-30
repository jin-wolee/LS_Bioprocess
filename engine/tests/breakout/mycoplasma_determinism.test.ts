import { describe, expect, it } from "vitest";
import { canonicalKey, streamSeed } from "../../src/rng.ts";
import type { StreamKey } from "../../src/rng.ts";
import { canonicalJsonl, logHash } from "../../src/trace.ts";
import type { Json } from "../support/schemas.ts";
import { docOf, eventsOf, h, runOfDoc, set } from "./support.ts";
import { docOfM, fx12m } from "./support_m.ts";

// Invariant 2 and rule S5 for the mycoplasma type: seeded integer PRNG only, one canonical key tuple (run_seed, physical_sample_id, analyte, attempt, purpose). The multiplier moment and the three
// tests draw nothing; the only keyed draw of the script is still the operator of a confirming draw, key (run_seed, confirming_sample_id, "-", 0, "confirm"), one per confirmed unit (three aliquots
// of one physical sample share the draw). The batch-2 tests enumerate the keys of the bacterial layouts; these do it for FX12m and for the slow layout whose multiplier moments are applied.

const keysOf = (doc: Json): StreamKey[] => {
  const keys: StreamKey[] = [];
  runOfDoc(doc, { onKey: (k) => void keys.push(k) });
  return keys;
};
const SLOW = set(fx12m({ plateau: 2, growth: 0.5, fall: 3, death: 2 }), "lag", h(96, "A138"));

describe("Determinism of the mycoplasma script", () => {
  it("Given the same scenario and seed When it runs twice Then the truth log is byte-identical (canonical JSONL and hash)", async () => {
    const a = runOfDoc(docOfM(fx12m()));
    const b = runOfDoc(docOfM(fx12m()));
    expect(canonicalJsonl(a.events)).toBe(canonicalJsonl(b.events));
    expect(await logHash(a.events)).toBe(await logHash(b.events));
    expect(canonicalJsonl(a.observable)).toBe(canonicalJsonl(b.observable));
  });

  it("Given another seed When it runs Then the log differs (the script is the same, the keyed draws are not)", async () => {
    const a = runOfDoc(docOfM(fx12m()));
    const b = runOfDoc({ ...docOfM(fx12m()), seed: 2 });
    expect(await logHash(a.events)).not.toBe(await logHash(b.events));
  });

  it("Given FX12m, with and without applied multiplier moments When every stream key of the run is enumerated Then no stream is asked for twice and no two keys hash to one stream seed", () => {
    for (const doc of [docOfM(fx12m()), docOfM(SLOW, { horizon_days: 33 })]) {
      const keys = keysOf(doc);
      expect(keys.length).toBeGreaterThan(50);
      expect(new Set(keys.map(canonicalKey)).size).toBe(keys.length);
      expect(new Set(keys.map(streamSeed)).size).toBe(keys.length);
    }
  });

  it("Given two confirmed units When the keys are enumerated Then the script adds exactly one key per confirming sample: (seed, sample id, -, 0, confirm), not one per aliquot, and none for a moment", () => {
    const keys = keysOf(docOfM(SLOW, { horizon_days: 33 }));
    expect(keys.filter((k) => k[4] === "confirm")).toEqual([[1, "U01-CONF", "-", 0, "confirm"], [1, "U02-CONF", "-", 0, "confirm"]]);
  });

  it("Given the run with the moments applied When its keys are compared with the same scenario without a break-out block Then every key of the run is a key the plain run asks for too (the stopped unit asks for fewer, never for others)", () => {
    const plain = new Set(keysOf(docOf(undefined, { horizon_days: 33 })).map(canonicalKey));
    const keys = keysOf(docOfM(SLOW, { horizon_days: 33 })).filter((k) => k[4] !== "confirm").map(canonicalKey);
    expect(keys.length).toBeGreaterThan(50);
    expect(keys.filter((k) => !plain.has(k))).toEqual([]);
  });

  it("Given a confirmed unit is added to the confirm list When the run repeats Then the confirming draws of the units already in it do not change (a draw never shifts another)", () => {
    const one = eventsOf(runOfDoc(docOfM(set(fx12m(), "confirm", ["U01"]))), "confirm_sample_drawn");
    const two = eventsOf(runOfDoc(docOfM(fx12m())), "confirm_sample_drawn");
    expect(one.length).toBe(1);
    expect(two[0]).toEqual(one[0]);
  });
});
