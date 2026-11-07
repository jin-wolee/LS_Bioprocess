import { describe, expect, it } from "vitest";
import { en } from "./en.ts";
import { ko } from "./ko.ts";
import { enBreakout } from "./en_breakout.ts";
import { koBreakout } from "./ko_breakout.ts";

// docs/design/lab_ui.md section 10: English is the source, Korean follows (ADR-0006: the Korean text introduces no number, claim or source). A missing Korean key is also a type error
// (ko.ts is typed Record<keyof typeof en, string>); this test is the runtime half and checks what a type cannot: placeholders, ledger ids and digits per key.

const enAll = { ...en, ...enBreakout };
const koAll = { ...ko, ...koBreakout };
const keys = Object.keys(enAll) as (keyof typeof enAll)[];
const placeholders = (text: string): string[] => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1] as string).sort();
const ids = (text: string): string[] => [...new Set(text.match(/\b[AS]\d{3}\b/g) ?? [])].sort();
const digitRuns = (text: string): string[] => [...new Set(text.match(/\d+/g) ?? [])].sort();

describe("dictionary parity (English and Korean)", () => {
  it("Given the two dictionaries Then they have exactly the same keys", () => {
    expect(Object.keys(koAll).sort()).toEqual([...keys].sort());
  });

  it.each(keys)("%s: the Korean text is not empty and has the same {placeholders}", (key) => {
    expect(koAll[key].trim().length).toBeGreaterThan(0);
    expect(placeholders(koAll[key])).toEqual(placeholders(enAll[key]));
  });

  it.each(keys)("%s: the Korean text names the same ledger ids as the English", (key) => {
    expect(ids(koAll[key])).toEqual(ids(enAll[key]));
  });

  it.each(keys)("%s: the Korean text has no digit sequence that the English text lacks", (key) => {
    const english = new Set(digitRuns(enAll[key]));
    expect(digitRuns(koAll[key]).filter((d) => !english.has(d))).toEqual([]);
  });
});

describe("the English texts", () => {
  it("Given every English text Then a digit occurs only inside a ledger id (every other number is an input, a result or a label: invariant 3)", () => {
    for (const key of keys) expect(enAll[key].replace(/\b[AS]\d{3}\b/g, ""), key).not.toMatch(/\d/);
  });

  it("Given the English dictionary Then it never says supports, compatible or certified (ADR-0014 rule R3: nothing refers to a real instrument that way)", () => {
    for (const key of keys) expect(enAll[key], key).not.toMatch(/\b(supports?|compatible|certified)\b/i);
  });

  it("Given the check banners Then the word reproducible occurs in none (it may appear only in the state identical: the design rule, enforced by the end-to-end check)", () => {
    for (const key of keys.filter((k) => k.startsWith("check.banner."))) {
      if (key !== "check.banner.identical") expect(enAll[key], key).not.toMatch(/reproducib/i);
    }
    expect(en["check.banner.identical"]).toMatch(/byte for byte/);
  });

  it("Given the four grade letters Then each has a word and the provisional chip has one", () => {
    expect([en["grade.S"], en["grade.P"], en["grade.D"], en["grade.A"], en["grade.provisional"]]).toEqual(["sourced", "proxy", "derived", "assumed", "provisional"]);
    expect([ko["grade.S"], ko["grade.P"], ko["grade.D"], ko["grade.A"], ko["grade.provisional"]]).toEqual(["출처 확인", "대리지표", "유도", "가정", "잠정"]);
  });
});
