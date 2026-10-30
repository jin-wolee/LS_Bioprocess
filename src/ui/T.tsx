import { createContext } from "preact";
import type { ComponentChildren } from "preact";
import { useContext } from "preact/hooks";
import { template, text } from "../i18n/index.ts";
import type { Key, Lang } from "../i18n/index.ts";

export const LangContext = createContext<Lang>("en");

type Tag = "span" | "p" | "h1" | "h2" | "h3" | "h4" | "dt" | "dd" | "th" | "td" | "li" | "label" | "legend" | "summary" | "strong" | "caption" | "option" | "button";

/** The pieces of a template: its text, with each {placeholder} replaced by the element given for it (or by its plain value, or left as it is). */
export const piecesOf = (templateText: string, params: Readonly<Record<string, string>> = {}, parts: Readonly<Record<string, ComponentChildren>> = {}): ComponentChildren[] =>
  templateText.split(/(\{\w+\})/).map((piece) => {
    const name = /^\{(\w+)\}$/.exec(piece)?.[1];
    return name === undefined ? piece : (parts[name] ?? params[name] ?? piece);
  });

/**
 * A dictionary text in the current language. `data-i18n` names the key, so the end-to-end check `ko` can compare the two languages element by element. `params` fill {placeholders} with
 * plain words; `parts` fill them with elements, which is how a number reaches a text: as an input (<Ref>), an output or a label, never as a digit typed into the dictionary.
 */
export function T({ k, as: Element = "span", params, parts, id, class: className, value, ...rest }: {
  k: Key;
  as?: Tag;
  params?: Record<string, string>;
  parts?: Record<string, ComponentChildren>;
  id?: string;
  class?: string;
  value?: string;
  for?: string;
  "data-note"?: string;
  "data-warn"?: string;
}) {
  const lang = useContext(LangContext);
  return (
    <Element data-i18n={k} {...(id && { id })} {...(className && { class: className })} {...(value !== undefined && { value })} {...rest}>
      {parts ? piecesOf(template(lang, k), params, parts) : text(lang, k, params)}
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
