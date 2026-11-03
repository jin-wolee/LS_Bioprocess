import { describe, expect, it } from "vitest";
import { LinkNotes } from "./LinkNotes.tsx";
import { OriginBar } from "./OriginBar.tsx";
import { waitsForSample } from "../ui/useOrigin.ts";

// The bar of a screen opened from the plant and the notes on the plant link, as elements (no DOM; docs/design/plant_ui.md section 7, "As built in P5c"). A function component that uses no hook can be
// called and its output walked.

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
const marked = (nodes: VNode[], attribute: string): string[] => nodes.filter((n) => attribute in n.props).map((n) => String(n.props[attribute]));
const keys = (nodes: VNode[]): string[] => nodes.filter((n) => typeof n.props.k === "string").map((n) => n.props.k as string);

const bar = (extra: Partial<Parameters<typeof OriginBar>[0]> = {}) =>
  walk(OriginBar({ scenario: "default", seed: 1, actions: 0, carried: 0, t: 305626, backHref: "#/plant?scenario=default&t=305626", results: false, utilisation: false, ...extra }));

describe("the bar of a screen opened from the plant", () => {
  it("Given Lineage or Notes Then it names the run, links back to the plant, and says nothing about Results", () => {
    const nodes = bar();
    expect(nodes.find((n) => n.type === "a")?.props.href).toBe("#/plant?scenario=default&t=305626");
    expect(keys(nodes)).toContain("plant.origin.run");
    expect(marked(nodes, "data-note")).toEqual([]);
  });

  it("Given Setup or Results Then it says which plant actions Results carries (the kinds) and how many of this plant's actions that is, and no longer that it carries none", () => {
    const nodes = bar({ results: true, actions: 3, carried: 2 });
    expect(marked(nodes, "data-note")).toEqual(["origin-results"]);
    const note = nodes.find((n) => n.props["data-note"] === "origin-results");
    expect(note?.props.k).toBe("plant.origin.results");
    const parts = note?.props.parts as Record<string, VNode>;
    expect([parts.carried?.props.children, parts.actions?.props.children]).toEqual([2, 3]);
  });

  it("Given the reader came for the utilisation block Then Setup also says where it is", () => {
    expect(marked(bar({ results: true, utilisation: true }), "data-note")).toEqual(["origin-results", "origin-utilisation"]);
    expect(marked(bar({ results: false, utilisation: true }), "data-note")).toEqual([]);
  });

  it("Given no instant Then the run is named without one", () => {
    expect(keys(bar({ t: null }))).toContain("plant.origin.run_open");
    expect(keys(bar({ t: null }))).not.toContain("plant.origin.run");
  });
});

describe("the notes on the plant link", () => {
  const notes = (extra: Partial<Parameters<typeof LinkNotes>[0]> = {}) => walk(LinkNotes({ notes: [], fallbackSeed: 1, outside: null, horizon: 864000, engine: { made: "9.9.9", current: "9.9.9" }, ...extra }));

  it("Given a link that was read as it stood Then there is nothing to say", () => {
    expect(LinkNotes({ notes: [], fallbackSeed: 1, outside: null, horizon: 864000, engine: { made: "9.9.9", current: "9.9.9" } })).toBeNull();
    expect(LinkNotes({ notes: [], fallbackSeed: 1, outside: null, horizon: null, engine: { made: null, current: "9.9.9" } })).toBeNull();
  });

  it("Given keys that fell back, an instant outside the run and another engine Then each is a line of its own, naming the key", () => {
    const nodes = notes({ notes: [{ field: "scenario", given: "nonesuch" }, { field: "seed", given: "-1" }], outside: "10000000", engine: { made: "0.1.0", current: "9.9.9" } });
    expect(marked(nodes, "data-link-note")).toEqual(["scenario", "seed", "t_range", "engine"]);
  });

  it("Given an instant outside the run before the plan has arrived Then nothing is said about it yet", () => {
    expect(notes({ outside: "10000000", horizon: null })).toEqual([]);
  });
});

describe("a Lineage link from the plant that has not asked for its sample yet (P8a)", () => {
  const KNOWN = { scenarios: ["default"], architectures: ["a_manual", "b_lims_lite", "c_context"] };
  const plant = "scenario=default&arch=a_manual,c_context&seed=1&t=305626&schema=1&engine=9.9.9";
  const query = `from=plant&sample=U03-D03-1&plant=${encodeURIComponent(plant)}`;

  it("Given a link that names a sample and was not handled Then the screen waits for it", () => {
    expect(waitsForSample(query, null, KNOWN)).toBe(true);
    expect(waitsForSample(query, "from=plant&sample=U01-D01-1", KNOWN)).toBe(true);
  });

  it("Given the link was handled, has no sample, did not come from the plant, or names a case Then there is nothing to wait for", () => {
    expect(waitsForSample(query, query, KNOWN)).toBe(false);
    expect(waitsForSample(`from=plant&plant=${encodeURIComponent(plant)}`, null, KNOWN)).toBe(false);
    expect(waitsForSample("", null, KNOWN)).toBe(false);
    expect(waitsForSample("sample=U03-D03-1", null, KNOWN)).toBe(false);
    expect(waitsForSample(query, null, null)).toBe(false);
    const caseQuery = `from=plant&sample=U01-D01-1&plant=${encodeURIComponent("case=sc12_medium_lot&arch=a_manual&seed=9013&schema=1&engine=9.9.9")}`;
    expect(waitsForSample(caseQuery, null, { ...KNOWN, breakout: { cases: ["sc12_medium_lot"], seed: 9013, architectures: ["a_manual"] } })).toBe(false);
  });
});
