import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// The build of the lab page (docs/design/lab_ui.md section 2): `npm run build:lab`. The Vite root is src/, the base is relative so the build works under any Pages path, and Vite
// compiles Preact JSX by itself (no plugin). vite.config.ts keeps the Vitest settings; nothing here is read by the tests except engine/tests/lab/size_budget.test.ts, which builds with it.
// dist/lab-public/ holds the reference.json that engine/tests/support/lab_reference_cli.ts writes; Vite copies it next to the page.
const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: resolve(here, "src"),
  base: "./",
  publicDir: resolve(here, "dist", "lab-public"),
  oxc: { jsx: { runtime: "automatic", importSource: "preact" } },
  build: { outDir: resolve(here, "dist", "lab"), emptyOutDir: true, assetsDir: "assets", target: "es2022" },
  worker: { format: "es" },
});
