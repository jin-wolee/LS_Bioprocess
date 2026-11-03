import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";
import { ROOT } from "../support/paths.ts";

// docs/design/lab_ui.md section 2, "Import boundary": the lab page (src/) never imports a truth module; only src/worker/worker.ts reaches the engine, and only through
// engine/src/experiments/assembly/lab/. P3 adds src/plant/** to the page zone and one rule of its own (docs/design/plant_ui.md section 6, rule 6): `three` is imported only under src/plant/gl/. Each rule is shown on a planted import: the file path is virtual (lintText), so nothing is written. Beside import_zones.test.ts, which
// does the same for engine/src.

const TRUTH = ["process", "sampling", "analysis", "measure", "instrument", "stability", "sensors", "run"] as const;
const PAGE_FILES = ["src/ui/planted.tsx", "src/main.tsx", "src/i18n/planted.ts", "src/protocol.ts", "src/plant/planted.tsx", "src/plant/gl/planted.ts"] as const;

const messages = async (code: string, file: string): Promise<{ rule: string; text: string }[]> => {
  const eslint = new ESLint({ cwd: ROOT });
  const [result] = await eslint.lintText(code, { filePath: `${ROOT}/${file}` });
  return (result?.messages ?? []).map((m) => ({ rule: String(m.ruleId), text: m.message }));
};
const importOf = (spec: string): string => `import * as planted from "${spec}";\nexport const x = planted;\n`;
const restricted = async (code: string, file: string) => (await messages(code, file)).filter((m) => m.rule === "no-restricted-imports");
const refused = async (spec: string, file: string): Promise<number> => (await restricted(importOf(spec), file)).length;

/** The path from the folder of a file under src/ up to the repository root. */
const up = (file: string): string => "../".repeat(file.split("/").length - 1);
/** The path from the folder of a file under src/ to src/ itself. */
const srcDir = (file: string): string => (file.split("/").length > 2 ? "../" : "./");

describe("the page (src/ui, src/main.tsx, src/i18n, src/protocol.ts) imports no engine or scenario module", () => {
  for (const file of PAGE_FILES) {
    describe(file, () => {
      it.each(TRUTH)("importing the truth module %s.ts is an error", async (m) => {
        expect(await refused(`${up(file)}engine/src/${m}.ts`, file)).toBe(1);
      });

      it.each([
        "engine/src/evaluate/answer_key.ts",
        "engine/src/raw/key.ts",
        "engine/src/generated/event.schema",
        "engine/src/generated/raw_quirk_key.schema",
        "engine/src/experiments/assembly/lab/check.ts",
        "engine/src/experiments/assembly/lab/home.ts",
        "engine/src/trace.ts",
        "engine/tests/support/paths.ts",
        "data/scenarios/default.json",
      ])("importing %s is an error", async (path) => {
        expect(await refused(`${up(file)}${path}`, file)).toBe(1);
      });

      it("importing the Worker modules is an error (the page creates the Worker with new URL, it does not import it)", async () => {
        expect(await refused(`${srcDir(file)}worker/worker.ts`, file)).toBe(1);
        expect(await refused(`${srcDir(file)}worker/data.ts`, file)).toBe(1);
      });

      it("importing a Node-only module is an error", async () => {
        expect((await restricted('import { readFileSync } from "node:fs";\nexport const x = readFileSync;\n', file)).length).toBe(1);
        expect((await restricted('import { join } from "path";\nexport const x = join;\n', file)).length).toBe(1);
      });

      it("importing preact, the protocol types, the dictionaries and the ledger view is allowed", async () => {
        const here = srcDir(file);
        for (const ok of ["preact", "preact/hooks", `${here}protocol.ts`, `${here}i18n/en.ts`, `${here}generated/ledger_view.json`, `${here}ui/Home.tsx`]) {
          expect(await refused(ok, file), ok).toBe(0);
        }
      });

      it("importing the generated types of the metrics and of the experiment report is allowed (the page draws them), the other generated modules are not", async () => {
        const root = up(file);
        for (const ok of ["metrics.schema", "experiment_report.schema"]) {
          expect(await restricted(`import type { X } from "${root}engine/src/generated/${ok}";\nexport type Y = X;\n`, file), ok).toEqual([]);
        }
        expect(await refused(`${root}engine/src/generated/scenario.schema`, file)).toBe(1);
      });
    });
  }

  it("a directory import of the engine is an error too", async () => {
    expect(await refused("../../engine", "src/ui/planted.tsx")).toBe(1);
    expect(await refused("../../engine/src/experiments/assembly/lab", "src/ui/planted.tsx")).toBe(1);
  });

  it("a test file of src is outside the zone (it reaches the Worker and the engine to test them)", async () => {
    expect(await refused("../../engine/src/trace.ts", "src/ui/planted.test.ts")).toBe(0);
    expect(await refused("../worker/worker.ts", "src/ui/planted.test.ts")).toBe(0);
  });
});

describe("three is imported only under src/plant/gl (plant_ui.md section 6, rule 6)", () => {
  const OUTSIDE = [
    "src/ui/planted.tsx", "src/main.tsx", "src/i18n/planted.ts", "src/protocol.ts",
    "src/plant/planted.tsx", "src/plant/layout.ts", "src/plant/walk.ts", "src/plant/controls.ts",
    "src/worker/worker.ts", "src/worker/data.ts",
  ] as const;

  it.each(OUTSIDE)("%s: importing three, or a path under it, is an error (types too)", async (file) => {
    for (const spec of ["three", "three/addons/loaders/GLTFLoader.js", "three/webgpu"]) expect(await refused(spec, file), spec).toBe(1);
    expect((await restricted('import type { Vector3 } from "three";\nexport type V = Vector3;\n', file)).length).toBe(1);
  });

  it("Given a file under src/plant/gl Then three is allowed", async () => {
    expect(await refused("three", "src/plant/gl/planted.ts")).toBe(0);
    expect(await refused("three/addons/controls/OrbitControls.js", "src/plant/gl/planted.ts")).toBe(0);
    expect(await refused("three", "src/plant/gl/deeper/planted.ts")).toBe(0);
  });

  it("Given a file under src/plant/gl Then it is still the page: no engine module, no Worker module, no Node-only module", async () => {
    const file = "src/plant/gl/planted.ts";
    expect(await refused("../../../engine/src/trace.ts", file)).toBe(1);
    expect(await refused("../../../engine/src/experiments/assembly/lab/plant.ts", file)).toBe(1);
    expect(await refused("../../worker/worker.ts", file)).toBe(1);
    expect((await restricted('import { join } from "node:path";\nexport const x = join;\n', file)).length).toBe(1);
  });

  it("Given a test file of the plant Then it is outside the zones", async () => {
    expect(await refused("three", "src/plant/gl/scene.test.ts")).toBe(0);
    expect(await refused("three", "src/plant/layout.test.ts")).toBe(0);
  });

  it("Given a plant module outside gl Then importing a module of gl is allowed (the page lazy-loads the scene), and a plant module may import the layout", async () => {
    expect(await refused("./gl/scene.ts", "src/plant/planted.tsx")).toBe(0);
    expect(await refused("./layout.ts", "src/plant/planted.tsx")).toBe(0);
  });
});

describe("the Worker entry (src/worker/worker.ts) reaches the engine only through engine/src/experiments/assembly/lab/", () => {
  const file = "src/worker/worker.ts";

  it("importing the lab functions, its data and the protocol types is allowed", async () => {
    for (const ok of ["../../engine/src/experiments/assembly/lab/check.ts", "../../engine/src/experiments/assembly/lab/home.ts", "./data.ts", "../protocol.ts"]) {
      expect(await refused(ok, file), ok).toBe(0);
    }
  });

  it.each(TRUTH)("importing the truth module %s.ts directly is an error", async (m) => {
    expect(await refused(`../../engine/src/${m}.ts`, file)).toBe(1);
  });

  it.each([
    "engine/src/evaluate/answer_key.ts",
    "engine/src/raw/key.ts",
    "engine/src/generated/event.schema",
    "engine/src/experiments/assembly/open_loop.ts",
    "engine/src/experiments/assembly/run_seed.ts",
    "engine/src/trace.ts",
    "engine/tests/support/paths.ts",
    "engine/tests/lab/check.test.ts",
  ])("importing %s is an error (the answer key, the raw key, the hidden event type, other assembly files and tests stay out)", async (path) => {
    expect(await refused(`../../${path}`, file)).toBe(1);
  });

  it("importing the scenario files directly is an error (they come through ./data.ts)", async () => {
    expect(await refused("../../data/scenarios/default.json", file)).toBe(1);
  });

  it("importing a Node-only module is an error", async () => {
    expect((await restricted('import { readFileSync } from "node:fs";\nexport const x = readFileSync;\n', file)).length).toBe(1);
  });
});

describe("the Worker's data module (src/worker/data.ts) bundles JSON and nothing of the engine", () => {
  const file = "src/worker/data.ts";

  it("importing the scenario, profile, architecture and evaluation files is allowed", async () => {
    for (const ok of ["../../data/scenarios/default.json", "../../data/scenarios/profiles/staff/experienced.json", "../../data/scenarios/architectures/a_manual.json", "../../data/scenarios/evaluation/default.json"]) {
      expect(await refused(ok, file), ok).toBe(0);
    }
  });

  it("importing any engine module is an error", async () => {
    expect(await refused("../../engine/src/experiments/assembly/lab/setup.ts", file)).toBe(1);
    expect(await refused("../../engine/src/process.ts", file)).toBe(1);
  });
});

describe("determinism in src (invariant 2)", () => {
  it.each(["src/ui/planted.tsx", "src/worker/worker.ts", "src/main.tsx", "src/plant/planted.tsx", "src/plant/gl/planted.ts"])("%s: Math.random is an error", async (file) => {
    const found = (await messages("export const x = Math.random();\n", file)).filter((m) => m.rule === "no-restricted-properties");
    expect(found.length).toBe(1);
    expect(found[0]?.text).toMatch(/Seeded PRNG/);
  });
});

describe("the engine's own zones are unchanged by the src zones", () => {
  it("engine/src/record still may not import a truth module", async () => {
    expect((await restricted(importOf("../process.ts"), "engine/src/record/planted.ts")).length).toBe(1);
  });
  it("engine/src/experiments/assembly/lab may import truth modules, as the other assembly files do", async () => {
    expect(await restricted(importOf("../../../run.ts"), "engine/src/experiments/assembly/lab/planted.ts")).toEqual([]);
  });
});
