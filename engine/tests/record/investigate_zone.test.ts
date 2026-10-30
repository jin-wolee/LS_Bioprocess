import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";
import { ROOT } from "../support/paths.ts";

// Break-out batch 4: the investigation is the recorded side (spec 11.8.2 rule S9, invariant 1). engine/src/record/investigate/ and rules_holds.ts import no truth module, no hidden event type,
// no script of an event (engine/src/breakout/), no evaluator and no experiment assembly. The zone of eslint.config.js covers the folder by its place under engine/src/record/; each case
// below is a planted import (the file path is virtual), and the last case lints the real files.

const lint = async (code: string, file: string) => {
  const [result] = await new ESLint({ cwd: ROOT }).lintText(code, { filePath: `${ROOT}/${file}` });
  return (result?.messages ?? []).filter((m) => m.ruleId === "no-restricted-imports");
};
const importOf = (spec: string): string => `import * as planted from "${spec}";\nexport const x = planted;\n`;

describe("The investigation imports nothing from the truth side", () => {
  it.each([
    "../../process.ts", "../../sampling.ts", "../../run.ts", "../../analysis.ts", "../../breakout/plan.ts", "../../breakout/config.ts", "../../evaluate/truth.ts",
    "../../experiments/assembly/run_seed.ts", "../../generated/event.schema", "../../evaluate/answer_key.ts",
  ])("record/investigate/ importing %s is an error", async (spec) => {
    expect((await lint(importOf(spec), "engine/src/record/investigate/planted.ts")).length, spec).toBeGreaterThanOrEqual(1);
  });

  it("rules_holds.ts, a file of record/, is covered the same way", async () => {
    expect((await lint(importOf("../breakout/plan.ts"), "engine/src/record/rules_holds.ts")).length).toBe(1);
    expect((await lint(importOf("../process.ts"), "engine/src/record/rules_holds.ts")).length).toBe(1);
  });

  it("the real files import none", async () => {
    const results = await new ESLint({ cwd: ROOT }).lintFiles(["engine/src/record/investigate/*.ts", "engine/src/record/rules_holds.ts"]);
    expect(results.length).toBeGreaterThan(0);
    expect(results.flatMap((r) => r.messages.filter((m) => m.ruleId === "no-restricted-imports"))).toEqual([]);
  });
});
