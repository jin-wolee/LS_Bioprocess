import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";
import { ROOT } from "../support/paths.ts";

const eslint = new ESLint({ cwd: ROOT });
const rules = async (file: string, code: string): Promise<string[]> => {
  const [result] = await eslint.lintText(code, { filePath: join(ROOT, file) });
  return (result?.messages ?? []).map((message) => String(message.ruleId));
};

describe("infographic lint coverage", () => {
  it("the lint command includes the infographic sources and its own configuration", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { scripts: { lint: string }; engines: { node: string } };
    expect(pkg.scripts.lint.split(/\s+/)).toEqual(expect.arrayContaining(["engine", "src", "site/infographic/src", "eslint.config.js"]));
    expect(pkg.engines.node).toBe("25.6.1");
  });

  it.each(["app.js", "i18n.js", "latest.js", "example.test.js", "nested/example.spec.js"])("rejects unseeded randomness in %s", async (file) => {
    expect(await rules(`site/infographic/src/${file}`, "Math.random();")).toContain("no-restricted-properties");
  });

  it("rejects unseeded randomness in the lint configuration", async () => {
    expect(await rules("eslint.config.js", "export const value = Math.random();")).toContain("no-restricted-properties");
  });

  it("accepts the page's browser globals and unused catch bindings", async () => {
    const code = "try { window.localStorage.getItem('x'); document.title = String(IntersectionObserver); } catch (e) { /* ignored */ }";
    expect(await rules("site/infographic/src/example.js", code)).toEqual([]);
  });

  it("still reports undefined names and unused variables in the page", async () => {
    expect(await rules("site/infographic/src/example.js", "const unused = 1; missingGlobal();")).toEqual(expect.arrayContaining(["no-undef", "no-unused-vars"]));
  });

  it("still applies recommended rules to the lint configuration", async () => {
    expect(await rules("eslint.config.js", "const unused = missingGlobal; export const value = 1;")).toEqual(expect.arrayContaining(["no-undef", "no-unused-vars"]));
  });
});
