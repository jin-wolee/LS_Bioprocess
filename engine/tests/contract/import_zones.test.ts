import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";
import { ROOT } from "../support/paths.ts";

// S2 Step 0: the import zones of eslint.config.js. Each rule is shown on a planted import: the file path is virtual (lintText),
// so nothing is written. The truth modules of this repo are flat files in engine/src (spec section 3, rule 2).

const TRUTH = ["process", "sampling", "analysis", "measure", "instrument", "stability", "sensors", "run"] as const;
/** Directories whose files may not read truth (the brief names the first six; the others are new folders that the rule covers by default). */
const BLOCKED = ["record", "ingest", "raw", "inject", "export", "experiments/arms"] as const;
/** The folders that may read truth: the observe side, the evaluator and the two truth-aware parts of the experiments. */
const ALLOWED = ["observe", "evaluate", "experiments/assembly", "experiments/oracle"] as const;

const up = (dir: string): string => "../".repeat(dir.split("/").length);

const messages = async (code: string, file: string): Promise<{ rule: string; text: string }[]> => {
  const eslint = new ESLint({ cwd: ROOT });
  const [result] = await eslint.lintText(code, { filePath: `${ROOT}/${file}` });
  return (result?.messages ?? []).map((m) => ({ rule: String(m.ruleId), text: m.message }));
};

const importOf = (spec: string): string => `import * as planted from "${spec}";\nexport const x = planted;\n`;
const restricted = (found: { rule: string; text: string }[]): { rule: string; text: string }[] => found.filter((m) => m.rule === "no-restricted-imports");

describe("Zone 1: truth modules are importable only from the observe side, the evaluator and the experiment assembly and oracle", () => {
  for (const dir of BLOCKED) {
    it.each(TRUTH)(`${dir}/ importing %s.ts is an error`, async (m) => {
      const found = restricted(await messages(importOf(`${up(dir)}${m}.ts`), `engine/src/${dir}/planted.ts`));
      expect(found.length).toBe(1);
      expect(found[0]?.text).toMatch(/truth/i);
    });
  }

  it.each(BLOCKED)("%s/ importing a truth module without the extension is an error too", async (dir) => {
    expect(restricted(await messages(importOf(`${up(dir)}process`), `engine/src/${dir}/planted.ts`)).length).toBe(1);
  });

  it.each(BLOCKED)("%s/ may import the observe side and the recorded-data modules", async (dir) => {
    for (const ok of ["observe.ts", "record/types.ts", "trace.ts", "generated/event.schema"]) {
      expect(restricted(await messages(importOf(`${up(dir)}${ok}`), `engine/src/${dir}/planted.ts`)), ok).toEqual([]);
    }
  });

  it.each(ALLOWED)("%s/ may import every truth module", async (dir) => {
    for (const m of TRUTH) expect(restricted(await messages(importOf(`${up(dir)}${m}.ts`), `engine/src/${dir}/planted.ts`)), m).toEqual([]);
  });

  it("a new top-level file of engine/src may not import a truth module (only the existing flat modules may)", async () => {
    const found = restricted(await messages(importOf("./process.ts"), "engine/src/planted.ts"));
    expect(found.length).toBe(1);
    expect(found[0]?.text).toMatch(/truth/i);
  });

  it.each(["scenario", "trace", "mmc", "observe", "run", "process"])("the existing flat module %s.ts keeps its imports", async (name) => {
    expect(restricted(await messages(importOf("./sensors.ts"), `engine/src/${name}.ts`))).toEqual([]);
  });

  it("a deeper folder is covered (record/deep/x.ts)", async () => {
    expect(restricted(await messages(importOf("../../process.ts"), "engine/src/record/deep/planted.ts")).length).toBe(1);
  });

  it("a local module with the name of a truth module is not mistaken for it (./process.ts inside record/)", async () => {
    expect(restricted(await messages(importOf("./process.ts"), "engine/src/record/planted.ts"))).toEqual([]);
  });
});

describe("Zone 2: the error answer key is importable only inside engine/src/evaluate", () => {
  it.each(["record", "observe", "experiments/assembly", "experiments/oracle", "experiments/arms", "inject", "export"])("%s/ importing the answer key is an error", async (dir) => {
    for (const spec of [`${up(dir)}evaluate/answer_key.ts`, `${up(dir)}evaluate/answer_key`]) {
      const found = restricted(await messages(importOf(spec), `engine/src/${dir}/planted.ts`));
      // arms also match the recorded-data zone (the path runs through evaluate/), so the key message is one of up to two
      expect(found.some((m) => /answer key/i.test(m.text)), spec).toBe(true);
    }
  });

  it("a top-level file importing the answer key is an error", async () => {
    expect(restricted(await messages(importOf("./evaluate/answer_key.ts"), "engine/src/planted.ts")).length).toBe(1);
  });

  it("evaluate/ may import it, from a sibling and from a subfolder", async () => {
    expect(restricted(await messages(importOf("./answer_key.ts"), "engine/src/evaluate/planted.ts"))).toEqual([]);
    expect(restricted(await messages(importOf("../answer_key.ts"), "engine/src/evaluate/sub/planted.ts"))).toEqual([]);
  });

  it("tests are outside the zones (they open the key to check it)", async () => {
    expect(restricted(await messages(importOf("../src/evaluate/answer_key.ts"), "engine/tests/planted.ts"))).toEqual([]);
  });
});

describe("Zone 3: experiments/arms sees recorded data only; the oracle arm is the single place that reads truth for a decision", () => {
  it.each(["oracle/closed_loop.ts", "assembly/closed_loop.ts", "evaluate/metrics.ts"])("arms importing ../%s is an error", async (spec) => {
    const found = restricted(await messages(importOf(`../${spec}`), "engine/src/experiments/arms/planted.ts"));
    expect(found.length).toBe(1);
    expect(found[0]?.text).toMatch(/recorded data/i);
  });

  it("arms importing the evaluator from outside experiments is an error", async () => {
    expect(restricted(await messages(importOf("../../evaluate/metrics.ts"), "engine/src/experiments/arms/planted.ts")).length).toBe(1);
  });

  it("arms may import the recorded dataset and the as-of reads", async () => {
    expect(restricted(await messages(importOf("../../record/asof.ts"), "engine/src/experiments/arms/planted.ts"))).toEqual([]);
  });

  it("the assembly may import the oracle (only arms are cut off from it)", async () => {
    expect(restricted(await messages(importOf("../oracle/closed_loop.ts"), "engine/src/experiments/assembly/planted.ts"))).toEqual([]);
  });
});

describe("The Node-only ban of engine/src still holds inside every zone (no existing rule is loosened)", () => {
  const dirs = [...BLOCKED, ...ALLOWED];
  it.each(dirs)("%s/ importing node:fs is still an error", async (dir) => {
    const found = restricted(await messages('import { readFileSync } from "node:fs";\nexport const x = readFileSync;\n', `engine/src/${dir}/planted.ts`));
    expect(found.length).toBe(1);
    expect(found[0]?.text).toMatch(/Web Worker|Node-only/);
  });

  it.each(dirs)("%s/ importing fs is still an error", async (dir) => {
    expect(restricted(await messages('import fs from "fs";\nexport const x = fs;\n', `engine/src/${dir}/planted.ts`)).length).toBe(1);
  });

  it("a top-level file importing node:fs is still an error", async () => {
    expect(restricted(await messages('import { readFileSync } from "node:fs";\nexport const x = readFileSync;\n', "engine/src/planted.ts")).length).toBe(1);
  });

  it("the other contract rules are untouched in a zone folder", async () => {
    const found = await messages("export const x = [Math.random(), process.env];\n", "engine/src/record/planted.ts");
    expect(found.map((m) => m.rule).sort()).toEqual(["no-restricted-globals", "no-restricted-properties"]);
  });
});
