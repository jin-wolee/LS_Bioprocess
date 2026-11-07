import js from "@eslint/js";
import tseslint from "typescript-eslint";

const NODE_ONLY = [
  "node:*", "fs", "fs/*", "path", "os", "child_process", "crypto", "process", "buffer", "worker_threads", "url", "util", "stream", "zlib",
].map((name) => ({ name, message: "engine/src must run in a Web Worker: no Node-only imports (contract: Portability)." }));

// 2026-10-30 S3m (ADR-0019): ECMAScript leaves these Math members and the exponent operator implementation-approximated, and the JavaScript engines
// differ in the last digits, so a seed would give different bytes in Node and in a browser. engine/src uses its own port in engine/src/xmath.ts.
const APPROXIMATED = [
  "log", "log1p", "log2", "log10", "exp", "expm1", "pow", "sin", "cos", "tan", "asin", "acos", "atan", "atan2",
  "sinh", "cosh", "tanh", "asinh", "acosh", "atanh", "cbrt", "hypot",
].map((property) => ({
  object: "Math",
  property,
  message: `Math.${property} is implementation-approximated and differs between JavaScript engines (ADR-0019): use engine/src/xmath.ts, or add the function there.`,
}));
const POWER_MESSAGE = "The exponent operator is implementation-approximated and differs between JavaScript engines (ADR-0019): write x * x, or use engine/src/xmath.ts.";

// 2026-10-29 S2 Step 0: import zones (spec section 3, rule 2; docs/prompts/20 Step 0). A later config object replaces the options of
// no-restricted-imports for the files it matches, so every zone repeats the Node-only ban through restrict().
const NODE_PATTERN = { group: ["node:*"], message: "No Node-only imports in engine/src." };
const restrict = (...zone) => ["error", { paths: NODE_ONLY, patterns: [NODE_PATTERN, ...zone] }];

// The truth modules of this repo are flat files in engine/src: L1, L2, L3 and the run that returns the truth log.
const TRUTH = "process|sampling|analysis|measure|instrument|stability|sensors|run";
const TRUTH_MESSAGE =
  "Truth module: only the observe side, engine/src/evaluate, experiments/assembly and experiments/oracle may import it (the recorded world never reads the truth world).";
// 2026-10-30 S2f F7: a module specifier may end in .ts, .js (or the m and c variants) or in nothing, and it may reach engine/src through src/ or by going up and down again. Every pattern
// below takes all of those spellings; the first versions matched `.ts` or no extension only, and `../run.js` or `../../src/run.ts` from a recorded folder passed.
const EXT = "(\\.[cm]?[jt]s)?";
const ANSWER_KEY = {
  regex: `(^|/)evaluate/answer_key${EXT}$`,
  message: "The error answer key is importable only inside engine/src/evaluate; the injector returns plain data and the assembly writes the key.",
};
// A relative path whose last two segments are `..` or `src` and a truth module. A local file that carries a truth name in a folder of its own (./process.ts, ../record/process.ts) is not one.
const TRUTH_IN_FOLDER = { regex: `^(?=\\.)(?:.*/)?(?:\\.\\.|src)/(${TRUTH})${EXT}$`, message: TRUTH_MESSAGE };
// 2026-10-30 S2f F7: the evaluator and the experiment assembly import truth modules (they score against truth and draw the shared truth run), so a recorded folder that imports them reads truth
// one step removed. experiments/arms has its own, older zone with the same effect.
const TRUTH_READER_FOLDERS = {
  regex: "(^|/)(evaluate|experiments/assembly)(/|$)",
  message: "evaluate/ and experiments/assembly/ read the truth world: the recorded side (record, ingest, inject, export, experiments/arms, raw) never imports them.",
};
// 2026-10-29 S2b: the generated Event type still carries the hidden fields (true_value, noise, true_state, ...). The recorded side
// uses the observable types of observe.ts, in which those fields are removed from the type (S2a Parked, closed here).
const HIDDEN_EVENT = {
  regex: `(^|/)generated/event\\.schema${EXT}$`,
  message: "The generated Event type carries the hidden truth fields: the recorded side uses ObservableEvent from engine/src/observe.ts.",
};
// 2026-10-30 S2e1: the raw quirk key is hidden (data/schemas/raw_quirk_key.schema.json; spec 2.4.1 rule 6): the evaluator is its only reader. Its types live in raw/key.ts; the emitter (raw/**) writes
// them and the experiment assembly writes the key file. Every other file is refused, the parser and the recorders included. The reader folders get their own zone objects at the end of this file.
const RAW_KEY = {
  regex: `(^|/)(raw/key|generated/raw_quirk_key\\.schema)${EXT}$`,
  message: "The raw quirk key is hidden: only engine/src/evaluate, engine/src/experiments/assembly and engine/src/raw may import it (the parser and the recorders never see which quirks were realised).",
};
// 2026-10-30 break-out batch 2 (spec 11.8.5 row 2): engine/src/breakout/ holds the hidden script of an event (onsets, origins, the contaminated lots and equipment). It is a truth-side folder
// (TRUTH_READERS below), and nothing on the recorded side imports it. The first pattern is a relative path whose last two segments are `..` or `src` and the folder; the second is the same
// import from a new top-level file of engine/src. A local file named breakout.ts is not the folder.
const BREAKOUT_MESSAGE = "engine/src/breakout/ holds the hidden script of a break-out event: only the truth side (the scenario loader, the run, the evaluator, the experiment assembly) imports it, never the recorded side (record, ingest, inject, export, raw, experiments/arms).";
const BREAKOUT = { regex: `^(?=\\.)(?:.*/)?(?:\\.\\.|src)/breakout(/|$)`, message: BREAKOUT_MESSAGE };
const BREAKOUT_FLAT = { regex: "^\\./breakout(/|$)", message: BREAKOUT_MESSAGE };
const ARMS_ONLY_RECORDED = {
  regex: "(^|/)(oracle|assembly|evaluate)(/|$)",
  message: "experiments/arms sees recorded data only; the oracle arm is the single place that reads truth for a decision.",
};
// Flat modules that import truth modules today (they are, or load, the truth world), and the folders allowed to read truth.
const TRUTH_READERS = [
  ...TRUTH.split("|").map((m) => `engine/src/${m}.ts`),
  "engine/src/scenario.ts", "engine/src/trace.ts", "engine/src/mmc.ts", "engine/src/observe.ts",
  "engine/src/observe/**", "engine/src/evaluate/**", "engine/src/experiments/assembly/**", "engine/src/experiments/oracle/**", "engine/src/generated/**", "engine/src/breakout/**",
];

// 2026-10-30 S3b (docs/design/lab_ui.md section 2): import zones for the lab page. The page (src/ui, src/main.tsx, src/i18n, src/protocol.ts) imports no engine or scenario module; only
// src/worker/worker.ts reaches the engine, and only through engine/src/experiments/assembly/lab/; src/worker/data.ts bundles the scenario JSON and nothing of the engine. Test files
// (src/**/*.test.ts) are outside the zones, as engine/tests is. Each zone repeats the Node-only ban through srcRestrict(), because a later object replaces the options.
const SRC_NODE_ONLY = NODE_ONLY.map(({ name }) => ({ name, message: "The lab page and its Worker run in a browser: no Node-only imports in src." }));
const srcRestrict = (...zone) => ["error", { paths: SRC_NODE_ONLY, patterns: [{ group: ["node:*"], message: "No Node-only imports in src." }, ...zone] }];
const GENERATED_TYPES = `src/generated/(?:metrics|experiment_report)\\.schema${EXT}$`;
const PAGE_NO_ENGINE = {
  regex: `(^|/)(engine|scenarios)(/(?!${GENERATED_TYPES})|$)`,
  message: "The page imports no engine or scenario module (only the generated types of the metrics and the report): the Worker holds the engine and sends plain data (src/protocol.ts).",
};
const PAGE_NO_WORKER = { regex: "(^|/)worker(/|$)", message: "The page never imports the Worker: it creates it with new Worker(new URL(...))." };
const WORKER_ONLY_LAB = {
  regex: "(^|/)engine(/(?!src/experiments/assembly/lab/)|$)",
  message: "src/worker/worker.ts imports engine/src/experiments/assembly/lab/ only: the truth modules, the answer key, the raw quirk key, the hidden event type and the tests stay behind it.",
};
// 2026-11-01 P3 (docs/design/plant_ui.md section 6, rule 6): `three` is imported only under src/plant/gl/, so layout.ts, the controls' state and everything else of the plant run in Vitest without WebGL
// and the Worker never reaches it. The pattern takes `three` and every path under it, type imports included.
const NO_THREE = { group: ["three", "three/*"], message: "three is imported only under src/plant/gl/ (plant_ui.md section 6, rule 6): the layout, the controls' state, the page and the Worker run without WebGL." };
const WORKER_NO_SCENARIOS = { regex: "(^|/)scenarios(/|$)", message: "The scenario files reach the Worker through src/worker/data.ts." };
const DATA_NO_ENGINE = { regex: "(^|/)engine(/|$)", message: "src/worker/data.ts bundles JSON only; the engine functions are imported by src/worker/worker.ts." };

export default tseslint.config(
  { ignores: ["node_modules/**", "dist/**", "engine/src/generated/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Contract rules (docs/prompts/10 Step 1) apply to engine/src only; tests may use Node modules to load fixtures.
    files: ["engine/src/**/*.ts"],
    rules: {
      "no-restricted-properties": [
        "error",
        { object: "Math", property: "random", message: "Seeded PRNG only (invariant 2): use the keyed streams of engine/src/rng.ts." },
        { object: "Date", property: "now", message: "No wall clock in the engine (invariant 2): time is an integer second of the scenario." },
        ...APPROXIMATED,
      ],
      "no-restricted-syntax": [
        "error",
        { selector: "NewExpression[callee.name='Date']", message: "No wall clock in the engine (invariant 2): time is an integer second of the scenario." },
        { selector: "BinaryExpression[operator='**']", message: POWER_MESSAGE },
        { selector: "AssignmentExpression[operator='**=']", message: POWER_MESSAGE },
      ],
      "no-restricted-imports": ["error", { paths: NODE_ONLY, patterns: [{ group: ["node:*"], message: "No Node-only imports in engine/src." }] }],
      "no-restricted-globals": [
        "error",
        { name: "process", message: "No Node-only globals in engine/src (Web Worker)." },
        { name: "Buffer", message: "No Node-only globals in engine/src (Web Worker)." },
        { name: "require", message: "No Node-only globals in engine/src (Web Worker)." },
      ],
    },
  },
  {
    // Zone 2: the answer key. Everything under engine/src except the evaluator.
    files: ["engine/src/**/*.ts"],
    ignores: ["engine/src/evaluate/**"],
    rules: { "no-restricted-imports": restrict(ANSWER_KEY, RAW_KEY) },
  },
  {
    // Zone 1, top-level files that are not truth readers: a new flat module may not import a truth module.
    files: ["engine/src/*.ts"],
    ignores: TRUTH_READERS,
    rules: { "no-restricted-imports": restrict(ANSWER_KEY, RAW_KEY, { regex: `^\\./(${TRUTH})${EXT}$`, message: TRUTH_MESSAGE }, BREAKOUT_FLAT) },
  },
  {
    // Zone 1, folders: record, ingest, raw, inject, export, experiments/arms and any folder added later.
    files: ["engine/src/*/**/*.ts"],
    ignores: TRUTH_READERS,
    rules: { "no-restricted-imports": restrict(ANSWER_KEY, RAW_KEY, TRUTH_IN_FOLDER, HIDDEN_EVENT, TRUTH_READER_FOLDERS, BREAKOUT) },
  },
  {
    // Zone 3: the decision code of experiment 2.
    files: ["engine/src/experiments/arms/**/*.ts"],
    rules: {
      "no-restricted-imports": restrict(ANSWER_KEY, RAW_KEY, TRUTH_IN_FOLDER, ARMS_ONLY_RECORDED, HIDDEN_EVENT, BREAKOUT),
    },
  },
  {
    // Zone 5, readers of the raw quirk key (S2e1): each reader folder keeps exactly the zones it had before RAW_KEY was added to them. The assembly is a truth reader (zone 2 only).
    files: ["engine/src/experiments/assembly/**/*.ts"],
    rules: { "no-restricted-imports": restrict(ANSWER_KEY) },
  },
  {
    // Zone 5, the raw layer: the emitter writes the key. It is not a truth reader, so zone 1 (folders) applies as before; evaluate/** needs no object (it was in no zone but the base).
    files: ["engine/src/raw/**/*.ts"],
    rules: { "no-restricted-imports": restrict(ANSWER_KEY, TRUTH_IN_FOLDER, HIDDEN_EVENT, TRUTH_READER_FOLDERS, BREAKOUT) },
  },
  {
    // Lab page zones (S3b, lab_ui.md section 2), 1: the page, the plant (src/plant/**) included; `three` stays out of it.
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/worker/**", "src/plant/gl/**", "src/**/*.test.ts"],
    rules: { "no-restricted-imports": srcRestrict(PAGE_NO_ENGINE, PAGE_NO_WORKER, NO_THREE) },
  },
  {
    // The plant's scene (P3, plant_ui.md section 6, rule 6): the only place that imports `three`. It is still the page, so the engine, the Worker and Node-only modules stay out.
    files: ["src/plant/gl/**/*.{ts,tsx}"],
    ignores: ["src/**/*.test.ts"],
    rules: { "no-restricted-imports": srcRestrict(PAGE_NO_ENGINE, PAGE_NO_WORKER) },
  },
  {
    // Lab page zones, 2: Worker modules, apart from the separately governed data bundle.
    files: ["src/worker/**/*.{ts,tsx}"],
    ignores: ["src/worker/data.ts", "src/**/*.test.ts"],
    rules: { "no-restricted-imports": srcRestrict(WORKER_ONLY_LAB, WORKER_NO_SCENARIOS, NO_THREE) },
  },
  {
    // Lab page zones, 3: the bundled JSON of the Worker.
    files: ["src/worker/data.ts"],
    rules: { "no-restricted-imports": srcRestrict(DATA_NO_ENGINE, NO_THREE) },
  },
  {
    // Invariant 2 in src: seeded PRNG only (check_all.sh greps engine/src and src for Math.random as well).
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/**/*.test.ts"],
    rules: {
      "no-restricted-properties": ["error", { object: "Math", property: "random", message: "Seeded PRNG only (invariant 2): the page draws no random number; every lab draw is keyed (lab_ui.md section 9)." }],
    },
  },
);
