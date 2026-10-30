import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";
import { ROOT } from "../support/paths.ts";

// Break-out batch 2, spec 11.8.5 row 2: the import zone of engine/src/breakout/ (eslint.config.js). The folder holds the hidden script of an event (onsets, origins, the contaminated lots),
// so it is a truth-side folder: it may import the truth modules and the full Event type, and the recorded side may not import it. Each case is a planted import; the file path is virtual.

const messages = async (code: string, file: string): Promise<{ rule: string; text: string }[]> => {
  const eslint = new ESLint({ cwd: ROOT });
  const [result] = await eslint.lintText(code, { filePath: `${ROOT}/${file}` });
  return (result?.messages ?? []).map((m) => ({ rule: String(m.ruleId), text: m.message }));
};
const importOf = (spec: string): string => `import * as planted from "${spec}";\nexport const x = planted;\n`;
const restricted = (found: { rule: string; text: string }[]): { rule: string; text: string }[] => found.filter((m) => m.rule === "no-restricted-imports");
const up = (dir: string): string => "../".repeat(dir.split("/").length);

/** The recorded side: the folders that may not read truth (import_zones.test.ts BLOCKED). */
const RECORDED = ["record", "ingest", "raw", "inject", "export", "experiments/arms"] as const;
/** The truth side that may read the script. */
const TRUTH_SIDE = ["evaluate", "experiments/assembly", "experiments/oracle", "observe"] as const;
const TRUTH = ["process", "sampling", "analysis", "measure", "instrument", "stability", "sensors", "run"] as const;

describe("Zone for engine/src/breakout/: the recorded side never imports it", () => {
  it.each(RECORDED)("%s/ importing breakout/ is an error that names the folder", async (dir) => {
    for (const spec of [`${up(dir)}breakout/plan.ts`, `${up(dir)}breakout/plan`, `${up(dir)}breakout/index.js`]) {
      const found = restricted(await messages(importOf(spec), `engine/src/${dir}/planted.ts`));
      expect(found.length, spec).toBe(1);
      expect(found[0]?.text).toMatch(/breakout/);
    }
  });

  it("a deeper recorded folder is covered too (record/deep/x.ts, ingest/adapters/x.ts)", async () => {
    for (const [file, spec] of [["record/deep/planted.ts", "../../breakout/plan.ts"], ["ingest/adapters/planted.ts", "../../breakout/plan.ts"]] as const) {
      expect(restricted(await messages(importOf(spec), `engine/src/${file}`)).length, file).toBe(1);
    }
  });

  it("a new top-level file of engine/src may not import it either", async () => {
    expect(restricted(await messages(importOf("./breakout/plan.ts"), "engine/src/planted.ts")).length).toBe(1);
  });

  it("a recorded folder's own file named breakout is not mistaken for the folder (record/breakout.ts as ./breakout.ts)", async () => {
    expect(restricted(await messages(importOf("./breakout.ts"), "engine/src/record/planted.ts"))).toEqual([]);
  });
});

describe("Zone for engine/src/breakout/: the truth side may import it, and it may import the truth world", () => {
  it.each(TRUTH_SIDE)("%s/ may import breakout/", async (dir) => {
    expect(restricted(await messages(importOf(`${up(dir)}breakout/plan.ts`), `engine/src/${dir}/planted.ts`))).toEqual([]);
  });

  it.each(["scenario", "run", "process", "observe"])("the flat truth module %s.ts may import ./breakout/", async (name) => {
    expect(restricted(await messages(importOf("./breakout/plan.ts"), `engine/src/${name}.ts`))).toEqual([]);
  });

  it.each(TRUTH)("breakout/ may import the truth module %s.ts and the full Event type", async (m) => {
    expect(restricted(await messages(importOf(`../${m}.ts`), "engine/src/breakout/planted.ts")), m).toEqual([]);
    expect(restricted(await messages(importOf("../generated/event.schema"), "engine/src/breakout/planted.ts"))).toEqual([]);
  });

  it("breakout/ still may not import the answer key, the raw quirk key or a Node module (the zones that apply to every folder but the evaluator still apply)", async () => {
    expect(restricted(await messages(importOf("../evaluate/answer_key.ts"), "engine/src/breakout/planted.ts")).some((m) => /answer key/i.test(m.text))).toBe(true);
    expect(restricted(await messages(importOf("../raw/key.ts"), "engine/src/breakout/planted.ts")).some((m) => /raw quirk key/i.test(m.text))).toBe(true);
    expect(restricted(await messages('import { readFileSync } from "node:fs";\nexport const x = readFileSync;\n', "engine/src/breakout/planted.ts")).length).toBe(1);
  });

  it("the older zones hold beside the new one: record/ still may not import a truth module", async () => {
    expect(restricted(await messages(importOf("../process.ts"), "engine/src/record/planted.ts")).length).toBe(1);
  });
});
