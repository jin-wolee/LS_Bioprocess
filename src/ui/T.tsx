import { createContext } from "preact";
import type { ComponentChildren } from "preact";
import { useContext } from "preact/hooks";
import { text } from "../i18n/index.ts";
import type { Key, Lang } from "../i18n/index.ts";

export const LangContext = createContext<Lang>("en");

type Tag = "span" | "p" | "h1" | "h2" | "h3" | "dt" | "th" | "summary" | "strong" | "caption" | "option";

/** A dictionary text in the current language. `data-i18n` names the key, so the end-to-end check `ko` can compare the two languages element by element. */
export function T({ k, as: Element = "span", params, id, class: className, value }: { k: Key; as?: Tag; params?: Record<string, string>; id?: string; class?: string; value?: string }) {
  const lang = useContext(LangContext);
  return (
    <Element data-i18n={k} {...(id && { id })} {...(className && { class: className })} {...(value !== undefined && { value })}>
      {text(lang, k, params)}
    </Element>
  );
}

/** A label (invariant 3): an identifier or a count of things on screen. Engine strings are English data and say so with lang="en". */
export function Label({ children, engine = false }: { children: ComponentChildren; engine?: boolean }) {
  return (
    <span data-label {...(engine && { lang: "en" })}>
      {children}
    </span>
  );
}
