import { describe, expect, it } from "vitest";
import { SEP, canonicalKey, createRng, entityKey, hashString, splitmix64, streamSeed, wordsFromSeed } from "../../src/rng.ts";
import type { StreamKey } from "../../src/rng.ts";

// Expected values come from an independent Python implementation of the construction in docs/prompts/10 Step 1
// (splitmix64 mix, 4 UTF-16 code units per block), not from the engine.
describe("Contract: RNG key and stream seed", () => {
  it("splitmix64 from seed 0 yields the published reference outputs", () => {
    const next = splitmix64(0n);
    expect([next(), next(), next()]).toEqual([0xe220a8397b1dcdafn, 0x6e789e6aa1b965f4n, 0x06c45d188009454fn]);
  });

  it("the canonical key is the five fields joined by a separator no id can contain", () => {
    expect(canonicalKey([1, "P", "glucose", 2, "noise"])).toBe(["1", "P", "glucose", "2", "noise"].join(SEP));
    expect(() => canonicalKey([1, `P${SEP}x`, "glucose", 1, "noise"])).toThrow();
    expect(() => canonicalKey([1.5, "P", "glucose", 1, "noise"])).toThrow();
    expect(() => canonicalKey([1, "P", "glucose", -1, "noise"])).toThrow();
  });

  it("a draw that belongs to a unit, an instrument or a generator uses the entity id in slot two and '-', 0 after it", () => {
    expect(entityKey(7, "U03", "sensor")).toEqual([7, "U03", "-", 0, "sensor"]);
  });

  it("the string hash matches the reference vectors", () => {
    expect(hashString("")).toBe(0n);
    expect(hashString("a")).toBe(0xf0eea8c8a0607d15n);
    expect(hashString("abcd")).toBe(0x4e120d56952d31b9n);
    expect(hashString("abcde")).toBe(0xb962a309c36822b0n);
  });

  it("the stream seed is the hash of the canonical key string, computed synchronously", () => {
    const seed = streamSeed([1, "P", "glucose", 1, "noise"]);
    expect(typeof seed).toBe("bigint");
    expect(seed).toBe(0xe3b8ac3b728edf3dn);
    expect(streamSeed([1, "P", "glucose", 2, "noise"])).toBe(0xdf8aa350902f763fn);
    expect(streamSeed([2, "P", "glucose", 1, "noise"])).toBe(0xb00fb3670be23630n);
    expect(streamSeed([1, "0", "-", 0, "arrival"])).toBe(0x5d6d5c011d70951cn);
  });

  it("every field of the tuple changes the stream seed (the attempt slot included)", () => {
    const base: StreamKey = [1, "P", "glucose", 1, "noise"];
    const variants: StreamKey[] = [
      [2, "P", "glucose", 1, "noise"],
      [1, "Q", "glucose", 1, "noise"],
      [1, "P", "lactate", 1, "noise"],
      [1, "P", "glucose", 2, "noise"],
      [1, "P", "glucose", 1, "arrival"],
    ];
    for (const v of variants) expect(streamSeed(v)).not.toBe(streamSeed(base));
  });

  it("PRNG seed width: a 128-bit state is built from two splitmix64 outputs, nothing is truncated", () => {
    // pure-rand 8.4.2 xoroshiro128plus(seed) takes a 32-bit seed; the state setter takes four 32-bit words.
    expect(wordsFromSeed(0n)).toEqual([-501176263, 2065550767, 1853398634, -1581685260]);
    expect(wordsFromSeed(1n << 40n)).toEqual([534606120, -217005175, 98856899, -314010962]);
    expect(wordsFromSeed(1n << 40n)).not.toEqual(wordsFromSeed(0n));
    expect(wordsFromSeed(streamSeed([1, "P", "glucose", 1, "noise"]))).toEqual([270174983, 1710294490, 1378954761, -1638241405]);
  });

  it("the same key gives the same draws; a different key gives different draws", () => {
    const rng = createRng();
    const a = rng.stream([1, "P", "glucose", 1, "noise"]);
    const b = rng.stream([1, "P", "glucose", 1, "noise"]);
    const c = rng.stream([1, "P", "glucose", 2, "noise"]);
    const da = [a.gaussian(), a.gaussian(), a.float()];
    expect([b.gaussian(), b.gaussian(), b.float()]).toEqual(da);
    expect([c.gaussian(), c.gaussian(), c.float()]).not.toEqual(da);
  });

  it("draw ranges: float in [0,1), int inclusive, exponential positive with the given mean", () => {
    const s = createRng().stream([3, "gen", "-", 0, "range"]);
    let sum = 0;
    for (let i = 0; i < 20000; i++) {
      const f = s.float();
      expect(f >= 0 && f < 1).toBe(true);
      const n = s.int(3, 5);
      expect(n >= 3 && n <= 5 && Number.isInteger(n)).toBe(true);
      const e = s.exponential(100);
      expect(e).toBeGreaterThan(0);
      sum += e;
    }
    expect(sum / 20000).toBeGreaterThan(95);
    expect(sum / 20000).toBeLessThan(105);
  });

  it("the key observer sees every stream handed out (the collision test enumerates streams from the run itself)", () => {
    const seen: StreamKey[] = [];
    const rng = createRng((k) => seen.push(k));
    rng.stream([1, "A", "x", 1, "noise"]);
    rng.stream([1, "B", "x", 1, "noise"]);
    expect(seen).toEqual([
      [1, "A", "x", 1, "noise"],
      [1, "B", "x", 1, "noise"],
    ]);
  });
});
