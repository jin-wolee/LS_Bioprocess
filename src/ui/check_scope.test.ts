import { describe, expect, it } from "vitest";
import { CHECK_SEEDS } from "../../engine/src/experiments/assembly/lab/check.ts";
import { en } from "../i18n/en.ts";
import { ko } from "../i18n/ko.ts";
import type { CheckDetail } from "../protocol.ts";
import { CHECK_SCOPE, CheckPanel, CheckScope } from "./CheckPanel.tsx";

// P9 (audit item 20, the author's decision of 2026-11-03; lab_ui.md section 7): the chip of the browser check and the Notes screen say what the check covers: the determinism of the default scenario's open
// loop (the seeds 1 to 3, the metric cells of seed 1) against the reference made in Node, not every scenario and not the closed loop of SC8. The figures reach the text as labels, never as a typed digit.

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
    if (isVNode(node.props.parts) || (typeof node.props.parts === "object" && node.props.parts !== null)) walk(Object.values(node.props.parts as object), found);
  }
  return found;
};
const detail: CheckDetail = { runs_ms: [], truth: [], repeats_equal: false, cells_equal: false };
const placeholders = (text: string): string[] => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1] as string).sort();

describe("what the check covers", () => {
  it("Given the figures of the scope Then the seeds are those the Worker checks and the cells are those of seed 1, typed by hand from lab_ui.md section 7", () => {
    expect(CHECK_SCOPE.seeds).toBe(CHECK_SEEDS.join(", "));
    expect(CHECK_SCOPE).toEqual({ seeds: "1, 2, 3", cell_seed: "1", closed_loop: "SC8" });
  });

  it("Given the Home panel in any state Then the chip is described by the scope note, which carries its three figures as labels", () => {
    for (const state of ["pending", "identical", "failed", "error"] as const) {
      const nodes = walk(CheckPanel({ state, detail }));
      expect(nodes.find((n) => n.props.id === "check-chip")?.props["aria-describedby"], state).toBe("check-scope");
      const scope = nodes.find((n) => n.type === CheckScope);
      expect(scope?.props.id, state).toBe("check-scope");
      const note = walk(CheckScope(scope?.props as { id?: string }))[0];
      expect(note?.props.id, state).toBe("check-scope");
      const labels = Object.values(note?.props.parts as Record<string, VNode>).map((part) => part.props.children);
      expect(labels, state).toEqual(["1, 2, 3", "1", "SC8"]);
    }
  });

  it("Given the note of the Notes screen (no id of its own) Then it is the same text with the same three labels", () => {
    const note = walk(CheckScope({}))[0];
    expect(note?.props.k).toBe("check.scope");
    expect(note?.props.id).toBeUndefined();
    expect(Object.keys(note?.props.parts as object)).toEqual(["seeds", "cell_seed", "closed_loop"]);
  });

  it("Given both dictionaries Then the text names the open loop, the seeds and the cells, and says that other scenarios and the closed loop are not covered, with no digit typed", () => {
    expect(placeholders(en["check.scope"])).toEqual(["cell_seed", "closed_loop", "seeds"]);
    expect(placeholders(ko["check.scope"])).toEqual(["cell_seed", "closed_loop", "seeds"]);
    const english = en["check.scope"].toLowerCase();
    for (const word of ["open loop", "default scenario", "seeds {seeds}", "metric cells", "seed {cell_seed}", "reference", "node", "every other scenario is not covered", "closed loop of {closed_loop}"]) expect(english, word).toContain(word);
    for (const word of ["기본 시나리오", "열린 루프", "시드 {seeds}", "지표 셀", "시드 {cell_seed}", "기준", "다른 시나리오", "닫힌 루프"]) expect(ko["check.scope"], word).toContain(word);
    expect(en["check.scope"]).not.toMatch(/\d/);
  });

  it("Given the text of every state Then the note says nothing that only a passed check may say", () => {
    expect(en["check.scope"].toLowerCase()).not.toMatch(/reproducib|byte for byte/);
  });
});
