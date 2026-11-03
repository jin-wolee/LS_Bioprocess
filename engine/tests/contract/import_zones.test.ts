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
    for (const ok of ["observe.ts", "record/types.ts", "trace.ts", "generated/architecture.schema"]) {
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

  // S2e1: the raw device layer (ADR-0014, docs/prompts/20 Step 5). raw/ and ingest/ are already in BLOCKED above; the adapters folder is one level deeper.
  it.each(TRUTH)("ingest/adapters/ importing %s.ts is an error (the adapter entries and the bridge read recorded data and plain data only)", async (m) => {
    const found = restricted(await messages(importOf(`../../${m}.ts`), "engine/src/ingest/adapters/planted.ts"));
    expect(found.length).toBe(1);
    expect(found[0]?.text).toMatch(/truth/i);
  });

  it("ingest/adapters/ importing the answer key, the hidden event type or a Node module is an error (the parser never reads the key or truth)", async () => {
    expect(restricted(await messages(importOf("../../evaluate/answer_key.ts"), "engine/src/ingest/adapters/planted.ts")).some((m) => /answer key/i.test(m.text))).toBe(true);
    expect(restricted(await messages(importOf("../../generated/event.schema"), "engine/src/ingest/adapters/planted.ts")).length).toBe(1);
    expect(restricted(await messages('import { readFileSync } from "node:fs";\nexport const x = readFileSync;\n', "engine/src/raw/planted.ts")).length).toBe(1);
  });

  it("a local module with the name of a truth module is not mistaken for it (./process.ts inside record/)", async () => {
    expect(restricted(await messages(importOf("./process.ts"), "engine/src/record/planted.ts"))).toEqual([]);
  });
});

describe("Zone 4 (S2b): the generated Event type, which carries the hidden fields, is not importable from the recorded side", () => {
  it.each(BLOCKED)("%s/ importing generated/event.schema is an error (with a type import too)", async (dir) => {
    for (const code of [importOf(`${up(dir)}generated/event.schema`), `import type { Event } from "${up(dir)}generated/event.schema";\nexport type X = Event;\n`]) {
      const found = restricted(await messages(code, `engine/src/${dir}/planted.ts`));
      expect(found.length).toBe(1);
      expect(found[0]?.text).toMatch(/hidden/i);
    }
  });

  it.each(ALLOWED)("%s/ may import it (the truth side and the evaluator read the full event)", async (dir) => {
    expect(restricted(await messages(importOf(`${up(dir)}generated/event.schema`), `engine/src/${dir}/planted.ts`))).toEqual([]);
  });

  it.each(BLOCKED)("%s/ may import the observable types of observe.ts instead", async (dir) => {
    expect(restricted(await messages(`import type { ObservableEvent } from "${up(dir)}observe.ts";\nexport type X = ObservableEvent;\n`, `engine/src/${dir}/planted.ts`))).toEqual([]);
  });
});

describe("Zone 2: the error answer key is importable only inside engine/src/evaluate", () => {
  it.each(["record", "observe", "experiments/assembly", "experiments/oracle", "experiments/arms", "inject", "export", "raw", "ingest"])("%s/ importing the answer key is an error", async (dir) => {
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

// S2e1 rework W1: the raw quirk key is hidden (data/schemas/raw_quirk_key.schema.json, spec 2.4.1 rule 6): the evaluator is its only reader. The key types live in raw/key.ts and the generated
// type of the schema; the emitter writes them, the assembly writes the key file, the evaluator reads it. Everything else is refused, the parser included.
describe("Zone 5: the hidden raw quirk key is importable only from evaluate/, experiments/assembly/ and raw/", () => {
  const KEY = (dir: string): string[] => [`${up(dir)}raw/key.ts`, `${up(dir)}raw/key`, `${up(dir)}generated/raw_quirk_key.schema`];
  const REFUSED = ["ingest", "ingest/adapters", "record", "inject", "export", "experiments/arms", "experiments/oracle", "observe"];
  const READERS = ["evaluate", "experiments/assembly", "raw"];

  it.each(REFUSED)("%s/ importing the raw key module or its generated type is an error", async (dir) => {
    for (const spec of KEY(dir)) {
      const found = restricted(await messages(importOf(spec), `engine/src/${dir}/planted.ts`));
      expect(found.some((m) => /raw quirk key/i.test(m.text)), spec).toBe(true);
    }
  });
  it.each(REFUSED)("%s/ importing the raw key with a type import is an error too", async (dir) => {
    const found = restricted(await messages(`import type { KeyRow } from "${up(dir)}raw/key.ts";\nexport type X = KeyRow;\n`, `engine/src/${dir}/planted.ts`));
    expect(found.some((m) => /raw quirk key/i.test(m.text))).toBe(true);
  });
  it.each(READERS)("%s/ may import the raw key module and its generated type", async (dir) => {
    for (const spec of KEY(dir)) expect(restricted(await messages(importOf(spec), `engine/src/${dir}/planted.ts`)), spec).toEqual([]);
  });
  it("raw/ may import its own key module as a sibling", async () => {
    expect(restricted(await messages(importOf("./key.ts"), "engine/src/raw/planted.ts"))).toEqual([]);
  });
  it("a top-level file of engine/src, new or existing, importing the raw key is an error; a local file named key.ts elsewhere is not mistaken for it", async () => {
    for (const file of ["planted", "observe", "process", "run", "scenario"]) {
      expect(restricted(await messages(importOf("./raw/key.ts"), `engine/src/${file}.ts`)).some((m) => /raw quirk key/i.test(m.text)), file).toBe(true);
    }
    expect(restricted(await messages(importOf("./key.ts"), "engine/src/ingest/planted.ts"))).toEqual([]);
  });
  it("the older zones still hold beside the key zone: ingest/ importing a truth module or the answer key is still an error, and raw/ still may not import a truth module", async () => {
    expect(restricted(await messages(importOf("../process.ts"), "engine/src/ingest/planted.ts")).some((m) => /truth/i.test(m.text))).toBe(true);
    expect(restricted(await messages(importOf("../../evaluate/answer_key.ts"), "engine/src/experiments/assembly/planted.ts")).some((m) => /answer key/i.test(m.text))).toBe(true); // the assembly keeps the zone it had
    expect(restricted(await messages(importOf("../evaluate/answer_key.ts"), "engine/src/raw/planted.ts")).some((m) => /answer key/i.test(m.text))).toBe(true);
    expect(restricted(await messages(importOf("../process.ts"), "engine/src/raw/planted.ts")).some((m) => /truth/i.test(m.text))).toBe(true);
    expect(restricted(await messages(importOf("../process.ts"), "engine/src/experiments/assembly/planted.ts"))).toEqual([]);
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

// S2f F7: the zones without bypasses (invariant 1). The patterns matched only `^(../)+name(.ts)?$`, so a recorded folder could reach a truth module or the raw quirk key with a `.js`
// extension, through `src/`, or through the evaluator or the assembly (which import truth). Each spelling below was accepted before; each is planted in every recorded folder and
// must be refused, while the readers keep their access and the legitimate imports keep working.
describe("S2f F7: no bypass of the truth, key and reader zones from a recorded folder", () => {
  /** One level deeper than BLOCKED: the same spelling, as seen from a sub-folder. */
  const spellings = (dir: string, m: string): string[] => [`${up(dir)}${m}.js`, `${up(dir)}${m}`, `${up(dir)}../src/${m}.ts`, `${up(dir)}../src/${m}.js`, `${up(dir)}../src/${m}`, `./${up(dir)}${m}.ts`];

  for (const dir of BLOCKED) {
    it.each(TRUTH)(`${dir}/ importing %s by .js, with no extension, through src/ or with a leading ./ is an error`, async (m) => {
      for (const spec of spellings(dir, m)) {
        const found = restricted(await messages(importOf(spec), `engine/src/${dir}/planted.ts`));
        expect(found.some((f) => /truth/i.test(f.text)), spec).toBe(true);
      }
    });
  }

  it.each(["../run.js", "../../src/run.ts", "../sensors.js"])("record/ importing %s (the bypasses found by the S2 adversary) is an error", async (spec) => {
    expect(restricted(await messages(importOf(spec), "engine/src/record/planted.ts")).some((f) => /truth/i.test(f.text)), spec).toBe(true);
  });

  const KEYS = (dir: string): string[] => [`${up(dir)}raw/key.js`, `${up(dir)}../src/raw/key.ts`, `${up(dir)}generated/raw_quirk_key.schema.js`];
  it.each(["ingest", "ingest/adapters", "record", "inject", "export", "experiments/arms", "experiments/oracle", "observe"])("%s/ importing the raw quirk key by .js or through src/ is an error", async (dir) => {
    for (const spec of KEYS(dir)) expect(restricted(await messages(importOf(spec), `engine/src/${dir}/planted.ts`)).some((f) => /raw quirk key/i.test(f.text)), spec).toBe(true);
  });
  it.each(["evaluate", "experiments/assembly", "raw"])("%s/ keeps its access to the raw quirk key, .js spelling included", async (dir) => {
    for (const spec of KEYS(dir)) expect(restricted(await messages(importOf(spec), `engine/src/${dir}/planted.ts`)), spec).toEqual([]);
  });

  it.each(["../evaluate/answer_key.js", "../evaluate/answer_key"])("record/ importing the answer key as %s is an error", async (spec) => {
    expect(restricted(await messages(importOf(spec), "engine/src/record/planted.ts")).some((f) => /answer key/i.test(f.text)), spec).toBe(true);
  });
  it("record/ importing the hidden Event type as generated/event.schema.js is an error", async () => {
    expect(restricted(await messages(importOf("../generated/event.schema.js"), "engine/src/record/planted.ts")).some((f) => /hidden/i.test(f.text))).toBe(true);
  });

  // the evaluator and the assembly import truth modules, so a recorded folder that imports them reads truth by one step more
  const READERS_OF_TRUTH = ["evaluate/truth.ts", "evaluate/truth.js", "evaluate/truth", "evaluate/evaluate.ts", "experiments/assembly/from_run.ts", "experiments/assembly/from_run.js", "experiments/assembly/run_seed"] as const;
  for (const dir of ["record", "ingest", "ingest/adapters", "inject", "export", "raw"] as const) {
    it.each(READERS_OF_TRUTH)(`${dir}/ importing %s is an error (the recorded side never imports the evaluator or the assembly)`, async (target) => {
      const found = restricted(await messages(importOf(`${up(dir)}${target}`), `engine/src/${dir}/planted.ts`));
      expect(found.some((f) => /evaluate.*experiments\/assembly|recorded side/i.test(f.text)), target).toBe(true);
    });
  }
  it.each(["evaluate/truth.ts", "experiments/assembly/from_run.ts"])("experiments/arms importing %s is still an error (its own zone)", async (target) => {
    expect(restricted(await messages(importOf(`../../${target}`), "engine/src/experiments/arms/planted.ts")).length).toBeGreaterThan(0);
  });

  it("readers keep their access: the evaluator, the assembly and the oracle import truth modules by .js and through src/, and the evaluator and the assembly import each other", async () => {
    for (const dir of ALLOWED) {
      for (const m of TRUTH) for (const spec of [`${up(dir)}${m}.js`, `${up(dir)}../src/${m}.ts`]) expect(restricted(await messages(importOf(spec), `engine/src/${dir}/planted.ts`)), `${dir} ${spec}`).toEqual([]);
    }
    expect(restricted(await messages(importOf("../../evaluate/truth.ts"), "engine/src/experiments/assembly/planted.ts"))).toEqual([]);
    expect(restricted(await messages(importOf("../experiments/assembly/from_run.ts"), "engine/src/evaluate/planted.ts"))).toEqual([]);
  });

  it("a new top-level file of engine/src importing a truth module as ./run.js is an error, and the existing flat modules keep their imports", async () => {
    expect(restricted(await messages(importOf("./run.js"), "engine/src/planted.ts")).some((f) => /truth/i.test(f.text))).toBe(true);
    expect(restricted(await messages(importOf("./sensors.js"), "engine/src/scenario.ts"))).toEqual([]);
  });

  it("legitimate imports keep working: the observable types, the recorded modules and a local module that happens to carry a truth name", async () => {
    for (const dir of BLOCKED) {
      for (const ok of ["observe.js", "observe", "record/types.ts", "record/types.js", "trace.ts", "generated/architecture.schema", "generated/architecture.schema.js"]) {
        expect(restricted(await messages(importOf(`${up(dir)}${ok}`), `engine/src/${dir}/planted.ts`)), `${dir} ${ok}`).toEqual([]);
      }
    }
    for (const spec of ["./process.ts", "./process.js", "./deep/measure.ts", "../record/process.ts", "../ingest/run.ts"]) {
      expect(restricted(await messages(importOf(spec), "engine/src/record/planted.ts")), spec).toEqual([]);
    }
    expect(restricted(await messages(importOf("./key.js"), "engine/src/ingest/planted.ts"))).toEqual([]);
  });
});
