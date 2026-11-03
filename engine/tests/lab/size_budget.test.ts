import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { build } from "vite";
import { ENGINE_NODE_FLAGS } from "../support/node_flags.ts";
import { ROOT } from "../support/paths.ts";

// docs/design/lab_ui.md section 12, "How each budget is measured in the gate", item 1, as docs/design/plant_ui.md sections 8 and 12 (item 3) change it: the plant is a dynamically imported chunk,
// so the sum of every built file is no longer the first load. The test builds the lab with Vite's JS API into a temporary directory (the reference.json the page needs is written there by the
// reference CLI first, as `npm run build:lab` does) with the manifest on, separates the static imports of the page from the dynamic ones, and holds each to its own budget, measured as
// `gzip -c <file> | wc -c`. It sits in `npm run check`, so the Stop hook catches a regression early. The end-to-end check `size` repeats the sums over the files that a cold load requests, and
// over the plant chunk that entering the plant requests.

const FIRST_LOAD = 300 * 1024; // bytes: the lab's first load (docs/prompts/00 section 4; plant_ui.md section 8)
const LOADER = 4 * 1024; // bytes: the loader chunk, the capability check and the dynamic import, inside the first load (plant_ui.md section 8, table)
const PLANT = 200 * 1024; // bytes: the plant chunk, the scene and three.js, fetched on entering the plant (plant_ui.md section 12, item 3)

const scratch = mkdtempSync(join(tmpdir(), "lab-size-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const filesUnder = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });

/** `gzip -c < file | wc -c`: the compressed size, read from the file on standard input so that no file name enters the header. */
const gzipBytes = (file: string): number => Number(execFileSync("sh", ["-c", 'gzip -c < "$1" | wc -c', "sh", file], { encoding: "utf8" }).trim());

interface Chunk {
  file: string;
  name?: string;
  isEntry?: boolean;
  isDynamicEntry?: boolean;
  imports?: string[];
  dynamicImports?: string[];
  css?: string[];
  assets?: string[];
}

/** The files a chunk of the manifest needs when it loads: its own file, its styles and assets, and, with `statically`, everything it imports statically (not what it imports dynamically). */
const closure = (manifest: Record<string, Chunk>, keys: string[]): Set<string> => {
  const files = new Set<string>();
  const seen = new Set<string>();
  const visit = (key: string): void => {
    if (seen.has(key)) return;
    seen.add(key);
    const chunk = manifest[key] as Chunk;
    for (const f of [chunk.file, ...(chunk.css ?? []), ...(chunk.assets ?? [])]) files.add(f);
    for (const i of chunk.imports ?? []) visit(i);
  };
  keys.forEach(visit);
  return files;
};

describe("the size budgets of the lab and the plant", () => {
  it("Given the lab built into a temporary directory Then the first load is at most 300 KB gzip, the loader chunk at most 4 KB, and the plant chunk, three.js in it, at most 200 KB and in no file of the first load", async () => {
    const publicDir = join(scratch, "public");
    const out = join(scratch, "out");
    const reference = spawnSync(process.execPath, [...ENGINE_NODE_FLAGS, join(ROOT, "engine", "tests", "support", "lab_reference_cli.ts"), join(publicDir, "reference.json")], { cwd: ROOT, encoding: "utf8" });
    expect(reference.status, reference.stderr).toBe(0);

    await build({ configFile: join(ROOT, "src", "vite.config.ts"), publicDir, logLevel: "silent", build: { outDir: out, emptyOutDir: true, manifest: true } });

    const manifest = JSON.parse(readFileSync(join(out, ".vite", "manifest.json"), "utf8")) as Record<string, Chunk>;
    const everything = filesUnder(out).map((f) => relative(out, f)).filter((f) => f !== join(".vite", "manifest.json")).sort();
    expect(everything).toContain("index.html");
    expect(everything).toContain("reference.json");
    expect(everything.some((f) => /^assets\/worker-.*\.js$/.test(f)), everything.join(", ")).toBe(true);
    expect(everything.some((f) => /\.css$/.test(f))).toBe(true);

    // the first load: the page's entry, what it imports statically, its styles, the Worker, and the files that no chunk names (index.html, reference.json); the dynamic chunks are not in it
    const entries = Object.entries(manifest).filter(([, c]) => c.isEntry).map(([k]) => k);
    expect(entries).toEqual(["index.html"]);
    const dynamic = Object.entries(manifest).filter(([, c]) => c.isDynamicEntry).map(([k]) => k);
    expect(dynamic.length, "the plant is one dynamic import").toBe(1);
    const staticFiles = closure(manifest, entries);
    const plantFiles = [...closure(manifest, dynamic)].filter((f) => !staticFiles.has(f));
    const named = new Set(Object.values(manifest).flatMap((c) => [c.file, ...(c.css ?? []), ...(c.assets ?? [])]));
    const firstLoad = everything.filter((f) => !plantFiles.includes(f) && (staticFiles.has(f) || !named.has(f)));
    expect(plantFiles.length, "the plant chunk has its own file").toBeGreaterThan(0);

    const sum = (files: string[]): number => files.reduce((n, f) => n + gzipBytes(join(out, f)), 0);
    const list = (files: string[]): string => files.map((f) => `${f} ${gzipBytes(join(out, f))}`).join("; ");
    const total = sum(firstLoad);
    expect(total, `${total} bytes gzip: ${list(firstLoad)}`).toBeGreaterThan(10_000);
    expect(total, `first load ${total} bytes gzip against ${FIRST_LOAD}: ${list(firstLoad)}`).toBeLessThanOrEqual(FIRST_LOAD);

    const loader = Object.values(manifest).find((c) => c.name === "plant-loader");
    expect(loader, "a chunk named plant-loader: the loader of the plant is a chunk of its own").toBeDefined();
    expect(firstLoad, "the loader is in the first load").toContain((loader as Chunk).file);
    const loaderBytes = gzipBytes(join(out, (loader as Chunk).file));
    expect(loaderBytes, `loader ${loaderBytes} bytes gzip against ${LOADER}`).toBeLessThanOrEqual(LOADER);
    expect(loaderBytes).toBeGreaterThan(100);

    const plantBytes = sum(plantFiles);
    expect(plantBytes, `plant chunk ${plantBytes} bytes gzip against ${PLANT}: ${list(plantFiles)}`).toBeLessThanOrEqual(PLANT);
    // three.js is in the plant chunk and in no file of the first load: every build of three.js carries the "THREE." prefix of its own messages
    expect(readFileSync(join(out, plantFiles.find((f) => f.endsWith(".js")) as string), "utf8"), "the plant chunk holds three.js").toMatch(/THREE\./);
    for (const f of firstLoad.filter((x) => x.endsWith(".js"))) expect(readFileSync(join(out, f), "utf8"), `${f} must not hold three.js`).not.toMatch(/THREE\./);
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
