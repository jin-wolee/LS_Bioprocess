import { execFileSync, spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import viteConfig, { PERF_I12 } from "../../vite.config.ts";
import { ENGINE_NODE_FLAGS } from "./support/node_flags.ts";
import { ROOT } from "./support/paths.ts";

// ADR-0016: every Node process that runs engine code carries --no-maglev-escape-analysis (Node v25 miscompiles a hot loop of experiment 2 without it). The flag is the literal of
// the brief on purpose: the expected value must not come from the list under test. Three places must carry it: the Vitest workers, the children that tests spawn, the CLI scripts.

const FLAG = "--no-maglev-escape-analysis";
const SUPPORT = join(ROOT, "engine", "tests", "support");
const CLIS = readdirSync(SUPPORT).filter((name) => name.endsWith("_cli.ts")).sort();

describe("ADR-0016 runtime flag", () => {
  it("Given the shared list When read Then it holds the flag of ADR-0016", () => {
    expect(ENGINE_NODE_FLAGS).toContain(FLAG);
  });

  it("Given this test file runs in a Vitest worker When its process.execArgv is read Then it carries the flag and every flag of the shared list", () => {
    expect(process.execArgv).toContain(FLAG);
    for (const flag of ENGINE_NODE_FLAGS) expect(process.execArgv).toContain(flag);
  });

  it("Given a child spawned with the shared flags When it prints its execArgv Then the flags are there", () => {
    const out = execFileSync(process.execPath, [...ENGINE_NODE_FLAGS, "-e", "console.log(JSON.stringify(process.execArgv))"], { cwd: ROOT, encoding: "utf8" });
    const execArgv = JSON.parse(out) as string[];
    expect(execArgv).toContain(FLAG);
    for (const flag of ENGINE_NODE_FLAGS) expect(execArgv).toContain(flag);
  });

  it("Given the support folder When its CLI scripts are listed Then there are some (the loop below would be empty otherwise)", () => {
    expect(CLIS.length).toBeGreaterThanOrEqual(9);
  });

  it.each(CLIS)("Given %s started without the flag When it runs Then it exits 2 and names the flag and ADR-0016", (cli) => {
    const done = spawnSync(process.execPath, [join(SUPPORT, cli)], { cwd: ROOT, encoding: "utf8", timeout: 60_000 });
    expect(done.status).toBe(2);
    expect(done.stderr).toContain(FLAG);
    expect(done.stderr).toContain("ADR-0016");
  }, 90_000);
});

// H1: the I12 budget is measured by its own Vitest run (mode "perf") after the parallel suite. Two things must not drift apart silently: that run carries the same flags as the suite, and it
// stays a step of `npm run check` (which `scripts/check_all.sh` runs), because the default run no longer includes engine/tests/perf_i12.test.ts.
type VitestBlock = { include: string[]; exclude: string[]; execArgv: string[] };
const configFor = (mode: string): VitestBlock => (viteConfig as unknown as (env: { command: string; mode: string }) => { test: VitestBlock })({ command: "serve", mode }).test;

describe("I12 outside the parallel suite", () => {
  const scripts = (JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> }).scripts;

  it("Given the default run and the perf run When their files are listed Then the default one leaves the I12 test out and the perf one lists it alone", () => {
    expect(configFor("test").exclude).toContain(PERF_I12);
    expect(configFor("perf").include).toEqual([PERF_I12]);
    expect(configFor("perf").exclude).not.toContain(PERF_I12);
  });

  it("Given the default run and the perf run When their worker flags are read Then both carry the flags of the shared list", () => {
    for (const mode of ["test", "perf"]) for (const flag of ENGINE_NODE_FLAGS) expect(configFor(mode).execArgv).toContain(flag);
  });

  it("Given package.json When the scripts are read Then test:perf runs the perf mode and check runs it after the suite", () => {
    expect(scripts["test:perf"]).toContain("--mode perf");
    const steps = (scripts["check"] ?? "").split("&&").map((step) => step.trim());
    expect(steps).toContain("npm run test:perf");
    expect(steps.indexOf("npm run test:perf")).toBeGreaterThan(steps.indexOf("npm run test"));
  });
});
