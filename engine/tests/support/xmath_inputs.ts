import { createRng } from "../../src/rng.ts";

// 2026-10-30 S3m (ADR-0019): the fixed, seeded inputs of the xmath property test. No Node import, so the cross-engine probe bundles this file for the browsers
// and hashes the same outputs there. Each set holds the arguments its call sites pass, then a wider sweep of the ported range, then the branch edges of the source.
// No input gives a NaN (the bit pattern of a NaN stored in a Float64Array is left to the engine, so it would not compare across engines).

/** Arguments drawn the way the engine draws them, per function. */
export const ENGINE_COUNT = 100_000;
/** Arguments spread over the ported range, per function. */
export const WIDE_COUNT = 20_000;

export interface XmathInputs {
  log: Float64Array;
  cos: Float64Array;
  exp: Float64Array;
}

const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);
const i64 = new BigInt64Array(f64.buffer);
f64[0] = 1;
const HI = u32[1] === 0x3ff00000 ? 1 : 0;
const SIGN = 1n << 63n;

/** The double with these high and low 32-bit words. */
export const fromWords = (hi: number, lo: number): number => {
  u32[HI] = hi;
  u32[1 - HI] = lo;
  return f64[0] as number;
};

/** The position of a double on the ulp scale: consecutive doubles are consecutive integers, across zero too (+0 and -0 are both 0). */
export const ord = (x: number): bigint => {
  f64[0] = x;
  const b = i64[0] as bigint;
  return b < 0n ? -(b & (SIGN - 1n)) : b;
};
const fromOrd = (o: bigint): number => {
  i64[0] = o < 0n ? BigInt.asIntN(64, -o | SIGN) : o;
  return f64[0] as number;
};
/** x and its neighbours two ulps down and up. */
const around = (x: number): number[] => [-2n, -1n, 0n, 1n, 2n].map((d) => fromOrd(ord(x) + d));

const PIO2 = Math.PI / 2;
/** The first and last double of a high word, and the first of the next one: the tests on high words in the source switch there. */
const words = (highs: number[]): number[] => highs.flatMap((h) => [fromWords(h, 0), fromWords(h, 0xffffffff), fromWords(h + 1, 0)]);
const signed = (xs: number[]): number[] => xs.flatMap((x) => [x, -x]);
/** Branch edges of e_log.c, e_exp.c, s_cos.c and e_rem_pio2.c: the values the comments name with their neighbours, and the high words the code tests. */
const EDGES = {
  // 1 and the band |f| < 2^-20 around it, 2^-53 (the smallest 1 - u), the smallest normal and subnormal, the largest double, 0, +Infinity; the subnormal, sqrt(2)
  // normalisation and polynomial switch words
  log: [
    ...[1, 1 + 1 / 1048576, 1 - 1 / 1048576, 1 / 9007199254740992, 2.2250738585072014e-308, 5e-324, 1.7976931348623157e308, 0.5, 2, Math.SQRT2, Math.SQRT1_2].flatMap(around),
    ...words([0x00100000, 0x3ff6a09c, 0x3fe6a09c, 0x3ff6147a, 0x3fe6147a, 0x3ff6b851, 0x3fe6b851]),
  ].filter((x) => x >= 0),
  // 0, 2^-28, 0.5 ln2 and 1.5 ln2, the overflow and underflow thresholds, 1022 ln2 (the switch of twopk), each signed; the words of those tests
  exp: [
    ...signed([0, 3.725290298461914e-9, 0.34657359027997264, 1.0397207708399179, 709.782712893384, 745.1332191019411, 708.3964185322641]).flatMap(around),
    ...signed(words([0x3e300000, 0x3fd62e42, 0x3ff0a2b2, 0x40862e42])),
  ],
  // 0, 2^-27 sqrt(2), the odd multiples of pi/4 up to 9 pi/4 and the multiples of pi/2 up to 2 pi (the medium case of e_rem_pio2.c), each signed; the words of those tests
  cos: [
    ...signed([0, 1.0536712127723509e-8, Math.PI / 4, 3 * Math.PI / 4, 5 * Math.PI / 4, 7 * Math.PI / 4, 9 * Math.PI / 4, PIO2, Math.PI, 3 * PIO2, 2 * Math.PI]).flatMap(around),
    ...signed(words([0x3e46a09e, 0x3fe921fb, 0x4002d97c, 0x400f6a7a, 0x4012d97c, 0x4015fdbc, 0x401921fb, 0x401c463b])),
  ],
};

export const xmathInputs = (): XmathInputs => {
  const s = createRng().stream([1, "xmath", "-", 0, "property"]);
  const set = (engine: () => number, wide: () => number, edges: number[]): Float64Array => {
    const out = new Float64Array(ENGINE_COUNT + WIDE_COUNT + edges.length);
    for (let i = 0; i < ENGINE_COUNT; i++) out[i] = engine();
    for (let i = ENGINE_COUNT; i < ENGINE_COUNT + WIDE_COUNT; i++) out[i] = wide();
    out.set(edges, ENGINE_COUNT + WIDE_COUNT);
    return out;
  };
  return {
    // rng.ts: log(1 - u), u a float() draw; wide: every positive finite double by its bit pattern, subnormals included
    log: set(() => 1 - s.float(), () => fromWords(s.int(0, 0x7fefffff), s.int(0, 0xffffffff)), EDGES.log),
    // rng.ts: cos(2 pi u); wide: |x| < 1.6e6, inside the ported range 2^20 pi/2
    cos: set(() => 2 * Math.PI * s.float(), () => (2 * s.float() - 1) * 1.6e6, EDGES.cos),
    // sensors.ts and stability.ts: exp(-a / b), whole seconds over a time constant in whole seconds; wide: [-746, 710), past both thresholds
    exp: set(() => -s.int(0, 3_000_000) / s.int(1, 100_000), () => s.float() * 1456 - 746, EDGES.exp),
  };
};
