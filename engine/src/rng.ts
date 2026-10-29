import { uniformFloat64 } from "pure-rand/distribution/uniformFloat64";
import { uniformInt } from "pure-rand/distribution/uniformInt";
import { xoroshiro128plusFromState } from "pure-rand/generator/xoroshiro128plus";

// Keyed streams (prompts/10 Step 1, RNG row). One canonical key tuple everywhere:
//   (run_seed, physical_sample_id, analyte, attempt, purpose)
// and a draw that belongs to a unit, an instrument or a generator puts that entity's id in the second slot and "-", 0 after it.
// Stream seed = splitmix64-based hash of the canonical key string, in BigInt modulo 2^64, synchronous.
//
// Install check (pure-rand 8.4.2): xoroshiro128plus(seed) takes a 32-bit seed (seed | 0), narrower than the 64-bit stream seed.
// Nothing is truncated: the generator is built from its four 32-bit state words with xoroshiro128plusFromState, and the
// words are two successive outputs of the splitmix64 sequence seeded with the stream seed.

export type StreamKey = readonly [runSeed: number, id: string, analyte: string, attempt: number, purpose: string];

export interface Stream {
  /** Uniform in [0, 1). */
  float(): number;
  /** Uniform integer in [from, to], both included. */
  int(from: number, to: number): number;
  /** Standard normal (Box-Muller, one variate per call). */
  gaussian(): number;
  /** Exponential with the given mean, strictly positive. */
  exponential(mean: number): number;
}

export interface Rng {
  stream(key: StreamKey): Stream;
}

export const SEP = "\u001f";
const MASK = (1n << 64n) - 1n;
const GOLDEN = 0x9e3779b97f4a7c15n;

const mix = (z0: bigint): bigint => {
  const z1 = ((z0 ^ (z0 >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK;
  const z2 = ((z1 ^ (z1 >> 27n)) * 0x94d049bb133111ebn) & MASK;
  return z2 ^ (z2 >> 31n);
};

/** The splitmix64 sequence: state += golden gamma, output = mix(state). */
export const splitmix64 = (seed: bigint): (() => bigint) => {
  let state = seed & MASK;
  return () => {
    state = (state + GOLDEN) & MASK;
    return mix(state);
  };
};

/** Hash of a string: the length seeds the state, then four UTF-16 code units per block go through the splitmix64 mix. */
export const hashString = (s: string): bigint => {
  let h = BigInt(s.length);
  for (let i = 0; i < s.length; i += 4) {
    const lo = (s.charCodeAt(i) | ((s.charCodeAt(i + 1) || 0) << 16)) >>> 0;
    const hi = ((s.charCodeAt(i + 2) || 0) | ((s.charCodeAt(i + 3) || 0) << 16)) >>> 0;
    h = mix((h + ((BigInt(hi) << 32n) | BigInt(lo)) + GOLDEN) & MASK);
  }
  return h;
};

const wholeNumber = (n: number, what: string): void => {
  if (!Number.isInteger(n) || n < 0) throw new Error(`stream key: ${what} must be a non-negative integer, got ${String(n)}`);
};

export const canonicalKey = (key: StreamKey): string => {
  const [runSeed, id, analyte, attempt, purpose] = key;
  wholeNumber(runSeed, "run_seed");
  wholeNumber(attempt, "attempt");
  for (const field of [id, analyte, purpose]) {
    if (field === "" || field.includes(SEP)) throw new Error(`stream key: a field is empty or contains the separator: ${JSON.stringify(field)}`);
  }
  return [runSeed, id, analyte, attempt, purpose].join(SEP);
};

export const streamSeed = (key: StreamKey): bigint => hashString(canonicalKey(key));

/** Four signed 32-bit state words from two splitmix64 outputs (high word first). */
export const wordsFromSeed = (seed: bigint): [number, number, number, number] => {
  const next = splitmix64(seed);
  const a = next();
  const b = next();
  const w = (x: bigint): number => Number(BigInt.asIntN(32, x));
  return [w(a >> 32n), w(a), w(b >> 32n), w(b)];
};

/** Key of a draw that belongs to a unit, an instrument or a generator. */
export const entityKey = (runSeed: number, entityId: string, purpose: string): StreamKey => [runSeed, entityId, "-", 0, purpose];

export const createRng = (onKey?: (key: StreamKey) => void): Rng => ({
  stream(key) {
    onKey?.(key);
    const gen = xoroshiro128plusFromState(wordsFromSeed(streamSeed(key)));
    const float = (): number => uniformFloat64(gen);
    return {
      float,
      int: (from, to) => uniformInt(gen, from, to),
      gaussian: () => Math.sqrt(-2 * Math.log(1 - float())) * Math.cos(2 * Math.PI * float()),
      exponential: (mean) => -mean * Math.log(1 - float()),
    };
  },
});
