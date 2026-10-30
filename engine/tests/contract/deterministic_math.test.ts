import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";
import { ROOT } from "../support/paths.ts";

// 2026-10-30 S3m (ADR-0019): ECMAScript leaves the transcendental Math members and the exponent operator implementation-approximated, and the JavaScript
// engines differ in the last digits. The lint of engine/src refuses them; the engine uses engine/src/xmath.ts. Planted lines are linted under virtual paths.

const APPROXIMATED = [
  "log", "log1p", "log2", "log10", "exp", "expm1", "pow", "sin", "cos", "tan", "asin", "acos", "atan", "atan2",
  "sinh", "cosh", "tanh", "asinh", "acosh", "atanh", "cbrt", "hypot",
] as const;
const EXACT = ["sqrt", "floor", "ceil", "round", "trunc", "abs", "min", "max", "imul", "sign", "fround", "clz32"] as const;

const lint = async (code: string, file: string): Promise<{ rule: string; text: string }[]> => {
  const eslint = new ESLint({ cwd: ROOT });
  const [result] = await eslint.lintText(code, { filePath: join(ROOT, file) });
  return (result?.messages ?? []).map((m) => ({ rule: String(m.ruleId), text: m.message }));
};
const adr19 = (found: { rule: string; text: string }[]): { rule: string; text: string }[] => found.filter((m) => m.text.includes("ADR-0019"));

describe("Contract: no implementation-approximated maths in engine/src (ADR-0019)", () => {
  it.each(APPROXIMATED)("Math.%s is an error in engine/src, with a message that names ADR-0019", async (m) => {
    const found = adr19(await lint(`export const x = Math.${m}(0.5, 0.25);\n`, "engine/src/planted.ts"));
    expect(found.map((f) => f.rule)).toEqual(["no-restricted-properties"]);
  });

  it.each(["record", "evaluate", "experiments/arms"])("the ban reaches the folders of engine/src (%s/)", async (dir) => {
    expect(adr19(await lint("export const x = Math.log(2);\n", `engine/src/${dir}/planted.ts`)).length).toBe(1);
  });

  it("a destructured or computed member is an error too", async () => {
    expect(adr19(await lint("const { exp } = Math;\nexport const x = exp(1);\n", "engine/src/planted.ts")).length).toBe(1);
    expect(adr19(await lint('export const x = Math["cos"](1);\n', "engine/src/planted.ts")).length).toBe(1);
  });

  it("the exponent operator ** and its assignment **= are errors in engine/src, with a message that names ADR-0019", async () => {
    const power = adr19(await lint("export const f = (x: number): number => x ** 2;\n", "engine/src/planted.ts"));
    expect(power.map((f) => f.rule)).toEqual(["no-restricted-syntax"]);
    const assign = adr19(await lint("export const f = (x: number): number => {\n  let y = x;\n  y **= 2;\n  return y;\n};\n", "engine/src/planted.ts"));
    expect(assign.map((f) => f.rule)).toEqual(["no-restricted-syntax"]);
  });

  it("the exact members (sqrt, floor, abs, imul, PI and the like) and x * x pass in engine/src", async () => {
    const code = `export const x = [${EXACT.map((m) => `Math.${m}(2)`).join(", ")}, Math.PI, Math.E, Math.SQRT2];\nexport const sq = (v: number): number => v * v;\n`;
    expect(await lint(code, "engine/src/planted.ts")).toEqual([]);
  });

  it("the ban covers engine/src only: tests compare with the native functions", async () => {
    expect(await lint("export const x = [Math.log(2), Math.cos(1), 2 ** 3];\n", "engine/tests/planted.ts")).toEqual([]);
  });

  it("the older bans keep their own messages (nothing loosened): Math.random still names invariant 2", async () => {
    const found = await lint("export const x = Math.random();\n", "engine/src/planted.ts");
    expect(found.map((f) => f.rule)).toEqual(["no-restricted-properties"]);
    expect(found[0]?.text).toMatch(/Seeded PRNG only/);
  });

  it("every file of engine/src lints clean of these rules, xmath.ts included", async () => {
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));
    const files = walk(join(ROOT, "engine", "src")).filter((f) => f.endsWith(".ts") && !f.includes(`${join("engine", "src", "generated")}`));
    expect(files.some((f) => f.endsWith("xmath.ts"))).toBe(true);
    const results = await new ESLint({ cwd: ROOT }).lintFiles(files);
    const hits = results.flatMap((r) => r.messages.filter((m) => m.message.includes("ADR-0019")).map((m) => `${relative(ROOT, r.filePath)}:${m.line}`));
    expect(hits).toEqual([]);
  }, 60_000);
});
