import { describe, expect, it, vi } from "vitest";
import type { ExperimentReport } from "../../engine/src/generated/experiment_report.schema";
import { READY } from "./fixture.ts";
import { Figure } from "./Figure.tsx";
import { Report } from "./Results.tsx";
import type { ReportRow } from "./results_view.ts";
import type { State } from "./state.ts";

// A report with fewer seeds than the minimum of A103 (`meets_min_seeds` false) says so once, above the architectures, in the result block (lab_ui.md section 17, item 11); no figure repeats it
// beside its spread. A figure that read any context at all, such as a flag for "few seeds", would see `true` here: the hook is replaced so that every context value is true.
vi.mock("preact/hooks", async (importOriginal) => ({ ...(await importOriginal<typeof import("preact/hooks")>()), useContext: () => true }));

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
const count = (nodes: VNode[], attribute: string, value: string): number => nodes.filter((n) => n.props[attribute] === value).length;

const row: ReportRow = { metric: "holding_time.median_s", status: "reported", n_seeds: 2, n_defined: 2, median: 0.5, lo: 0.25, hi: 0.75, denominator: null, den: null, reason: null };
const block = (id: string) => ({ id, role: "preset", ablated_flag: null, n_seeds: 2, not_modelled: [], not_evaluable: [], rows: [row] });
const stateWith = (meets: boolean): State =>
  ({
    check: { state: "identical" },
    results: {
      id: 2,
      footer: { scenario: "default", seeds: [1000, 1007], engine_version: "9.9.9", architectures: ["a_manual", "c_context"], check: "identical" },
      report: { meets_min_seeds: meets, min_seeds: 20, interval: "5th to 95th percentile", architectures: [block("a_manual"), block("c_context")] } as unknown as ExperimentReport,
    },
  }) as unknown as State;

describe("a report below the seed minimum", () => {
  it("Given a reported figure Then it carries no notice of its own beside the spread", () => {
    const nodes = walk(Figure({ name: "holding time", row, max: 1, label: "a_manual, holding_time.median_s" }));
    expect(count(nodes, "data-warn", "few-seeds")).toBe(0);
    expect(nodes.filter((n) => String(n.props.class ?? "").includes("chip-few"))).toEqual([]);
  });

  it("Given two architectures and fewer seeds than the minimum Then the notice is in the result block once", () => {
    expect(count(walk(Report({ state: stateWith(false), ready: READY })), "data-note", "min-seeds")).toBe(1);
  });

  it("Given a report that meets the minimum Then there is no notice", () => {
    expect(count(walk(Report({ state: stateWith(true), ready: READY })), "data-note", "min-seeds")).toBe(0);
  });
});
