import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ENGINE_VERSION } from "../../src/trace.ts";
import { writeText } from "../support/lab_files.ts";
import { ENGINE_NODE_FLAGS } from "../support/node_flags.ts";
import { ROOT, readJson } from "../support/paths.ts";

// docs/design/lab_ui.md section 7, "Where the reference comes from": engine/tests/support/lab_reference_cli.ts recomputes the strict truth hashes of seeds 1 to 3 in Node under the
// ADR-0016 flag and REFUSES to write reference.json unless they equal the log_hash of tests/golden/default_seed{1,2,3}.summary.json. A stale or miscompiled build cannot ship a wrong reference.

const CLI = join(ROOT, "engine", "tests", "support", "lab_reference_cli.ts");
const scratch = mkdtempSync(join(tmpdir(), "lab-reference-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const golden = (seed: number): { log_hash: string } => readJson("tests", "golden", `default_seed${seed}.summary.json`);

const cli = (out: string, goldens?: string) =>
  spawnSync(process.execPath, [...ENGINE_NODE_FLAGS, CLI, out, ...(goldens ? [`--summaries=${goldens}`] : [])], { cwd: ROOT, encoding: "utf8", timeout: 120_000 });

describe("lab_reference_cli", () => {
  it("Given the goldens as they are When the CLI runs Then it writes reference.json whose truth hashes are the goldens' log_hash, with the engine and node facts", () => {
    const out = join(scratch, "ok", "reference.json");
    const done = cli(out);
    expect(done.status, done.stderr).toBe(0);
    const ref = JSON.parse(readFileSync(out, "utf8")) as Record<string, unknown>;
    expect(ref).toMatchObject({
      schema_version: "1",
      engine_version: ENGINE_VERSION,
      node: { version: process.version, flags: ["--no-maglev-escape-analysis"] },
      truth: [1, 2, 3].map((seed) => ({ seed, log_hash: golden(seed).log_hash })),
      cells: { seed: 1, architectures: ["a_manual", "b_lims_lite", "c_context"] },
    });
    expect((ref.cells as { digest: string }).digest).toMatch(/^[0-9a-f]{64}$/);
    expect(readFileSync(out, "utf8").endsWith("\n")).toBe(true);
  }, 150_000);

  it("Given a golden whose log_hash differs from what the engine computes When the CLI runs Then it refuses: exit 1, the seed named, and no file is written", () => {
    const dir = join(scratch, "goldens");
    mkdirSync(dir);
    for (const seed of [1, 2, 3]) {
      const doc = golden(seed);
      const hash = seed === 2 ? (doc.log_hash.startsWith("a") ? "b" : "a") + doc.log_hash.slice(1) : doc.log_hash;
      writeText(join(dir, `default_seed${seed}.summary.json`), JSON.stringify({ ...doc, log_hash: hash }));
    }
    const out = join(scratch, "refused", "reference.json");
    const done = cli(out, dir);
    expect(done.status).toBe(1);
    expect(done.stderr).toMatch(/seed 2/);
    expect(done.stderr).toMatch(/golden/);
    expect(existsSync(out)).toBe(false);
  }, 150_000);

  it("Given a goldens folder without a summary file Then the CLI refuses with a message and writes nothing", () => {
    const dir = join(scratch, "empty");
    mkdirSync(dir);
    copyFileSync(join(ROOT, "tests", "golden", "default_seed1.summary.json"), join(dir, "default_seed1.summary.json"));
    const out = join(scratch, "missing", "reference.json");
    const done = cli(out, dir);
    expect(done.status).toBe(1);
    expect(done.stderr).toMatch(/golden summary of seed 2 is missing/);
    expect(existsSync(out)).toBe(false);
  }, 150_000);
});

describe("lab_reference_cli: where its one write lands (S3b follow-up 6b)", () => {
  const scripts = readJson<{ scripts: Record<string, string> }>("package.json").scripts;
  const goldens = resolve(ROOT, "tests", "golden");
  const inside = (dir: string, file: string): boolean => relative(dir, file) !== "" && !relative(dir, file).startsWith("..") && !isAbsolute(relative(dir, file));

  it("Given the build script that runs the CLI Then the file it is told to write is under dist/ and outside tests/golden", () => {
    const out = /lab_reference_cli\.ts (\S+)/.exec(scripts["build:lab"] ?? "")?.[1];
    expect(out, "build:lab names the output path of the CLI").toBeDefined();
    const target = resolve(ROOT, out as string);
    expect(inside(resolve(ROOT, "dist"), target)).toBe(true);
    expect(inside(goldens, target)).toBe(false);
  });

  it("Given writeText with a path Then it writes exactly there and returns that absolute path, so what the CLI is told is where the file lands", () => {
    const path = join(scratch, "pin", "reference.json");
    const written = writeText(path, "{}\n");
    expect(written).toBe(resolve(path));
    expect(readFileSync(written, "utf8")).toBe("{}\n");
    expect(inside(goldens, written)).toBe(false);
  });

  it("Given a path inside tests/golden Then the check above would say so (the helper tells the two apart)", () => {
    expect(inside(goldens, join(goldens, "reference.json"))).toBe(true);
    expect(inside(goldens, join(ROOT, "dist", "lab-public", "reference.json"))).toBe(false);
  });
});
