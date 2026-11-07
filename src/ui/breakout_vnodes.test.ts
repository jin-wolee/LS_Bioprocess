import { describe, expect, it } from "vitest";
import { MYCOPLASMA_NOTE } from "../../engine/src/experiments/assembly/breakout_report.ts";
import { en } from "../i18n/en.ts";
import { ko } from "../i18n/ko.ts";
import type { BreakoutResult } from "../protocol.ts";
import { Breakout, C29, FormPanel, ResultView } from "./Breakout.tsx";
import { ArchitectureBlock } from "./BreakoutArchitecture.tsx";
import { MetricCell, Metrics } from "./BreakoutMetrics.tsx";
import { BREAKOUT_READY, RESULT, architecture } from "./breakout_fixture.ts";
import { defaultBreakoutForm } from "./breakout_view.ts";
import type { Offer } from "../breakout_offer.ts";
import { initial } from "./state.ts";
import type { State } from "./state.ts";

// The Break-out screen as elements (no DOM; lab_ui.md sections 3, 6, 11 and 20): when it is offered and how it is marked, that direction 3 of a record that cannot read it says so and shows no
// number, that recall is always beside precision and the false-alarm rate, that the C29 sentence is on a mycoplasma result and only there, and that the texts order nothing. Preact elements are
// plain objects, so a component with no hook of its own can be called and its output walked; a child component stays an element with its props.

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
    // props that hold elements of their own (the parts of a text) are not children: only the ones a test reads are followed
  }
  return found;
};
const named = (nodes: VNode[], name: string): VNode[] => nodes.filter((n) => typeof n.type === "function" && (n.type as { name?: string }).name === name);
const keys = (nodes: VNode[]): unknown[] => nodes.flatMap((n) => (typeof n.props.k === "string" ? [n.props.k] : []));
/** The output of the components of this name in a tree (they use no hook, so they can be called). */
const expand = (nodes: VNode[], name: string): VNode[] => walk(named(nodes, name).map((n) => (n.type as (p: unknown) => unknown)(n.props)));

const state = (result: BreakoutResult | null): State => ({ ...initial, ready: BREAKOUT_READY, breakout: { running: null, asked: null, result, problem: null } });
const screen = (offer: Offer, result: BreakoutResult | null = null, ready = BREAKOUT_READY) =>
  walk(Breakout({ ready, state: state(result), form: defaultBreakoutForm(ready), setForm: () => {}, offer, onRun: () => {} }));

describe("when the screen is offered (the public-build refusal of lab_ui.md section 6)", () => {
  it("Given a build that refuses it Then the screen says so, offers no form and shows no result", () => {
    const nodes = screen("refused", RESULT, { ...BREAKOUT_READY, breakout: null });
    expect(named(nodes, "Refused")).toHaveLength(1);
    expect(keys(expand(nodes, "Refused"))).toEqual(["breakout.refused.heading", "breakout.refused.text"]);
    expect(named(nodes, "FormPanel")).toHaveLength(0);
    expect(named(nodes, "ResultView")).toHaveLength(0);
  });

  it("Given a build that refuses it though the data is there Then the screen still refuses: the offer decides, not the data", () => {
    const nodes = screen("refused", RESULT);
    expect(named(nodes, "Refused")).toHaveLength(1);
    expect(named(nodes, "FormPanel")).toHaveLength(0);
  });

  it("Given a local build while a source is below main-reread Then the screen is marked not for publication", () => {
    const nodes = screen("local_only");
    expect(nodes.find((n) => n.props["data-note"] === "not-for-publication")?.props.k).toBe("breakout.local.notice");
    expect(named(nodes, "FormPanel")).toHaveLength(1);
  });

  it("Given a build that offers it with every source re-read Then there is no mark", () => {
    const nodes = screen("offered");
    expect(nodes.some((n) => n.props["data-note"] === "not-for-publication")).toBe(false);
    expect(named(nodes, "FormPanel")).toHaveLength(1);
  });

  it("Given a build with no break-out data though the offer says offered Then the screen still refuses rather than draw a form that cannot work", () => {
    expect(named(screen("offered", null, { ...BREAKOUT_READY, breakout: null }), "Refused")).toHaveLength(1);
  });
});

describe("the form", () => {
  const form = () => walk(FormPanel({ ready: BREAKOUT_READY, form: defaultBreakoutForm(BREAKOUT_READY), setForm: () => {}, onRun: () => {}, busy: false }));

  it("Given the ablations Then they are one flag list with one entry per ablation, so the check flags sees every flag once", () => {
    const list = form().find((n) => n.props["data-flag-list"] === "breakout-ablations") as VNode;
    const flags = walk(list.props.children).flatMap((n) => (typeof n.props["data-flag"] === "string" ? [n.props["data-flag"]] : []));
    expect(flags).toEqual(["audit_trail", "material_lot_links", "equipment_links"]);
  });

  it("Given the cases Then the select lists them by id", () => {
    const select = form().find((n) => n.type === "select" && n.props.id === "breakout-case") as VNode;
    expect(walk(select.props.children).filter((n) => n.type === "option").map((n) => n.props.value)).toEqual(["sc12_medium_lot", "sc12_mycoplasma"]);
  });
});

describe("the result", () => {
  const view = (result: BreakoutResult) => walk(ResultView({ result, ready: BREAKOUT_READY, state: state(result) }));
  const nodes = view(RESULT);

  it("Given a result in the state Then the screen shows it", () => {
    expect(named(screen("local_only", RESULT), "ResultView")).toHaveLength(1);
    expect(named(screen("local_only", null), "ResultView")).toHaveLength(0);
  });

  it("Given a result Then it sits in a result block of this scenario, seed and architectures (invariant 3), one block per architecture in the order asked", () => {
    const block = named(nodes, "ResultBlock")[0] as VNode;
    expect(block.props.footer).toMatchObject({ kind: "simulation_result", scenario: "sc12_medium_lot", seeds: [9013], architectures: ["a_manual", "c_context"], engine_version: "9.9.9" });
    expect(named(nodes, "ArchitectureBlock").map((n) => (n.props.arch as { architecture: string }).architecture)).toEqual(["a_manual", "c_context"]);
  });

  it("Given a result Then the event, the inputs with their ids, the topology and what the plant showed are on the screen", () => {
    for (const name of ["EventFacts", "Inputs", "Topology", "Observed"]) expect(named(nodes, name), name).toHaveLength(1);
  });

  it("Given a bacterial result Then there is no C29 sentence; given a mycoplasma result Then there is one, and it is the sentence of the ruling", () => {
    expect(named(nodes, "C29")).toHaveLength(0);
    const myco = view({ ...RESULT, event: { ...RESULT.event, type: "mycoplasma" }, c29: MYCOPLASMA_NOTE });
    expect(named(myco, "C29")).toHaveLength(1);
    expect(keys(walk(C29()))).toEqual(["breakout.c29.heading", "breakout.c29.text"]);
  });

  it("Given the C29 sentence of the dictionary Then it says what the report says: the stop rule stays, and the effects show on a sibling and not on the signalling unit", () => {
    const text = en["breakout.c29.text"];
    expect(text.startsWith("The stop rule stays.")).toBe(true);
    expect(MYCOPLASMA_NOTE.toLowerCase()).toContain("the stop rule stays.");
    expect(MYCOPLASMA_NOTE).toContain(text.slice("The stop rule stays. ".length));
    expect(ko["breakout.c29.text"]).toMatch(/정지 규칙/);
  });
});

describe("direction 3 of a record that cannot read it", () => {
  const a = architecture("a_manual", false);
  const c = architecture("c_context", true);
  const treeOf = (arch: typeof a) => walk(ArchitectureBlock({ arch, result: RESULT, ready: BREAKOUT_READY }));

  it("Given A, with neither link flag Then direction 3 is not reachable from this record: a text of its own, no set, and the three rows say so", () => {
    const nodes = treeOf(a);
    expect(nodes.find((n) => n.props["data-breakout-arch"])?.props["data-reach"]).toBe("not_reachable");
    const directions = expand(nodes, "Directions");
    expect(directions.find((n) => n.props["data-direction-set"] === "3")?.props["data-d3"]).toBe("not_reachable");
    expect(keys(directions)).toContain("breakout.d3.unreachable");
    expect(keys(directions)).not.toContain("breakout.d3.empty");
    const d3 = expand(nodes, "Metrics").filter((n) => n.props["data-direction"] === 3);
    expect(named(walk(d3), "MetricCell").map((n) => (n.props.row as { status: string }).status)).toEqual(["not_reachable", "not_reachable", "not_reachable"]);
  });

  it("Given C Then direction 3 is a set, and an empty set would be stated as such", () => {
    const directions = (arch: typeof c) => expand(treeOf(arch), "Directions");
    const d3 = directions(c).find((n) => n.props["data-direction-set"] === "3");
    expect(d3?.props["data-d3"]).toBe("set");
    expect(d3?.props["data-count"]).toBe(1);
    const empty = { ...c, walk: { ...c.walk, direction_3: [] } };
    expect(keys(directions(empty))).toContain("breakout.d3.empty");
    expect(directions(empty).find((n) => n.props["data-direction-set"] === "3")?.props["data-d3"]).toBe("set");
  });

  it("Given an architecture block Then it lists the flags of the record (data-flag-list) and names the flags direction 3 needs from the result, not from the page", () => {
    const nodes = treeOf(c);
    expect(named(nodes, "FlagLegend").map((n) => n.props.list)).toEqual(["breakout-column"]);
    const needs = nodes.find((n) => n.props.k === "breakout.needs");
    expect(Object.keys(needs?.props.parts as object).sort()).toEqual(["equipment", "lots", "n"]);
  });
});

describe("recall is always beside precision and the false-alarm rate (spec section 8, rule 3)", () => {
  const cells = (rows = architecture("c_context", true).rows) => walk(Metrics({ rows }));

  it("Given the rows of an architecture Then each direction shows recall, precision and the false-alarm rate in one block, in this order", () => {
    const blocks = cells().filter((n) => n.props["data-direction"] !== undefined);
    expect(blocks.map((b) => b.props["data-direction"])).toEqual([1, 3]);
    for (const b of blocks) {
      const d = b.props["data-direction"];
      expect(named(walk(b), "MetricCell").map((n) => (n.props.row as { metric: string }).metric)).toEqual(["recall", "precision", "false_alarm"].map((m) => `identification.direction_${d}.${m}`));
    }
  });

  it("Given a figure that is not reachable Then its cell says so and carries no count and no value", () => {
    const row = architecture("a_manual", false).rows.find((r) => r.metric === "identification.direction_3.recall");
    const cell = MetricCell({ row: row as NonNullable<typeof row> });
    expect(cell.props["data-cell"]).toBe("not_reachable");
    expect(cell.props["data-num"]).toBeUndefined();
    expect(keys(walk(cell))).toContain("status.not_reachable");
    expect(keys(walk(cell))).not.toContain("breakout.cell.share");
  });

  it("Given a share Then the cell carries its count and its denominator", () => {
    const cell = MetricCell({ row: { metric: "identification.direction_1.recall", status: "reported", value: 1, num: 7, den: 7, denominator: "items of T", reason: null } });
    expect(cell.props).toMatchObject({ "data-cell": "share", "data-num": 7, "data-den": 7 });
  });
});

describe("the texts of the screen", () => {
  const own = Object.entries(en).filter(([k]) => k.startsWith("breakout."));

  it("Given the texts of the screen Then none ranks the architectures or names a winner, and none is a composite score", () => {
    const words = /\b(rank(s|ed|ing)?|best|better|worse|worst|win(s|ner|ning)?|outperform(s|ed)?|superior|inferior|leaderboard|score)\b/i;
    for (const [key, value] of own) expect(value, key).not.toMatch(words);
    for (const [key, value] of Object.entries(ko).filter(([k]) => k.startsWith("breakout."))) expect(value, key).not.toMatch(/순위|우수|최고|최상|열등|우열|승자|점수/);
  });

  it("Given the texts Then the screen never says what a record 'finds' as a fact about a real plant: it speaks of the simulation and of this record", () => {
    expect(en["breakout.lead"]).toMatch(/simulation results under the inputs shown, not a prediction of a real plant/);
  });
});
