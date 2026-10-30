// Deterministic log, exp and cos for the engine (ADR-0019). ECMAScript leaves Math.log, Math.exp, Math.cos and the exponent operator
// "implementation-approximated", and the JavaScript engines give different last digits. These functions use only +, -, *, /, comparisons,
// exact integer operations and the words of a Float64Array, which IEEE 754 and ECMAScript define exactly, so a seed gives the same bytes in every engine.
//
// Origin: FreeBSD msun, src tag release/14.1.0, lib/msun/src: e_log.c (log), e_exp.c (exp), s_cos.c (cos), k_cos.c (__kernel_cos), k_sin.c
// (__kernel_sin), e_rem_pio2.c (__ieee754_rem_pio2) and rnint and irint of math_private.h. Ported statement for statement: the names, the branch
// order and the constants with their hexadecimal words are the C source's, so the two can be read side by side; the comments are shortened.
// Accuracy, per the sources: log and exp below 1 ulp, cos "nearly rounded". Not ported: __kernel_rem_pio2 (k_rem_pio2.c), the reduction of
// |x| from about 2^20 pi/2 up; cos refuses those arguments (the engine passes 2 pi u with u in [0, 1)).
// Licence: the notice of the source files, preserved as it asks. s_cos.c reads "SunPro" for "SunSoft"; e_exp.c is "Copyright (C) 2004" without
// the "Developed at" line; e_rem_pio2.c adds "Optimized by Bruce D. Evans."
//   ====================================================
//   Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.
//
//   Developed at SunSoft, a Sun Microsystems, Inc. business.
//   Permission to use, copy, modify, and distribute this
//   software is freely granted, provided that this notice
//   is preserved.
//   ====================================================

// GET_HIGH_WORD, GET_LOW_WORD, SET_HIGH_WORD and INSERT_WORDS of math_private.h, on one 8-byte buffer. The index of the high word follows the
// platform's byte order. The high word is read signed (int32_t), the low word unsigned (u_int32_t), as the C declarations read them.
const f64 = new Float64Array(1);
const i32 = new Int32Array(f64.buffer);
const u32 = new Uint32Array(f64.buffer);
f64[0] = 1;
const HI = u32[1] === 0x3ff00000 ? 1 : 0;
const LO = 1 - HI;
const highWord = (x: number): number => { f64[0] = x; return i32[HI] as number; };
const lowWord = (x: number): number => { f64[0] = x; return u32[LO] as number; };
const setHighWord = (x: number, hi: number): number => { f64[0] = x; i32[HI] = hi; return f64[0] as number; };
const insertWords = (hi: number, lo: number): number => { i32[HI] = hi; u32[LO] = lo; return f64[0] as number; };

const zero = 0.00000000000000000000e+00; // 0x00000000 0x00000000
const one = 1.00000000000000000000e+00; // 0x3ff00000 0x00000000
const half = 5.00000000000000000000e-01; // 0x3fe00000 0x00000000

// ---- e_log.c ----------------------------------------------------------------------------------------------------------------------
// x = 2^k (1 + f) with sqrt(2)/2 < 1 + f < sqrt(2); log(1 + f) = 2s + s R(s^2), s = f / (2 + f), R a degree-14 polynomial (Lg1 to Lg7).
const ln2_hi = 6.93147180369123816490e-01; // 0x3fe62e42 0xfee00000
const ln2_lo = 1.90821492927058770002e-10; // 0x3dea39ef 0x35793c76
const two54 = 1.80143985094819840000e+16; // 0x43500000 0x00000000
const Lg1 = 6.666666666666735130e-01; // 0x3fe55555 0x55555593
const Lg2 = 3.999999999940941908e-01; // 0x3fd99999 0x9997fa04
const Lg3 = 2.857142874366239149e-01; // 0x3fd24924 0x94229359
const Lg4 = 2.222219843214978396e-01; // 0x3fcc71c5 0x1d8e78af
const Lg5 = 1.818357216161805012e-01; // 0x3fc74664 0x96cb03de
const Lg6 = 1.531383769920937332e-01; // 0x3fc39a09 0xd078c69f
const Lg7 = 1.479819860511658591e-01; // 0x3fc2f112 0xdf3e5244
const vzero = zero;

/** Natural logarithm. log(+-0) = -Infinity, log(x < 0) = NaN, log(+Infinity) = +Infinity, log(NaN) = NaN. */
export const log = (xIn: number): number => {
  let x = xIn;
  let R: number, dk: number, i: number;
  let hx = highWord(x);
  const lx = lowWord(x);
  let k = 0;
  if (hx < 0x00100000) { // x < 2^-1022
    if (((hx & 0x7fffffff) | lx) === 0) return -two54 / vzero; // log(+-0) = -inf
    if (hx < 0) return (x - x) / zero; // log(-#) = NaN
    k -= 54; x *= two54; // subnormal number, scale up x
    hx = highWord(x);
  }
  if (hx >= 0x7ff00000) return x + x;
  k += (hx >> 20) - 1023;
  hx &= 0x000fffff;
  i = (hx + 0x95f64) & 0x100000;
  x = setHighWord(x, hx | (i ^ 0x3ff00000)); // normalize x or x/2
  k += i >> 20;
  const f = x - 1.0;
  if ((0x000fffff & (2 + hx)) < 3) { // -2^-20 <= f < 2^-20
    if (f === zero) {
      if (k === 0) return zero;
      dk = k;
      return dk * ln2_hi + dk * ln2_lo;
    }
    R = f * f * (0.5 - 0.3333333333333333 * f); // 0.33333333333333333 in the source, the same double
    if (k === 0) return f - R;
    dk = k;
    return dk * ln2_hi - ((R - dk * ln2_lo) - f);
  }
  const s = f / (2.0 + f);
  dk = k;
  const z = s * s;
  i = hx - 0x6147a;
  const w = z * z;
  const j = 0x6b851 - hx;
  const t1 = w * (Lg2 + w * (Lg4 + w * Lg6));
  const t2 = z * (Lg1 + w * (Lg3 + w * (Lg5 + w * Lg7)));
  i |= j;
  R = t2 + t1;
  if (i > 0) {
    const hfsq = 0.5 * f * f;
    if (k === 0) return f - (hfsq - s * (hfsq + R));
    return dk * ln2_hi - ((hfsq - (s * (hfsq + R) + dk * ln2_lo)) - f);
  }
  if (k === 0) return f - s * (f - R);
  return dk * ln2_hi - ((s * (f - R) - dk * ln2_lo) - f);
};

// ---- e_exp.c ----------------------------------------------------------------------------------------------------------------------
// x = k ln2 + r with |r| <= 0.5 ln2 (r = hi - lo); exp(r) = 1 + r + r R1(r) / (2 - R1(r)), R1 a degree-5 polynomial in r^2 (P1 to P5); exp(x) = 2^k exp(r).
const halF = [0.5, -0.5] as const;
const o_threshold = 7.09782712893383973096e+02; // 0x40862e42 0xfefa39ef
const u_threshold = -7.45133219101941108420e+02; // 0xc0874910 0xd52d3051
const ln2HI = [
  6.93147180369123816490e-01, // 0x3fe62e42 0xfee00000
  -6.93147180369123816490e-01, // 0xbfe62e42 0xfee00000
] as const;
const ln2LO = [
  1.90821492927058770002e-10, // 0x3dea39ef 0x35793c76
  -1.90821492927058770002e-10, // 0xbdea39ef 0x35793c76
] as const;
const invln2 = 1.44269504088896338700e+00; // 0x3ff71547 0x652b82fe
const P1 = 1.66666666666666019037e-01; // 0x3fc55555 0x5555553e
const P2 = -2.77777777770155933842e-03; // 0xbf66c16c 0x16bebd93
const P3 = 6.61375632143793436117e-05; // 0x3f11566a 0xaf25de2c
const P4 = -1.65339022054652515390e-06; // 0xbebbbd41 0xc5d26bf1
const P5 = 4.13813679705723846039e-08; // 0x3e663769 0x72bea4d0
const huge = 1.0e+300;
const twom1000 = 9.33263618503218878990e-302; // 0x01700000 0x00000000
const twop1023 = 8.98846567431157953865e+307; // 0x7fe00000 0x00000000 (0x1p1023 of the source)

/** e^x. exp(+Infinity) = +Infinity, exp(-Infinity) = +0, exp(NaN) = NaN; only exp(0) = 1 is exact for a finite argument. */
export const exp = (xIn: number): number => {
  let x = xIn;
  let y: number, hi = 0.0, lo = 0.0, t: number, twopk: number;
  let k = 0;
  let hx = highWord(x);
  const xsb = (hx >>> 31) & 1; // sign bit of x
  hx &= 0x7fffffff; // high word of |x|
  // filter out non-finite argument
  if (hx >= 0x40862e42) { // if |x| >= 709.78...
    if (hx >= 0x7ff00000) {
      const lx = lowWord(x);
      if (((hx & 0xfffff) | lx) !== 0) return x + x; // NaN
      else return xsb === 0 ? x : 0.0; // exp(+-inf) = {inf, 0}
    }
    if (x > o_threshold) return huge * huge; // overflow
    if (x < u_threshold) return twom1000 * twom1000; // underflow
  }
  // argument reduction
  if (hx > 0x3fd62e42) { // if |x| > 0.5 ln2
    if (hx < 0x3ff0a2b2) { // and |x| < 1.5 ln2
      hi = x - (ln2HI[xsb] as number); lo = ln2LO[xsb] as number; k = 1 - xsb - xsb;
    } else {
      k = (invln2 * x + (halF[xsb] as number)) | 0; // (int) truncates toward zero, as | 0 does
      t = k;
      hi = x - t * ln2HI[0]; // t*ln2HI is exact here
      lo = t * ln2LO[0];
    }
    x = hi - lo;
  } else if (hx < 0x3e300000) { // when |x| < 2^-28
    if (huge + x > one) return one + x; // trigger inexact
  } else k = 0;
  // x is now in primary range
  t = x * x;
  if (k >= -1021) twopk = insertWords((0x3ff + k) << 20, 0);
  else twopk = insertWords((0x3ff + (k + 1000)) << 20, 0);
  const c = x - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
  if (k === 0) return one - ((x * c) / (c - 2.0) - x);
  else y = one - ((lo - (x * c) / (2.0 - c)) - hi);
  if (k >= -1021) {
    if (k === 1024) return y * 2.0 * twop1023;
    return y * twopk;
  } else {
    return y * twopk * twom1000;
  }
};

// ---- k_cos.c, k_sin.c ---------------------------------------------------------------------------------------------------------------
// cos and sin on [-pi/4, pi/4] by polynomials of degree 14 and 13; y is the tail of x.
const C1 = 4.16666666666666019037e-02; // 0x3fa55555 0x5555554c
const C2 = -1.38888888888741095749e-03; // 0xbf56c16c 0x16c15177
const C3 = 2.48015872894767294178e-05; // 0x3efa01a0 0x19cb1590
const C4 = -2.75573143513906633035e-07; // 0xbe927e4f 0x809c52ad
const C5 = 2.08757232129817482790e-09; // 0x3e21ee9e 0xbdb4b1c4
const C6 = -1.13596475577881948265e-11; // 0xbda8fae9 0xbe8838d4

const kernelCos = (x: number, y: number): number => {
  const z = x * x;
  let w = z * z;
  const r = z * (C1 + z * (C2 + z * C3)) + w * w * (C4 + z * (C5 + z * C6));
  const hz = 0.5 * z;
  w = one - hz;
  return w + (((one - w) - hz) + (z * r - x * y));
};

const S1 = -1.66666666666666324348e-01; // 0xbfc55555 0x55555549
const S2 = 8.33333333332248946124e-03; // 0x3f811111 0x1110f8a6
const S3 = -1.98412698298579493134e-04; // 0xbf2a01a0 0x19c161d5
const S4 = 2.75573137070700676789e-06; // 0x3ec71de3 0x57b1fe7d
const S5 = -2.50507602534068634195e-08; // 0xbe5ae5e6 0x8a2b9ceb
const S6 = 1.58969099521155010221e-10; // 0x3de5d93a 0x5acfd57c

const kernelSin = (x: number, y: number, iy: number): number => {
  const z = x * x;
  const w = z * z;
  const r = S2 + z * (S3 + z * S4) + z * w * (S5 + z * S6);
  const v = z * x;
  if (iy === 0) return x + v * (S1 + z * r);
  else return x - ((z * (half * y - v * r) - y) - v * S1);
};

// ---- e_rem_pio2.c (and rnint, irint of math_private.h) ----------------------------------------------------------------------------
// The remainder of x rem pi/2 in y0 + y1 (y[0] and y[1] of the source); returns n, the quadrant count. pi/2 is split in three parts of 33 bits.
const toint = 6.75539944105574400000e+15; // 0x43380000 0x00000000 (0x1.8p52 of rnint)
const invpio2 = 6.36619772367581382433e-01; // 0x3fe45f30 0x6dc9c883
const pio2_1 = 1.57079632673412561417e+00; // 0x3ff921fb 0x54400000
const pio2_1t = 6.07710050650619224932e-11; // 0x3dd0b461 0x1a626331
const pio2_2 = 6.07710050630396597660e-11; // 0x3dd0b461 0x1a600000
const pio2_2t = 2.02226624879595063154e-21; // 0x3ba3198a 0x2e037073
const pio2_3 = 2.02226624871116645580e-21; // 0x3ba3198a 0x2e000000
const pio2_3t = 8.47842766036889956997e-32; // 0x397b839a 0x252049c1

let y0 = 0, y1 = 0;
const rnint = (x: number): number => (x + toint) - toint;
const irint = (x: number): number => x | 0; // (int)(x) of an integral x

/** The medium case of __ieee754_rem_pio2: |x| ~< 2^20 (pi/2), and the multiples of pi/2 where the small cases would cancel. */
const medium = (x: number, ix: number): number => {
  let w: number, t: number, r: number;
  const fn = rnint(x * invpio2);
  const n = irint(fn);
  r = x - fn * pio2_1;
  w = fn * pio2_1t; // 1st round good to 85 bit
  const j = ix >> 20;
  y0 = r - w;
  let high = highWord(y0);
  let i = j - ((high >> 20) & 0x7ff);
  if (i > 16) { // 2nd iteration needed, good to 118
    t = r;
    w = fn * pio2_2;
    r = t - w;
    w = fn * pio2_2t - ((t - r) - w);
    y0 = r - w;
    high = highWord(y0);
    i = j - ((high >> 20) & 0x7ff);
    if (i > 49) { // 3rd iteration need, 151 bits acc
      t = r; // will cover all possible cases
      w = fn * pio2_3;
      r = t - w;
      w = fn * pio2_3t - ((t - r) - w);
      y0 = r - w;
    }
  }
  y1 = (r - y0) - w;
  return n;
};

// A small multiple n of pi/2 off x, for |x| ~<= 9pi/4 away from the cancelling points (n < 0 when x < 0). The source spells out eight branches,
// z = x -+ |n|*pio2_1 and so on; x - n*pio2_1 is the same double bit for bit (an IEEE product and sum are symmetric in sign).
const small = (x: number, n: number): number => {
  const z = x - n * pio2_1;
  y0 = z - n * pio2_1t;
  y1 = (z - y0) - n * pio2_1t;
  return n;
};

const remPio2 = (x: number): number => {
  const hx = highWord(x); // high word of x
  const ix = hx & 0x7fffffff;
  if (ix <= 0x400f6a7a) { // |x| ~<= 5pi/4
    if ((ix & 0xfffff) === 0x921fb) return medium(x, ix); // |x| ~= pi/2 or 2pi/2: cancellation, use the medium case
    if (ix <= 0x4002d97c) return small(x, hx > 0 ? 1 : -1); // |x| ~<= 3pi/4
    return small(x, hx > 0 ? 2 : -2);
  }
  if (ix <= 0x401c463b) { // |x| ~<= 9pi/4
    if (ix <= 0x4015fdbc) { // |x| ~<= 7pi/4
      if (ix === 0x4012d97c) return medium(x, ix); // |x| ~= 3pi/2
      return small(x, hx > 0 ? 3 : -3);
    }
    if (ix === 0x401921fb) return medium(x, ix); // |x| ~= 4pi/2
    return small(x, hx > 0 ? 4 : -4);
  }
  if (ix < 0x413921fb) return medium(x, ix); // |x| ~< 2^20 (pi/2), medium size
  // all other (large) arguments: __kernel_rem_pio2 of k_rem_pio2.c, not ported
  throw new RangeError(`xmath.cos: |x| = ${Math.abs(x)} is beyond the ported reduction (about 2^20 pi/2); k_rem_pio2.c is not ported (ADR-0019)`);
};

// ---- s_cos.c ----------------------------------------------------------------------------------------------------------------------
/** Cosine. cos(+-Infinity) = NaN, cos(NaN) = NaN; throws a RangeError for |x| from about 2^20 pi/2 up (see the header). */
export const cos = (x: number): number => {
  const z = 0.0;
  let ix = highWord(x);
  ix &= 0x7fffffff;
  if (ix <= 0x3fe921fb) { // |x| ~< pi/4
    if (ix < 0x3e46a09e) if ((x | 0) === 0) return 1.0; // if x < 2^-27 * sqrt(2); generate inexact
    return kernelCos(x, z);
  } else if (ix >= 0x7ff00000) return x - x; // cos(Inf or NaN) is NaN
  // argument reduction needed
  const n = remPio2(x);
  switch (n & 3) {
    case 0: return kernelCos(y0, y1);
    case 1: return -kernelSin(y0, y1, 1);
    case 2: return -kernelCos(y0, y1);
    default: return kernelSin(y0, y1, 1);
  }
};
