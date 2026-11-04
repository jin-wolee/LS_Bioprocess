import { describe, expect, it } from "vitest";
import { en } from "../i18n/en.ts";
import { ko } from "../i18n/ko.ts";
import { text } from "../i18n/index.ts";
import { defaultForm } from "./form.ts";
import { READY } from "./fixture.ts";
import { Setup } from "./Setup.tsx";
import { initial } from "./state.ts";
import { T } from "./T.tsx";

// U2, the chips beside the scale inputs: a chip shows the scenario's default (the ledger entry the default comes from), not the value in the input; the author's report of 2026-11-04 had the input at 3
// beside a chip that read "2 analyzers A022". Elements are walked without a DOM (a function component that uses no hook can be called).

interface VNode {
  type: unknown;
  props: Record<string, unknown>;
}
const isVNode = (x: unknown): x is VNode => typeof x === "object" && x !== null && "type" in x && "props" in x;
/** Every element of a tree; a function component is called (so the elements of Count and Ref are seen too), and one that reads the language from a hook cannot be, and is left as an element. */
const walk = (node: unknown, found: VNode[] = []): VNode[] => {
  if (Array.isArray(node)) node.forEach((n) => walk(n, found));
  else if (isVNode(node)) {
    found.push(node);
    walk(node.props.children, found);
    if (typeof node.type === "function" && node.type !== T) {
      try {
        walk((node.type as (props: Record<string, unknown>) => unknown)(node.props), found);
      } catch {
        // a component that needs the language context is not called
      }
    }
  }
  return found;
};
const render = (form = defaultForm(READY, "default")): VNode[] => walk(Setup({ ready: READY, form, setForm: () => undefined, state: initial, link: "", linkEngine: null, leftOut: [], onRun: () => undefined, onCancel: () => undefined }));
const field = (nodes: VNode[], name: string): VNode[] => walk(nodes.find((n) => n.props["data-field"] === name));
/** The value that the chip of a key shows: the label that fills its {value}. */
const shown = (nodes: VNode[], key: string): unknown => ((nodes.find((n) => n.props.k === key)?.props.parts as Record<string, VNode> | undefined)?.value as VNode | undefined)?.props.children;

describe("Setup: the chips of the three scale inputs read as the default of the scenario", () => {
  it("Given the default scenario Then each chip is a Ref with the ledger id of its setting, and its text is the default key of that input with the scenario's value as a label", () => {
    const nodes = render();
    const expected = [["n", "A001", "setup.n.default", 24], ["baySize", "A001", "setup.baysize.default", 12], ["m", "A022", "setup.m.default", 2]] as const;
    for (const [name, id, key, value] of expected) {
      const inside = field(nodes, name);
      const ref = inside.find((n) => n.props.ids !== undefined);
      expect(ref?.props.ids, name).toEqual([id]);
      expect(shown(inside, key), name).toBe(value);
    }
  });

  it("Given an input typed away from the default Then the chip still shows the default (it follows the scenario, not the typed value)", () => {
    const form = { ...defaultForm(READY, "default"), m: "3" };
    expect(shown(field(render(form), "m"), "setup.m.default")).toBe(2);
  });

  it("Given the other scenario Then the chips show its defaults", () => {
    expect(shown(field(render(defaultForm(READY, "small")), "n"), "setup.n.default")).toBe(6);
  });
});

describe("the words of the chips, hand-typed", () => {
  it.each([
    ["setup.n.default", "default: 24 reactors", "기본값: 바이오리액터 24대"],
    ["setup.baysize.default", "default: 12 reactors per bay", "기본값: 베이당 바이오리액터 12대"],
    ["setup.m.default", "default: 2 analyzers", "기본값: 분석기 2대"],
  ] as const)("Given %s with the value filled in Then English says it is a default and Korean says the same", (key, english, korean) => {
    expect(text("en", key, { value: english.match(/\d+/)?.[0] ?? "" })).toBe(english);
    expect(text("ko", key, { value: korean.match(/\d+/)?.[0] ?? "" })).toBe(korean);
    expect(en[key]).not.toMatch(/\d/);
    expect(ko[key]).not.toMatch(/\d/);
  });
});
