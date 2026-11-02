import { describe, expect, it } from "vitest";
import type { LineageEdge, LineageNode } from "../protocol.ts";
import { BOX_W, BOX_X, COL_W, formatValue, layoutRecord } from "./lineage_layout.ts";

// The geometry of one lineage column (docs/design/lab_ui.md section 8): nodes stacked in the order of the tables, the keys that join them as edges in lanes at the left, an edge whose key is
// null as a stub on its node (a line that ends in a gap, the key named). Pure functions, so the picture can be checked without a browser.

const node = (table: string, key: string, fields: [string, string | number | null][] = [["k", key]]): LineageNode => ({ id: `${table}:${key}`, table, key, fields: fields.map(([name, value]) => ({ name, value })) });
const edge = (from: string, to: string | null, relation: string, basis?: LineageEdge["basis"]): LineageEdge => ({ from, to, relation, ...(basis && { basis }) });

// result nodes come first in the input on purpose: the layout orders by table, not by the order it is given
const NODES = [node("result", "R2"), node("result", "R1"), node("run", "RUN1"), node("analysis_request", "Q1"), node("sample", "S1", [["sample_id", "S1"], ["sampled_at", null], ["x", 1.23456789]]), node("process_context", "view")];
const EDGES = [
  edge("sample:S1", "analysis_request:Q1", "request_id"),
  edge("analysis_request:Q1", "run:RUN1", "request_id"),
  edge("run:RUN1", "result:R1", "measured_in"),
  edge("run:RUN1", "result:R2", "measured_in"),
  edge("run:RUN1", null, "instrument_state_id"),
  edge("sample:S1", "process_context:view", "process_context", "measured_at"),
];

describe("formatValue", () => {
  it("Given a number Then integers are kept and other numbers are rounded to six significant digits; a string is kept; null is null", () => {
    expect(formatValue(899841)).toBe("899841");
    expect(formatValue(11.336824493393996)).toBe("11.3368");
    expect(formatValue(0.5)).toBe("0.5");
    expect(formatValue("closed")).toBe("closed");
    expect(formatValue(null)).toBeNull();
  });
});

describe("layoutRecord: a result with no value (audit A1, F3; simulation_spec section 2.3)", () => {
  it("Given a value field marked no_value and a plain null field Then the line of the first carries no_value and the second does not, so the page draws them with different words", () => {
    const n: LineageNode = { id: "result:R2", table: "result", key: "R2", fields: [{ name: "value", value: null, no_value: true }, { name: "available_at", value: null }] };
    expect(layoutRecord({ nodes: [n], edges: [] }).boxes[0]?.lines).toEqual([{ name: "value", value: null, no_value: true }, { name: "available_at", value: null }]);
  });
});

describe("layoutRecord", () => {
  const laid = layoutRecord({ nodes: NODES, edges: EDGES });

  it("Given nodes in any order Then the boxes are stacked in the order of the tables (sample, context, request, run, results) and never overlap", () => {
    expect(laid.boxes.map((b) => b.id)).toEqual(["sample:S1", "process_context:view", "analysis_request:Q1", "run:RUN1", "result:R2", "result:R1"]); // ties keep the given order
    for (let i = 1; i < laid.boxes.length; i++) {
      const [a, b] = [laid.boxes[i - 1], laid.boxes[i]] as [(typeof laid.boxes)[number], (typeof laid.boxes)[number]];
      expect(b.y).toBeGreaterThanOrEqual(a.y + a.h);
    }
    expect(laid.height).toBeGreaterThanOrEqual((laid.boxes.at(-1)?.y ?? 0) + (laid.boxes.at(-1)?.h ?? 0));
  });

  it("Then every box lies inside the column and leaves the gutter at the left for the lanes", () => {
    for (const b of laid.boxes) {
      expect(b.x).toBe(BOX_X);
      expect(b.w).toBe(BOX_W);
      expect(b.x + b.w).toBeLessThanOrEqual(COL_W);
    }
    expect(laid.width).toBe(COL_W);
  });

  it("Then a field that is null is kept as null (the picture says 'not stored', it never guesses) and a number is formatted", () => {
    const sample = laid.boxes.find((b) => b.id === "sample:S1");
    expect(sample?.lines).toEqual([{ name: "sample_id", value: "S1" }, { name: "sampled_at", value: null }, { name: "x", value: "1.23457" }]);
  });

  it("Given an edge whose key is null Then it is a stub on its node, not a path, and it names the missing key", () => {
    const run = laid.boxes.find((b) => b.id === "run:RUN1");
    expect(run?.stubs).toEqual(["instrument_state_id"]);
    expect(laid.edges.every((e) => e.to !== null)).toBe(true);
    expect(laid.edges).toHaveLength(EDGES.length - 1);
  });

  it("Then a box that has a stub is taller by one line per stub than the same box without it", () => {
    const without = layoutRecord({ nodes: NODES, edges: EDGES.filter((e) => e.to !== null) });
    const a = laid.boxes.find((b) => b.id === "run:RUN1") as (typeof laid.boxes)[number];
    const b = without.boxes.find((x) => x.id === "run:RUN1") as (typeof laid.boxes)[number];
    expect(a.h).toBeGreaterThan(b.h);
  });

  it("Then each linked edge runs from the left edge of its source to the left edge of its target through a lane of the gutter; edges whose spans overlap use different lanes", () => {
    for (const e of laid.edges) {
      expect(e.lane).toBeGreaterThanOrEqual(0);
      expect(e.laneX).toBeLessThan(BOX_X);
      expect(e.laneX).toBeGreaterThan(0);
    }
    const spans = laid.edges.map((e) => ({ lane: e.lane, lo: Math.min(e.y1, e.y2), hi: Math.max(e.y1, e.y2) }));
    for (let i = 0; i < spans.length; i++) {
      for (let j = i + 1; j < spans.length; j++) {
        const [p, q] = [spans[i], spans[j]] as [(typeof spans)[number], (typeof spans)[number]];
        if (p.lo < q.hi && q.lo < p.hi) expect(p.lane, `edges ${i} and ${j} overlap`).not.toBe(q.lane);
      }
    }
  });

  it("Then the dashed edge is the process context, and the relation that arrives at a box is named above it with the join basis where there is one", () => {
    expect(laid.edges.filter((e) => e.dashed).map((e) => e.relation)).toEqual(["process_context"]);
    expect(laid.boxes.find((b) => b.id === "process_context:view")?.incoming).toBe("process_context (measured_at)");
    expect(laid.boxes.find((b) => b.id === "result:R1")?.incoming).toBe("measured_in");
    expect(laid.boxes.find((b) => b.id === "sample:S1")?.incoming).toBe("");
  });

  it("Given no nodes Then the layout is empty and still has a width", () => {
    expect(layoutRecord({ nodes: [], edges: [] })).toMatchObject({ boxes: [], edges: [], width: COL_W });
  });
});
