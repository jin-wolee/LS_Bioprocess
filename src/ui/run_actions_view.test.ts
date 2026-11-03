import { describe, expect, it, vi } from "vitest";
import type { PlantAction, ResultFooter } from "../protocol.ts";
import { ErrorBlock } from "./ErrorBlock.tsx";
import { ClockReading } from "../plant/ActionRefs.tsx";
import { FooterInputs } from "./ResultBlock.tsx";
import { instantOf } from "./results_view.ts";
import { SetupActions } from "./SetupActions.tsx";
import { initial, reduce } from "./state.ts";

// P6b (docs/design/lab_ui.md section 22, item 8) as elements and as state, with no DOM: Setup's list of the carried actions with the control that drops them and the list of the ones it left out, a
// refusal of the run shown as a Worker error with the sentence of its reason, the actions Results prints, and the refusal in the page state. A function component that uses no hook can be called and its output walked.

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

const FEED: PlantAction = { kind: "add_feed", at: 291600, unit_id: "U03" };
const DOWN: PlantAction = { kind: "analyzer_down", at: 291600, analyzer: "AN-1", from: 306000, length_min: 120 };
const MOVE: PlantAction = { kind: "move_draw", at: 291600, sample_id: "U03-D03-1", to: 297000 };
const FLAG: PlantAction = { kind: "set_flag", at: 291600, architecture: "c_context", flag: "audit_trail", on: false };

describe("Setup: the actions from the plant", () => {
  it("Given carried actions Then each is a numbered item in words (in the order of the list), and one control drops them all", () => {
    const drop = vi.fn();
    const nodes = walk(SetupActions({ actions: [DOWN, FEED], leftOut: [], onDrop: drop }));
    expect(marked(nodes, "data-run-action")).toEqual(["analyzer_down", "add_feed"]);
    expect(keys(nodes)).toContain("setup.actions.heading");
    const button = nodes.find((n) => "data-drop-actions" in n.props);
    expect(button?.type).toBe("button");
    (button?.props.onClick as () => void)();
    expect(drop).toHaveBeenCalledTimes(1);
  });

  it("Given the plant's draw and lab setting left out Then each is listed with its reason, and there is no list of carried actions", () => {
    const nodes = walk(SetupActions({ actions: [], leftOut: [{ action: MOVE, why: "draw" }, { action: FLAG, why: "lab_setting" }], onDrop: () => undefined }));
    expect(marked(nodes, "data-left-out")).toEqual(["move_draw", "set_flag"]);
    expect(keys(nodes)).toEqual(expect.arrayContaining(["setup.actions.why.draw", "setup.actions.why.lab_setting"]));
    expect(marked(nodes, "data-run-action")).toEqual([]);
    expect(nodes.some((n) => "data-drop-actions" in n.props)).toBe(false);
  });

  it("Given nothing carried and nothing left out Then nothing is drawn (Setup opened without the plant is as before)", () => {
    expect(SetupActions({ actions: [], leftOut: [], onDrop: () => undefined })).toBeNull();
  });
});

describe("a refusal of the run is shown as a Worker error, with the sentence of its reason", () => {
  it("Given a refused problem Then the sentence of the reason, the action's place in the list that was sent and the Worker's message verbatim", () => {
    const nodes = walk(ErrorBlock({ problem: { id: 4, code: "refused", reason: "outside_window", index: 1, message: "actions[1] (act-2, add_feed U03): U03 is in culture after 1 s" } }));
    expect(keys(nodes)).toEqual(expect.arrayContaining(["plant.refusal.outside_window", "plant.refusal.index"]));
    expect(nodes.find((n) => n.props["data-problem"])?.props["data-problem"]).toBe("refused");
    expect(nodes.find((n) => n.type === "pre")?.props.children).toBe("actions[1] (act-2, add_feed U03): U03 is in culture after 1 s");
  });

  it("Given an error that is not a refusal Then it is shown as before", () => {
    expect(keys(walk(ErrorBlock({ problem: { id: 4, code: "invalid_spec", message: "no" } })))).toEqual(["error.heading", "error.invalid_spec"]);
  });

  it("Given the Worker's refused error Then the page state keeps its reason and its index, and ends the run", () => {
    const running = { ...initial, running: 4 };
    const next = reduce(running, { type: "error", id: 4, code: "refused", message: "m", reason: "past", index: 2 });
    expect(next.problem).toEqual({ id: 4, code: "refused", message: "m", reason: "past", index: 2 });
    expect(next.running).toBeNull();
    expect(reduce(running, { type: "error", id: 4, code: "invalid_spec", message: "m" }).problem).toEqual({ id: 4, code: "invalid_spec", message: "m" });
  });
});

describe("Results prints the actions it used", () => {
  const footer = (extra: Partial<ResultFooter> = {}): ResultFooter => ({ kind: "simulation_result", scenario: "default", seeds: [1, 2], engine_version: "9.9.9", architectures: ["a_manual"], inputs: [], check: "identical", ...extra });

  it("Given a result that used two actions Then they are listed in words above the inputs, in the order of the footer", () => {
    const nodes = walk(FooterInputs({ footer: footer({ actions: [FEED, DOWN] }) }));
    expect(marked(nodes, "data-results-action")).toEqual(["add_feed", "analyzer_down"]);
    expect(keys(nodes)).toContain("results.actions.heading");
  });

  it("Given a result with no actions Then nothing about actions is drawn", () => {
    const nodes = walk(FooterInputs({ footer: footer() }));
    expect(marked(nodes, "data-results-action")).toEqual([]);
    expect(keys(nodes)).not.toContain("results.actions.heading");
  });
});

describe("Results prints the instant of an action as the list prints it (P8a)", () => {
  const footer = (): ResultFooter => ({
    kind: "simulation_result", scenario: "default", seeds: [1, 2], engine_version: "9.9.9", architectures: ["a_manual"], check: "identical", actions: [FEED, DOWN],
    inputs: [
      { name: "sla_hold_threshold_min", value: 30, unit: "min", ref: "A097" },
      { name: "act-1 add_feed U03 at", value: 4860, unit: "min", ref: "A228" },
      { name: "act-2 analyzer_down AN-1 from", value: 5100, unit: "min", ref: "A228" },
      { name: "act-2 analyzer_down AN-1 length", value: 2, unit: "h", ref: "A096" },
    ],
  });
  const refs = (): VNode[] => walk(FooterInputs({ footer: footer() })).filter((n) => n.props.ids !== undefined);
  const readings = (ref: VNode | undefined): number[] => walk(ref?.props.children).filter((n) => typeof n.type === "function" && (n.type as { name?: string }).name === "ClockReading").map((n) => n.props.t as number);
  const words = (ref: VNode | undefined): string => {
    const found: string[] = [];
    const visit = (x: unknown): void => {
      if (Array.isArray(x)) x.forEach(visit);
      else if (typeof x === "string" || typeof x === "number") found.push(String(x));
      else if (isVNode(x)) visit(x.props.children);
    };
    visit(ref?.props.children);
    return found.join("");
  };

  it("Given an instant of the run in minutes Then it is a clock reading with its ledger id (4860 min is 291,600 s, day 3 at 09:00; 5100 min is day 3 at 13:00), as the list above it prints it", () => {
    const [, feed, down] = refs();
    expect(feed?.props.ids).toEqual(["A228"]);
    expect(readings(feed)).toEqual([291600]);
    expect(readings(down)).toEqual([306000]);
    expect(words(feed)).toBe("");
  });

  it("Given a clock reading Then it is the day and the time of day as labels, the form of every panel", () => {
    const parts = (ClockReading({ t: 306000 }) as unknown as VNode).props.parts as Record<string, VNode>;
    expect([parts.day?.props.children, parts.time?.props.children]).toEqual([3, "13:00"]);
  });

  it("Given an input that is not an instant of an action Then it keeps its value and unit as the scenario gives them: a threshold in minutes, the length of a window in hours", () => {
    const [threshold, , , length] = refs();
    expect(readings(threshold)).toEqual([]);
    expect(words(threshold)).toBe("30 min");
    expect(readings(length)).toEqual([]);
    expect(words(length)).toBe("2 h");
  });

  it("Given the names of the engine Then only the at, from and effective of an act input is an instant", () => {
    expect(instantOf({ name: "act-3 change_lot AN-2 effective", value: 1, unit: "min" })).toBe(60);
    expect(instantOf({ name: "act-2 analyzer_down AN-1 length", value: 2, unit: "h" })).toBeNull();
    expect(instantOf({ name: "sla_hold_threshold_min", value: 30, unit: "min" })).toBeNull();
    expect(instantOf({ name: "act-1 add_feed U03 at", value: "x", unit: "min" })).toBeNull();
  });
});
