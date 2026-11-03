import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";
import { ROOT, listFiles } from "../support/paths.ts";

const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".git" || name === ".venv" || name === "__pycache__") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
};

describe("Contract: portability and banned calls (lint on engine/src only)", () => {
  const messages = async (code: string, file: string): Promise<string[]> => {
    const eslint = new ESLint({ cwd: ROOT });
    const [result] = await eslint.lintText(code, { filePath: join(ROOT, file) });
    return (result?.messages ?? []).map((m) => String(m.ruleId));
  };

  it.each([
    ["Math.random", "export const x = Math.random();", "no-restricted-properties"],
    ["Date.now", "export const x = Date.now();", "no-restricted-properties"],
    ["new Date", "export const x = new Date();", "no-restricted-syntax"],
    ["node: import", 'import { readFileSync } from "node:fs";\nexport const x = readFileSync;', "no-restricted-imports"],
    ["fs import", 'import fs from "fs";\nexport const x = fs;', "no-restricted-imports"],
    ["process global", "export const x = process.env;", "no-restricted-globals"],
    ["Buffer global", 'export const x = Buffer.from("a");', "no-restricted-globals"],
  ])("%s is an error in engine/src", async (_name, code, rule) => {
    expect(await messages(code, "engine/src/planted.ts")).toContain(rule);
  });

  it("clean code passes in engine/src", async () => {
    expect(await messages("export const x = 1;\n", "engine/src/clean.ts")).toEqual([]);
  });

  it("the ban covers engine/src only: tests may use Node modules to load fixtures", async () => {
    const code = 'import { readFileSync } from "node:fs";\nexport const x = [readFileSync, Math.random()];\n';
    expect(await messages(code, "engine/tests/planted.ts")).toEqual([]);
  });

  it("no file of engine/src mentions the banned calls (the same grep as scripts/check_all.sh)", () => {
    const hits = walk(join(ROOT, "engine", "src")).filter((f) => f.endsWith(".ts") && /Math\.random|Date\.now|new Date\(/.test(readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
  });
});

describe("Contract: seeds are neutral integers", () => {
  const DATE_SHAPED = /^(19|20)\d{6}$/;

  it("the date-shaped pattern recognises what it must and nothing else", () => {
    for (const s of ["20251231", "19991231", "20000101"]) expect(DATE_SHAPED.test(s), s).toBe(true);
    for (const s of ["1", "42", "100", "2026091", "123456789", "30260910", "21000101"]) expect(DATE_SHAPED.test(s), s).toBe(false);
  });

  it("no scenario, trace or fixture file carries a date-shaped seed", () => {
    const roots = [["tests"], ["data", "scenarios"]].map((d) => join(ROOT, ...d));
    const files = roots.flatMap((r) => { try { return walk(r); } catch { return []; } }).filter((f) => f.endsWith(".json"));
    expect(files.length).toBeGreaterThan(20);
    const bad: string[] = [];
    const visit = (node: unknown, file: string): void => {
      if (Array.isArray(node)) node.forEach((n) => visit(n, file));
      else if (node && typeof node === "object") {
        for (const [k, v] of Object.entries(node)) {
          if (k === "seed" && DATE_SHAPED.test(String(v))) bad.push(`${relative(ROOT, file)}: seed ${String(v)}`);
          visit(v, file);
        }
      }
    };
    for (const f of files) visit(JSON.parse(readFileSync(f, "utf8")), f);
    expect(bad).toEqual([]);
  });
});

describe("Contract: golden files are created once and read-only", () => {
  const dir = join(ROOT, "tests", "golden", "parity");

  it("CHECKSUMS.txt lists exactly the 20 parity traces and every sha256 matches", () => {
    const lines = readFileSync(join(dir, "CHECKSUMS.txt"), "utf8").trim().split("\n");
    const listed = lines.map((l) => {
      const m = /^([0-9a-f]{64}) {2}(\S+)$/.exec(l);
      if (!m) throw new Error(`bad CHECKSUMS line: ${l}`);
      return [m[2] as string, m[1] as string] as const;
    });
    const traces = listFiles("tests", "golden", "parity").filter((f) => f.endsWith(".json"));
    expect(traces.length).toBe(20);
    expect(listed.map(([f]) => f).sort()).toEqual(traces);
    for (const [f, sum] of listed) expect(createHash("sha256").update(readFileSync(join(dir, f))).digest("hex"), f).toBe(sum);
  });

  it("no script, package script or test writes under tests/golden", () => {
    const WRITE = /writeFile|writeFileSync|appendFile|createWriteStream|\.write_text|\.write_bytes|shutil\.(copy|move)|open\([^)]*['"][wa]b?['"]|>>?\s*\S*golden|\btee\b/;
    const me = join(ROOT, "engine", "tests", "contract", "repo_rules.test.ts");
    const files = ["engine", "scripts", "tests"].flatMap((d) => walk(join(ROOT, d))).concat(join(ROOT, "package.json"));
    const offenders = files
      .filter((f) => f !== me && /\.(ts|js|mjs|py|sh|json)$/.test(f) && !f.includes(`${join("tests", "golden")}`) && !f.includes(`${join("tests", "fixtures")}`))
      .filter((f) => {
        const text = readFileSync(f, "utf8");
        return /golden/.test(text) && WRITE.test(text);
      })
      .map((f) => relative(ROOT, f));
    expect(offenders).toEqual([]);
  });
});
