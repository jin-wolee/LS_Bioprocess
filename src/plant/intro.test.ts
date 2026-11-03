import { describe, expect, it } from "vitest";
import { template } from "../i18n/index.ts";
import { Intro } from "./Intro.tsx";

// The lead under the plant (docs/design/plant_ui.md section 9; P8a): it names the scenario of the run the link opened, not "the default scenario" whatever the spec. Intro uses no hook, so it is called and its output walked.

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

const intro = (scenario: string, breakout = false) =>
  walk(Intro({ webgl: true, planned: true, breakout, scenario, problem: null, scene: { kind: "ready" }, state: "ready", renderer: null }));
const lead = (nodes: VNode[]): VNode | undefined => nodes.find((n) => n.props.k === "plant.lead");
const named = (node: VNode | undefined): unknown => {
  const parts = node?.props.parts as Record<string, VNode> | undefined;
  return parts?.scenario?.props.children;
};

describe("the lead under the plant", () => {
  it("Given a link that opened another scenario Then the lead names it", () => {
    expect(named(lead(intro("sc02_shift_burst")))).toBe("sc02_shift_burst");
    expect(named(lead(intro("sc05_one_analyzer_down")))).toBe("sc05_one_analyzer_down");
  });

  it("Given the default scenario Then the lead names it by its id too, so that one text serves every run", () => {
    expect(named(lead(intro("default")))).toBe("default");
  });

  it("Given a break-out case Then the lead is the case's own and carries no scenario slot", () => {
    const nodes = intro("sc12_medium_lot", true);
    expect(lead(nodes)).toBeUndefined();
    expect(nodes.some((n) => n.props.k === "plant.case.lead")).toBe(true);
  });

  it("Given either language Then the lead holds the slot and no scenario is typed into the text", () => {
    for (const lang of ["en", "ko"] as const) {
      const text = template(lang, "plant.lead");
      expect(text).toContain("{scenario}");
      expect(text).not.toMatch(/default|기본/);
    }
  });
});
