import js from "@eslint/js";
import tseslint from "typescript-eslint";

const NODE_ONLY = [
  "node:*", "fs", "fs/*", "path", "os", "child_process", "crypto", "process", "buffer", "worker_threads", "url", "util", "stream", "zlib",
].map((name) => ({ name, message: "engine/src must run in a Web Worker: no Node-only imports (contract: Portability)." }));

// 2026-10-29 S2 Step 0: import zones (spec section 3, rule 2; prompts/20 Step 0). A later config object replaces the options of
// no-restricted-imports for the files it matches, so every zone repeats the Node-only ban through restrict().
const NODE_PATTERN = { group: ["node:*"], message: "No Node-only imports in engine/src." };
const restrict = (...zone) => ["error", { paths: NODE_ONLY, patterns: [NODE_PATTERN, ...zone] }];

// The truth modules of this repo are flat files in engine/src: L1, L2, L3 and the run that returns the truth log.
const TRUTH = "process|sampling|analysis|measure|instrument|stability|sensors|run";
const TRUTH_MESSAGE =
  "Truth module: only the observe side, engine/src/evaluate, experiments/assembly and experiments/oracle may import it (the recorded world never reads the truth world).";
const ANSWER_KEY = {
  regex: "(^|/)evaluate/answer_key(\\.ts)?$",
  message: "The error answer key is importable only inside engine/src/evaluate; the injector returns plain data and the assembly writes the key.",
};
const ARMS_ONLY_RECORDED = {
  regex: "(^|/)(oracle|assembly|evaluate)(/|$)",
  message: "experiments/arms sees recorded data only; the oracle arm is the single place that reads truth for a decision.",
};
// Flat modules that import truth modules today (they are, or load, the truth world), and the folders allowed to read truth.
const TRUTH_READERS = [
  ...TRUTH.split("|").map((m) => `engine/src/${m}.ts`),
  "engine/src/scenario.ts", "engine/src/trace.ts", "engine/src/mmc.ts", "engine/src/observe.ts",
  "engine/src/observe/**", "engine/src/evaluate/**", "engine/src/experiments/assembly/**", "engine/src/experiments/oracle/**", "engine/src/generated/**",
];

export default tseslint.config(
  { ignores: ["node_modules/**", "dist/**", "engine/src/generated/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Contract rules (prompts/10 Step 1) apply to engine/src only; tests may use Node modules to load fixtures.
    files: ["engine/src/**/*.ts"],
    rules: {
      "no-restricted-properties": [
        "error",
        { object: "Math", property: "random", message: "Seeded PRNG only (invariant 2): use the keyed streams of engine/src/rng.ts." },
        { object: "Date", property: "now", message: "No wall clock in the engine (invariant 2): time is an integer second of the scenario." },
      ],
      "no-restricted-syntax": [
        "error",
        { selector: "NewExpression[callee.name='Date']", message: "No wall clock in the engine (invariant 2): time is an integer second of the scenario." },
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
    rules: { "no-restricted-imports": restrict(ANSWER_KEY) },
  },
  {
    // Zone 1, top-level files that are not truth readers: a new flat module may not import a truth module.
    files: ["engine/src/*.ts"],
    ignores: TRUTH_READERS,
    rules: { "no-restricted-imports": restrict(ANSWER_KEY, { regex: `^\\./(${TRUTH})(\\.ts)?$`, message: TRUTH_MESSAGE }) },
  },
  {
    // Zone 1, folders: record, ingest, raw, inject, export, experiments/arms and any folder added later.
    files: ["engine/src/*/**/*.ts"],
    ignores: TRUTH_READERS,
    rules: { "no-restricted-imports": restrict(ANSWER_KEY, { regex: `^(\\.\\./)+(${TRUTH})(\\.ts)?$`, message: TRUTH_MESSAGE }) },
  },
  {
    // Zone 3: the decision code of experiment 2.
    files: ["engine/src/experiments/arms/**/*.ts"],
    rules: {
      "no-restricted-imports": restrict(ANSWER_KEY, { regex: `^(\\.\\./)+(${TRUTH})(\\.ts)?$`, message: TRUTH_MESSAGE }, ARMS_ONLY_RECORDED),
    },
  },
);
