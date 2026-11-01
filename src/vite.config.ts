import { defineConfig } from "vite";

// The build of the lab page (docs/design/lab_ui.md section 2): `npm run build:lab`. The Vite root is this folder, src/, the base is relative so the build works under any Pages path, and Vite
// compiles Preact JSX by itself (no plugin). The vite.config.ts at the repository root keeps the Vitest settings; nothing here is read by the tests except engine/tests/lab/size_budget.test.ts, which
// builds with it. The paths below are relative to the root (Vite resolves publicDir and outDir against it), so this file imports nothing from Node: src/ is a lint zone that refuses node: imports.
// dist/lab-public/ holds the reference.json that engine/tests/support/lab_reference_cli.ts writes; Vite copies it next to the page.
export default defineConfig({
  root: import.meta.dirname,
  base: "./",
  publicDir: "../dist/lab-public",
  oxc: { jsx: { runtime: "automatic", importSource: "preact" } },
  build: {
    outDir: "../dist/lab",
    emptyOutDir: true,
    assetsDir: "assets",
    target: "es2022",
    // the plant chunk holds three.js (about 550 kB before compression); its budget is the gzip size that engine/tests/lab/size_budget.test.ts holds it to, not the warning of the build
    chunkSizeWarningLimit: 600,
    rolldownOptions: {
      // the loader of the plant (the capability check and the dynamic import of the scene) is a chunk of its own, so that engine/tests/lab/size_budget.test.ts can hold it to its 4 KB
      // (docs/design/plant_ui.md section 8); the scene and three.js are the chunk the loader imports dynamically
      output: { codeSplitting: { groups: [{ name: "plant-loader", test: /[\\/]src[\\/]plant[\\/]loader\.ts$/ }] } },
    },
  },
  worker: { format: "es" },
});
