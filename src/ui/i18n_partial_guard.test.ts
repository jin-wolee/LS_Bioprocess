import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dir = new URL("../i18n/", import.meta.url);
const files = (lang: string): string[] => readdirSync(dir).filter((name) => name === `${lang}.ts` || (name.startsWith(`${lang}_`) && name.endsWith(".ts")));
const keys = (file: string): string[] => Array.from(readFileSync(new URL(file, dir), "utf8").matchAll(/^\s*"([^"]+)":/gm), (match) => match[1] as string);

describe.each(["en", "ko"])("partial dictionary contracts: %s", (lang) => {
  it("does not define the same key in multiple partial dictionaries", () => {
    const entries = files(lang).flatMap((file) => keys(file).map((key) => ({ file, key })));
    const duplicates = entries.filter((entry, index) => entries.findIndex((other) => other.key === entry.key) !== index);
    expect(duplicates).toEqual([]);
  });
  it("does not retain the six specifically identified unused entries", () => {
    const all = files(lang).flatMap(keys);
    for (const key of ["breakout.metrics.lead", "lineage.legend.heading", "lineage.q.heading", "results.detection.type", "results.running", "setup.run.cancelled"]) expect(all).not.toContain(key);
    expect(all).toContain("plant.col.sample");
  });
});
