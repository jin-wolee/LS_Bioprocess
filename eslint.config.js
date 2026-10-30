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
// 2026-10-30 S2e1: the raw quirk key is hidden (schemas/raw_quirk_key.schema.json; spec 2.4.1 rule 6): the evaluator is its only reader. Its types live in raw/key.ts; the emitter (raw/**) writes
// them and the experiment assembly writes the key file. Every other file is refused, the parser and the recorders included. The reader folders get their own zone objects at the end of this file.
const RAW_KEY = {
  regex: `(^|/)(raw/key|generated/raw_quirk_key\\.schema)${EXT}$`,
  message: "The raw quirk key is hidden: only engine/src/evaluate, engine/src/experiments/assembly and engine/src/raw may import it (the parser and the recorders never see which quirks were realised).",
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
    rules: { "no-restricted-imports": restrict(ANSWER_KEY, RAW_KEY) },
  },
  {
    // Zone 1, top-level files that are not truth readers: a new flat module may not import a truth module.
    files: ["engine/src/*.ts"],
    ignores: TRUTH_READERS,
    rules: { "no-restricted-imports": restrict(ANSWER_KEY, RAW_KEY, { regex: `^\\./(${TRUTH})${EXT}$`, message: TRUTH_MESSAGE }) },
  },
  {
    // Zone 1, folders: record, ingest, raw, inject, export, experiments/arms and any folder added later.
    files: ["engine/src/*/**/*.ts"],
    ignores: TRUTH_READERS,
    rules: { "no-restricted-imports": restrict(ANSWER_KEY, RAW_KEY, TRUTH_IN_FOLDER, HIDDEN_EVENT, TRUTH_READER_FOLDERS) },
  },
  {
    // Zone 3: the decision code of experiment 2.
    files: ["engine/src/experiments/arms/**/*.ts"],
    rules: {
      "no-restricted-imports": restrict(ANSWER_KEY, RAW_KEY, TRUTH_IN_FOLDER, ARMS_ONLY_RECORDED, HIDDEN_EVENT),
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
    rules: { "no-restricted-imports": restrict(ANSWER_KEY, TRUTH_IN_FOLDER, HIDDEN_EVENT, TRUTH_READER_FOLDERS) },
  },
);
