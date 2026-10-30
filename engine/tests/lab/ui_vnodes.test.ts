import { describe, expect, it } from "vitest";
import { ErrorBlock } from "../../../src/ui/ErrorBlock.tsx";
import { Ref } from "../../../src/ui/Ref.tsx";

// Preact elements are plain objects, so a component that uses no hook can be called and its output inspected without a DOM. These tests check the two page-side rules of the design that the
// Worker tests cannot: an engine message is shown verbatim in a lang="en" element (section 4, rule 4), and an input carries its ledger id, grade and provisional chip (section 6).

interface VNode {
  type: unknown;
  props: Record<string, unknown>;
}

const isVNode = (x: unknown): x is VNode => typeof x === "object" && x !== null && "type" in x && "props" in x;
const walk = (node: unknown, found: VNode[] = []): VNode[] => {
  if (Array.isArray(node)) node.forEach((n) => walk(n, found));
  else if (isVNode(node)) {
    found.push(node);
    walk(node.props.children, found);
  }
  return found;
};
/** The dictionary keys of the T components in a tree. */
const keysOf = (tree: unknown): unknown[] => walk(tree).filter((n) => typeof n.type === "function" && "k" in n.props).map((n) => n.props.k);

describe("ErrorBlock", () => {
  const message = "scenario default: the cohort size must be positive (A188)";

  it("Given an engine message Then it is shown verbatim in a pre element with lang=en, as a label", () => {
    const pre = walk(ErrorBlock({ problem: { code: "engine_error", message } })).find((n) => n.type === "pre");
    expect(pre?.props.lang).toBe("en");
    expect(pre?.props.children).toBe(message);
    expect(pre?.props["data-label"]).toBe(true);
  });

  it.each([
    ["invalid_spec", "error.invalid_spec"],
    ["engine_error", "error.engine_error"],
    ["worker", "error.worker"],
  ] as const)("Given the code %s Then the sentence above the message is the dictionary key %s, translated, and the heading is error.heading", (code, key) => {
    const keys = keysOf(ErrorBlock({ problem: { code, message } }));
    expect(keys).toEqual(["error.heading", key]);
  });

  it("Given a problem Then the block is an alert that names the code", () => {
    const root = ErrorBlock({ problem: { code: "invalid_spec", message } }) as unknown as VNode;
    expect(root.props.role).toBe("alert");
    expect(root.props["data-problem"]).toBe("invalid_spec");
  });
});

describe("Ref", () => {
  const rootOf = (ids: string[]): VNode => Ref({ ids, children: "24 reactors" }) as unknown as VNode;

  it("Given an assumption with no source (A001, grade A) Then it reads assumed and is not provisional", () => {
    const root = rootOf(["A001"]);
    expect(root.props["data-ref"]).toBe("A001");
    expect(root.props["data-grade"]).toBe("A");
    expect(root.props["data-status"]).toBeUndefined();
    expect(keysOf(root)).toEqual(["grade.A"]);
  });

  it("Given an assumption on a source below main-reread (A004: S017 is main-reread, S019 is not) Then it carries the provisional chip", () => {
    const root = rootOf(["A004"]);
    expect(root.props["data-grade"]).toBe("S");
    expect(root.props["data-status"]).toBe("provisional");
    expect(keysOf(root)).toEqual(["grade.S", "grade.provisional"]);
  });

  it("Given two ids Then data-ref lists both, the grade is the weakest, and the chip appears if either is provisional", () => {
    const root = rootOf(["A001", "A004"]);
    expect(root.props["data-ref"]).toBe("A001 A004");
    expect(root.props["data-grade"]).toBe("A");
    expect(root.props["data-status"]).toBe("provisional");
  });

  it("Given the value and unit Then they are the first child, as the scenario file gives them", () => {
    const children = walk(rootOf(["A001"])).find((n) => n.props.class === "ref-value");
    expect(children?.props.children).toBe("24 reactors");
  });
});
