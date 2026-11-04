import { describe, expect, it } from "vitest";
import { en } from "../i18n/en.ts";
import { ko } from "../i18n/ko.ts";
import type { CheckDetail, CheckState } from "../protocol.ts";
import { CheckDetails, CheckStatus } from "./CheckPanel.tsx";
import { Home } from "./Home.tsx";
import { ResultBlock } from "./ResultBlock.tsx";
import { ScenarioInputs } from "./ScenarioInputs.tsx";
import { initial } from "./state.ts";
import type { State } from "./state.ts";

// P11 (an outside review the author shared on 2026-11-04: on Home, the check details and the inputs run long before anything to do): Home leads with the plant's card, keeps the status line of the
// browser check near the top, and puts what the check covers and compared, the versions and the inputs into one closed fold below the run. Preact elements are plain objects, so the page is read
// without a DOM: the order of what Home returns, what the fold holds, and that the status line (the chip and the live-region banner) is outside it. That a reader sees the status line with the fold
// closed, and that the QA still finds every element, is the lab QA's `check` (scripts/qa/qa_lab_checks.py).

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
const children = (n: VNode): VNode[] => (Array.isArray(n.props.children) ? n.props.children : [n.props.children]).filter(isVNode);
const detail: CheckDetail = { runs_ms: [], truth: [], repeats_equal: false, cells_equal: false };
const STATES: CheckState[] = ["pending", "identical", "failed", "error"];

const home = (state: State = initial): VNode[] => children(Home({ state }) as unknown as VNode);
/** What a top-level block of Home is called here: the id of an element, the section's heading for an unnamed one, or the component. */
const name = (n: VNode): string =>
  typeof n.type === "string" ? String(n.props.id ?? n.props["aria-labelledby"] ?? n.type) : n.type === CheckStatus ? "CheckStatus" : String((n.type as { name?: string }).name);

describe("Home, in order", () => {
  it("Given Home Then it reads the heading, the plant's card, the status line of the check, the run, and last the closed fold", () => {
    expect(home().map(name)).toEqual(["home-heading", "plant-entry", "CheckStatus", "run", "about-run"]);
  });

  it("Given the plant's card Then it comes before every other block but the heading and carries the one link into the plant", () => {
    const [, card] = home();
    const links = walk(card).filter((n) => n.type === "a");
    expect(links.map((a) => [a.props.id, a.props.href])).toEqual([["enter-plant", "#/plant"]]);
    expect(walk(card).some((n) => n.props.k === "home.plant.heading")).toBe(true);
  });

  it("Given the intro Then it keeps its notice that everything is synthetic, above the card", () => {
    const [intro] = home();
    expect(walk(intro).filter((n) => typeof n.props.k === "string").map((n) => n.props.k)).toEqual(["home.heading", "home.lead", "home.notice"]);
  });
});

describe("Home, the status line", () => {
  it.each(STATES)("Given the state %s Then the chip names it and the banner is a live region, both in the status line and neither in the fold", (state) => {
    const s: State = { ...initial, check: { state, detail } };
    const blocks = home(s);
    const status = blocks.find((n) => n.type === CheckStatus) as VNode;
    expect(status.props.state).toBe(state);
    const nodes = walk(CheckStatus({ state, detail }));
    expect(nodes.find((n) => n.props.id === "check-chip")?.props["data-check-state"]).toBe(state);
    expect(nodes.find((n) => n.props.id === "check-banner")?.props.role).toBe("status");
    const fold = blocks.find((n) => name(n) === "about-run") as VNode;
    const inFold = [...walk(fold), ...walk(CheckDetails({ state, detail }))];
    expect(inFold.filter((n) => n.props.id === "check-chip" || n.props.id === "check-banner" || n.props.role === "status")).toEqual([]);
    expect(inFold.some((n) => n.type === CheckStatus)).toBe(false);
  });

  it("Given the status line Then it is a block of its own before the run, so a reader does not open anything to see whether the check passed", () => {
    const names = home().map(name);
    expect(names.indexOf("CheckStatus")).toBeGreaterThan(names.indexOf("plant-entry"));
    expect(names.indexOf("CheckStatus")).toBeLessThan(names.indexOf("run"));
    expect(names.indexOf("CheckStatus")).toBeLessThan(names.indexOf("about-run"));
  });
});

describe("Home, the fold", () => {
  const fold = (state: State = initial): VNode => home(state).find((n) => name(n) === "about-run") as VNode;

  it("Given the fold Then it is one details element, closed, with its summary first", () => {
    const f = fold();
    expect(f.type).toBe("details");
    expect(f.props.open).toBeUndefined();
    expect(home().filter((n) => n.type === "details")).toHaveLength(1);
    const [summary] = children(f);
    expect([summary?.props.as, summary?.props.k]).toEqual(["summary", "home.about.summary"]);
  });

  it("Given the fold Then it holds what the check covers and compared, the versions and the inputs, and nothing was removed", () => {
    const f = fold();
    const nodes = walk(f);
    expect(nodes.some((n) => n.type === CheckDetails)).toBe(true);
    expect(nodes.find((n) => n.props.id === "versions")?.type).toBe("section");
    expect(nodes.find((n) => n.props.id === "inputs")?.type).toBe("section");
    expect(nodes.some((n) => n.type === ScenarioInputs)).toBe(true);
    expect(nodes.filter((n) => typeof n.props.k === "string").map((n) => n.props.k)).toEqual(
      expect.arrayContaining(["home.about.summary", "home.versions.heading", "home.versions.engine", "home.versions.schema", "home.inputs.heading", "home.inputs.lead"]),
    );
  });

  it("Given the headings inside the fold Then they are third-level, since the fold belongs to the run above it", () => {
    const headings = walk(fold()).filter((n) => typeof n.props.k === "string" && /heading$/.test(String(n.props.k)));
    expect(headings.map((h) => [h.props.k, h.props.as])).toEqual([["home.versions.heading", "h3"], ["home.inputs.heading", "h3"]]);
    expect(walk(CheckDetails({ state: "identical", detail })).filter((n) => n.props.k === "check.detail.heading").map((h) => h.props.as)).toEqual(["h3"]);
  });

  it("Given the run Then it stays outside the fold and still carries its result block", () => {
    const withResult = { ...initial, home: { id: 1, summary: {}, footer: { check: "identical" } } } as unknown as State;
    const run = home(withResult).find((n) => name(n) === "run") as VNode;
    expect(walk(run).some((n) => n.type === ResultBlock)).toBe(true);
    expect(walk(fold(withResult)).some((n) => n.type === ResultBlock)).toBe(false);
  });

  it("Given the details of the check Then they are the scope sentence with its id, and what was compared only when the check has settled", () => {
    for (const state of STATES) {
      const nodes = walk(CheckDetails({ state, detail }));
      expect(nodes.some((n) => n.props.id === "check-scope"), state).toBe(true);
      expect(nodes.some((n) => n.props.k === "check.detail.heading"), state).toBe(state === "identical" || state === "failed");
    }
  });
});

describe("Home, the texts", () => {
  it("Given the summary of the fold Then it is as the brief says in both languages and holds no digit", () => {
    expect(en["home.about.summary"]).toBe("About this run: checks and inputs");
    expect(ko["home.about.summary"]).toBe("이 실행에 대해: 검사와 입력값");
    expect(en["home.about.summary"] + ko["home.about.summary"]).not.toMatch(/\d/);
  });
});
