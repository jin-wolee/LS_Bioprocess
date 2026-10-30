import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { build } from "vite";
import { ENGINE_NODE_FLAGS } from "../support/node_flags.ts";
import { ROOT } from "../support/paths.ts";

// docs/design/lab_ui.md section 12, "How each budget is measured in the gate", item 1: the first load of the lab is at most 300 KB gzip, measured as `gzip -c <file> | wc -c` over every
// built file. The test builds the lab with Vite's JS API into a temporary directory (the reference.json the page needs is written there by the reference CLI first, as `npm run build:lab`
// does), sums the gzip sizes and fails above the budget. It sits in `npm run check`, so the Stop hook catches a regression early. The end-to-end check `size` repeats the sum over the
// files that a cold load actually requests.

const BUDGET = 300 * 1024; // bytes (prompts/00 section 4)
const scratch = mkdtempSync(join(tmpdir(), "lab-size-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const filesUnder = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });

/** `gzip -c < file | wc -c`: the compressed size, read from the file on standard input so that no file name enters the header. */
const gzipBytes = (file: string): number => Number(execFileSync("sh", ["-c", 'gzip -c < "$1" | wc -c', "sh", file], { encoding: "utf8" }).trim());

describe("the size budget of the lab", () => {
  it("Given the lab built into a temporary directory Then its files total at most 300 KB gzip", async () => {
    const publicDir = join(scratch, "public");
    const out = join(scratch, "out");
    const reference = spawnSync(process.execPath, [...ENGINE_NODE_FLAGS, join(ROOT, "engine", "tests", "support", "lab_reference_cli.ts"), join(publicDir, "reference.json")], { cwd: ROOT, encoding: "utf8" });
    expect(reference.status, reference.stderr).toBe(0);

    await build({ configFile: join(ROOT, "vite.lab.config.ts"), publicDir, logLevel: "silent", build: { outDir: out, emptyOutDir: true } });

    const files = filesUnder(out).map((f) => relative(out, f)).sort();
    expect(files).toContain("index.html");
    expect(files).toContain("reference.json");
    expect(files.some((f) => /^assets\/worker-.*\.js$/.test(f)), files.join(", ")).toBe(true);
    expect(files.some((f) => /^assets\/index-.*\.js$/.test(f))).toBe(true);
    expect(files.some((f) => /\.css$/.test(f))).toBe(true);

    const sizes = files.map((f) => ({ file: f, bytes: gzipBytes(join(out, f)) }));
    const total = sizes.reduce((sum, s) => sum + s.bytes, 0);
    expect(total, sizes.map((s) => `${s.file} ${s.bytes}`).join("; ")).toBeGreaterThan(10_000);
    expect(total, `${total} bytes gzip against ${BUDGET}: ${sizes.map((s) => `${s.file} ${s.bytes}`).join("; ")}`).toBeLessThanOrEqual(BUDGET);
  }, 120_000);

  it("Given a file that compresses well Then the measure reads the gzip size, not the file size", () => {
    const file = join(scratch, "repeated.txt");
    execFileSync("sh", ["-c", 'yes lineage | head -n 5000 > "$1"', "sh", file]);
    const raw = statSync(file).size;
    expect(raw).toBe(5000 * "lineage\n".length);
    // 40,000 bytes of one repeated line: a gzip stream of it is well under a hundred bytes
    expect(gzipBytes(file)).toBeLessThan(200);
  });
});
