import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";
import { ROOT } from "../support/paths.ts";

const eslint = new ESLint({ cwd: ROOT });
const restricted = async (file: string, spec: string, typeOnly = false): Promise<string[]> => {
  const code = `import ${typeOnly ? "type " : ""}* as dependency from "${spec}";\nexport ${typeOnly ? "type X = dependency.X" : "const x = dependency"};\n`;
  const [result] = await eslint.lintText(code, { filePath: `${ROOT}/${file}` });
  return (result?.messages ?? []).filter((m) => m.ruleId === "no-restricted-imports").map((m) => m.message);
};

describe("worker import zones", () => {
  for (const file of ["src/worker/worker.ts", "src/worker/plant_worker.ts", "src/worker/future.ts", "src/worker/deep/future.ts", "src/worker/deep/future.tsx"]) {
    const root = file.includes("/deep/") ? "../../.." : "../..";
    it.each(["engine/src/run.ts", "engine/src/scenario.ts", "data/scenarios/default.json"])(`${file} rejects %s`, async (target) => {
      expect(await restricted(file, `${root}/${target}`)).toHaveLength(1);
    });
    it(`${file} permits lab assembly imports, including type-only imports`, async () => {
      const lab = `${root}/engine/src/experiments/assembly/lab/plant.ts`;
      expect(await restricted(file, lab)).toEqual([]);
      expect(await restricted(file, lab, true)).toEqual([]);
      expect(await restricted(file, `${root}/engine/src/run.ts`, true)).toHaveLength(1);
    });
    it(`${file} still rejects Node and three`, async () => {
      for (const spec of ["node:fs", "three"]) expect(await restricted(file, spec)).toHaveLength(1);
    });
  }

  it("data.ts permits scenario data but rejects engine, Node and three imports", async () => {
    const file = "src/worker/data.ts";
    expect(await restricted(file, "../../data/scenarios/default.json")).toEqual([]);
    for (const spec of ["../../engine/src/run.ts", "../../engine/src/experiments/assembly/lab/plant.ts", "node:fs", "three"]) {
      expect(await restricted(file, spec)).toHaveLength(1);
    }
  });
});
