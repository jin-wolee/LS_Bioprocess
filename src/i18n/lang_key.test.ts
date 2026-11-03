import { afterEach, describe, expect, it, vi } from "vitest";
import { saveLang, savedLang } from "./index.ts";

// The language choice is carried between the two pages (S3h3). On Pages they share one origin, so they share one localStorage; the infographic keeps its choice under `sll.lang` (site/infographic/src/app.js)
// and the lab now reads and writes the same key. The default stays English (ADR-0006). tests/test_language_carry.py checks that the two pages name the same key; scripts/qa/qa_site.py carries a choice across a click.

const KEY = "sll.lang";

const stubStorage = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial));
  vi.stubGlobal("localStorage", { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) });
  return data;
};

afterEach(() => vi.unstubAllGlobals());

describe("the saved language of the lab", () => {
  it("Given Korean saved under the key the infographic uses Then the lab opens in Korean", () => {
    stubStorage({ [KEY]: "ko" });
    expect(savedLang()).toBe("ko");
  });

  it("Given English saved under that key Then the lab opens in English", () => {
    stubStorage({ [KEY]: "en" });
    expect(savedLang()).toBe("en");
  });

  it("Given nothing saved Then the default is English (ADR-0006)", () => {
    stubStorage();
    expect(savedLang()).toBe("en");
  });

  it("Given a value that is not a language Then the lab opens in English", () => {
    stubStorage({ [KEY]: "fr" });
    expect(savedLang()).toBe("en");
  });

  it("Given blocked storage Then the lab opens in English and does not throw", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    expect(savedLang()).toBe("en");
    expect(() => saveLang("ko")).not.toThrow();
  });
});

describe("saving the language of the lab", () => {
  it("Given Korean chosen Then it is stored under the shared key and under no other", () => {
    const data = stubStorage();
    saveLang("ko");
    expect([...data.entries()]).toEqual([[KEY, "ko"]]);
  });

  it("Given Korean saved and English chosen Then the shared key reads English", () => {
    const data = stubStorage({ [KEY]: "ko" });
    saveLang("en");
    expect(data.get(KEY)).toBe("en");
  });
});
