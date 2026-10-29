import js from "@eslint/js";
import tseslint from "typescript-eslint";

const NODE_ONLY = [
  "node:*", "fs", "fs/*", "path", "os", "child_process", "crypto", "process", "buffer", "worker_threads", "url", "util", "stream", "zlib",
].map((name) => ({ name, message: "engine/src must run in a Web Worker: no Node-only imports (contract: Portability)." }));

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
);
