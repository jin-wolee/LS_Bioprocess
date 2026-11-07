import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { build } from "vite";
import { ROOT } from "../support/paths.ts";

const DICTIONARY = "SENTINEL_B11_DICTIONARY_7F51";
const KOREAN = "SENTINEL_B11_KOREAN_7F51";
const WORKER = "SENTINEL_B11_WORKER_7F51";
const allJs = (dir: string): string => readdirSync(dir, { withFileTypes: true }).map((entry) => entry.isDirectory() ? allJs(join(dir, entry.name)) : entry.name.endsWith(".js") ? readFileSync(join(dir, entry.name), "utf8") : "").join("\n");

describe("B11 public and local bundles", () => {
  it("omits extension dictionary and worker report sentinels only in the refusing build", async () => {
    const scratch = mkdtempSync(join(tmpdir(), "b11-bundle-"));
    const prior = process.env.VITE_LAB_LOCAL;
    try {
      for (const path of ["src", "engine/src", "data", "docs/media"]) cpSync(join(ROOT, path), join(scratch, path), { recursive: true });
      cpSync(join(ROOT, "package.json"), join(scratch, "package.json"));
      symlinkSync(join(ROOT, "node_modules"), join(scratch, "node_modules"), "dir");
      const dict = join(scratch, "src/i18n/en_breakout.ts");
      const korean = join(scratch, "src/i18n/ko_breakout.ts");
      const report = join(scratch, "engine/src/experiments/assembly/breakout_report.ts");
      const d = readFileSync(dict, "utf8");
      const k = readFileSync(korean, "utf8");
      const r = readFileSync(report, "utf8");
      expect(d).toContain('"breakout.heading": "');
      expect(k).toContain('"breakout.heading": "');
      expect(r).toContain('export const MYCOPLASMA_NOTE =\n  "');
      writeFileSync(dict, d.replace('"breakout.heading": "', `"breakout.heading": "${DICTIONARY} `));
      writeFileSync(korean, k.replace('"breakout.heading": "', `"breakout.heading": "${KOREAN} `));
      writeFileSync(report, r.replace('export const MYCOPLASMA_NOTE =\n  "', `export const MYCOPLASMA_NOTE =\n  "${WORKER} `));
      for (const [local, mode] of [[false, "production"], [false, "test"], [true, "production"]] as const) {
        if (local) process.env.VITE_LAB_LOCAL = "1"; else delete process.env.VITE_LAB_LOCAL;
        const outDir = join(scratch, local ? "local" : `public-${mode}`);
        await build({ configFile: join(scratch, "src/vite.config.ts"), mode, publicDir: false, logLevel: "silent", build: { outDir, emptyOutDir: true } });
        const js = allJs(outDir);
        expect([js.includes(DICTIONARY), js.includes(KOREAN), js.includes(WORKER)], `dictionary and worker sentinels local=${local} mode=${mode}`).toEqual([local, local, local]);
      }
    } finally {
      if (prior === undefined) delete process.env.VITE_LAB_LOCAL; else process.env.VITE_LAB_LOCAL = prior;
      rmSync(scratch, { recursive: true, force: true });
    }
  }, 120_000);
});
