import { execFileSync, spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
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
