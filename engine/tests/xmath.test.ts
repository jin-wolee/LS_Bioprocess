import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cos, exp, log } from "../src/xmath.ts";
import { ROOT } from "./support/paths.ts";
import { ENGINE_COUNT, WIDE_COUNT, fromWords, ord, xmathInputs } from "./support/xmath_inputs.ts";

// 2026-10-30 S3m (ADR-0019): the engine's own log, exp and cos. The exact values are the anchors of the brief and the special cases the source files document;
// the property test holds the port to the native function of this Node within 1 ulp on fixed seeded inputs (both claim an error below 1 ulp, so they can differ by one).

const ulps = (a: number, b: number): number => {
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.isNaN(a) && Number.isNaN(b) ? 0 : Infinity;
  const d = ord(a) - ord(b);
  return Number(d < 0n ? -d : d);
};

describe("xmath: exact values and the special cases of the source", () => {
  it("Given the anchors of the brief Then log(1) = +0, exp(0) = 1 and cos(0) = 1 exactly (u = 0 reaches log(1) and cos(0); a hold of 0 s reaches exp(-0))", () => {
    expect(Object.is(log(1), 0)).toBe(true);
    expect(exp(0)).toBe(1);
    expect(exp(-0)).toBe(1);
    expect(cos(0)).toBe(1);
    expect(cos(-0)).toBe(1);
  });

  it("Given e_log.c's special cases Then log(+-0) = -Infinity, log(x < 0) = NaN, log(+Infinity) = +Infinity, log(NaN) = NaN", () => {
    expect(log(0)).toBe(-Infinity);
    expect(log(-0)).toBe(-Infinity);
    for (const x of [-1, -5e-324, -Infinity]) expect(log(x), String(x)).toBeNaN();
    expect(log(Infinity)).toBe(Infinity);
    expect(log(NaN)).toBeNaN();
  });

  it("Given e_exp.c's special cases Then exp(+Infinity) = +Infinity, exp(-Infinity) = +0, exp(NaN) = NaN, and it overflows above 709.78... and underflows below -745.13...", () => {
    expect(exp(Infinity)).toBe(Infinity);
    expect(Object.is(exp(-Infinity), 0)).toBe(true);
    expect(exp(NaN)).toBeNaN();
    expect(exp(709.79)).toBe(Infinity);
    expect(Object.is(exp(-745.14), 0)).toBe(true);
  });

  it("Given s_cos.c's special cases Then cos(+-Infinity) = NaN and cos(NaN) = NaN", () => {
    for (const x of [Infinity, -Infinity, NaN]) expect(cos(x), String(x)).toBeNaN();
  });

  it("Given |x| past the medium case of e_rem_pio2.c (high word 0x413921fb, about 2^20 pi/2), whose reduction (k_rem_pio2.c) is not ported, When cos is called Then it refuses rather than guess", () => {
    expect(() => cos(1647099)).toThrow(RangeError);
    expect(() => cos(-1647099)).toThrow(RangeError);
    expect(() => cos(1e300)).toThrow(RangeError);
    expect(Number.isFinite(cos(1647098.9999999998))).toBe(true);
    expect(Number.isFinite(cos(-1647098.9999999998))).toBe(true);
  });

  it("Given xmath.ts Then every decimal constant has the bit pattern of the hexadecimal words in its comment, as the source files state them", () => {
    const text = readFileSync(join(ROOT, "engine", "src", "xmath.ts"), "utf8");
    const found = [...text.matchAll(/(-?\d+\.\d+e[-+]\d+)[,;]?\s*\/\/\s*0x([0-9a-fA-F]{8}),?\s+0x([0-9a-fA-F]{8})/g)];
    expect(found.length).toBeGreaterThanOrEqual(30);
    for (const [, decimal, hi, lo] of found) expect(Number(decimal), decimal).toBe(fromWords(parseInt(hi as string, 16), parseInt(lo as string, 16)));
  });
});

describe("xmath: within 1 ulp of the native function on fixed seeded inputs (property test)", () => {
  const inputs = xmathInputs();
  const cases = [
    ["log", log, Math.log, inputs.log],
    ["cos", cos, Math.cos, inputs.cos],
    ["exp", exp, Math.exp, inputs.exp],
  ] as const;

  it.each(cases)(`Given %s on ${ENGINE_COUNT} engine-shaped, ${WIDE_COUNT} wide and the edge arguments Then no result is more than 1 ulp from the native one`, (name, port, native, xs) => {
    let worst = 0;
    let at = 0;
    let exact = 0;
    for (const x of xs) {
      const d = ulps(port(x), native(x));
      if (d === 0) exact++;
      if (d > worst) [worst, at] = [d, x];
    }
    console.log(`${name}: ${xs.length} inputs, ${exact} bit-identical to native, largest distance ${worst} ulp${worst > 0 ? ` at ${at}` : ""}`);
    expect(worst, `${name}(${at})`).toBeLessThanOrEqual(1);
  });

  it("Given the input sets Then they hold no NaN and are the same on every call (a fixed seed)", () => {
    const again = xmathInputs();
    for (const [name, , , xs] of cases) {
      expect(xs.some(Number.isNaN), name).toBe(false);
      expect(Buffer.from(xs.buffer).equals(Buffer.from(again[name].buffer)), name).toBe(true);
    }
  });
});
