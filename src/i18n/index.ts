import { en } from "./en.ts";
import type { Key } from "./en.ts";
import { ko } from "./ko.ts";

export type { Key };
export type Lang = "en" | "ko";

const DICTIONARIES: Record<Lang, Record<Key, string>> = { en, ko };
// The infographic keeps its language under this key (site/infographic/src/app.js): on Pages the two pages are one origin, so the choice made on one page is carried to the other.
const STORAGE_KEY = "sll.lang";

/** The text of a key in a language, with {name} placeholders filled from `params`. */
export const text = (lang: Lang, key: Key, params: Readonly<Record<string, string>> = {}): string =>
  (DICTIONARIES[lang][key] ?? key).replace(/\{(\w+)\}/g, (placeholder: string, name: string) => params[name] ?? placeholder);

/** The text of a key with its {placeholders} left in, for a screen that fills them with elements (a label, an input with its id). */
export const template = (lang: Lang, key: Key): string => DICTIONARIES[lang][key] ?? key;

/** Whether the dictionary has a key: a flag, a metric or an error type the engine adds later has none until its entries are written, and the screen then shows the name. */
export const hasKey = (key: string): key is Key => key in en;

/** The saved language, or English: the default is always English (ADR-0006). localStorage can be blocked, so every access is in try/catch. */
export const savedLang = (): Lang => {
  try {
    return localStorage.getItem(STORAGE_KEY) === "ko" ? "ko" : "en";
  } catch {
    return "en";
  }
};

export const saveLang = (lang: Lang): void => {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // blocked storage: the choice lasts for this visit only
  }
};
