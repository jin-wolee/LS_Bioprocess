import { describe, expect, it, vi } from "vitest";
import { enNotes } from "../i18n/en_notes.ts";
import { koNotes } from "../i18n/ko_notes.ts";
import { Notes } from "./Notes.tsx";
import { RangeBar } from "./RangeBar.tsx";
import type { ReportRow } from "./results_view.ts";

vi.mock("preact/hooks", async (original) => ({ ...(await original<typeof import("preact/hooks")>()), useContext: () => "en" }));

type Node = { type: unknown; props: Record<string, unknown> };
const walk = (item: unknown): Node[] => {
  if (Array.isArray(item)) return item.flatMap(walk);
  if (typeof item !== "object" || item === null || !("type" in item) || !("props" in item)) return [];
  const node = item as Node;
  return [node, ...walk(node.props.children)];
};

const row: ReportRow = { metric: "availability", status: "reported", n_seeds: 20, n_defined: 20, median: 1, lo: 1, hi: 1, denominator: "requests", den: { min: 1, median: 1, max: 1 }, reason: null };

describe("R6 partial: Notes links", () => {
  it("offers the repository, design, decisions and research in both languages", () => {
    const nodes = walk(Notes({ ready: null }));
    const links = nodes.filter((node) => node.type === "a");
    const repo = "https://github.com/jin-wolee/LS_Bioprocess";
    expect(links.map((node) => node.props.href)).toEqual([repo, `${repo}/tree/main/docs/design`, `${repo}/tree/main/docs/adr`, `${repo}/tree/main/docs/research`]);
    for (const key of ["notes.more.heading", "notes.more.repo", "notes.more.design", "notes.more.adr", "notes.more.research"] as const) {
      expect(enNotes).toHaveProperty(key);
      expect(koNotes).toHaveProperty(key);
      expect(nodes.some((node) => node.props.k === key)).toBe(true);
    }
  });
});

describe("R6 partial: range axis", () => {
  it("labels zero and the shared maximum next to the graphic", () => {
    const nodes = walk(RangeBar({ row, max: 1, name: "availability" }));
    const labels = nodes.filter((node) => node.props["data-axis-end"] !== undefined);
    expect(labels.map((node) => node.props.children)).toEqual(["0", "1"]);
    const seconds = walk(RangeBar({ row, max: 2000, name: "turnaround" })).filter((node) => node.props["data-axis-end"] !== undefined);
    expect(seconds.map((node) => node.props.children)).toEqual(["0", "2000"]);
  });
  it("keeps a maximum-only range rectangle and median entirely in the viewBox", () => {
    const nodes = walk(RangeBar({ row, max: 1, name: "availability" }));
    const rect = nodes.find((node) => node.type === "rect");
    const median = nodes.find((node) => node.props.class === "bar-median");
    expect(Number(rect?.props.x) + Number(rect?.props.width)).toBeLessThanOrEqual(100);
    expect(median?.props.x1).toBe(99);
  });
});
