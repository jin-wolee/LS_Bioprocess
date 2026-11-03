import { describe, expect, it, vi } from "vitest";
import type { LineageColumn } from "../protocol.ts";
import { RecordSvg } from "./RecordSvg.tsx";

// P9 (docs/design/plant_ui.md section 12, item 20; lab_ui.md section 6): every figure of the drawing of a record is an input, an output or a label, wherever the drawing is shown. On the Lineage screen and in
// the challenge it sits inside a result block; in the plant's record panel it sits in no result block, so the drawing marks its own figures. The tree is walked as elements (no DOM): the language is fixed by
// replacing the context hook, and a function component that uses no other hook (the answers of the drawing) is called to see what it draws.
vi.mock("preact/hooks", async (importOriginal) => ({ ...(await importOriginal<typeof import("preact/hooks")>()), useContext: () => "en" }));

interface VNode {
  type: unknown;
  props: Record<string, unknown>;
}
interface Figure {
  tag: string;
  text: string;
  marked: boolean;
}
const isVNode = (x: unknown): x is VNode => typeof x === "object" && x !== null && "type" in x && "props" in x;
const MARKS = ["data-ref", "data-result", "data-label"];

/** Every text of the tree that holds a digit, with the tag of the element it sits in and whether an element above it (or it) carries a mark of invariant 3. */
const figuresOf = (node: unknown, marked = false, tag = "", found: Figure[] = []): Figure[] => {
  if (Array.isArray(node)) node.forEach((n) => figuresOf(n, marked, tag, found));
  else if (typeof node === "string" || typeof node === "number") {
    if (/\d/.test(String(node))) found.push({ tag, text: String(node), marked });
  } else if (isVNode(node)) {
    if (typeof node.type === "function") figuresOf((node.type as (props: Record<string, unknown>) => unknown)(node.props), marked, tag, found);
    else figuresOf(node.props.children, marked || MARKS.some((m) => m in node.props), String(node.type), found);
  }
  return found;
};
const unmarked = (figures: Figure[]): string[] => figures.filter((f) => !f.marked).map((f) => `${f.tag}: ${f.text}`);

// A record as the plant's record panel receives it for a wrong answer: the sample, a run and a result with a value, a key that ends in a gap, and the three answers (one wrong, so the truth is written).
const column: LineageColumn = {
  architecture: "b_lims",
  flags_on: ["system_issued_id"],
  labelling: "typed",
  nodes: [
    { id: "sample:U03-D10-2", table: "sample", key: "U03-D10-2", fields: [{ name: "sample_id", value: "U03-D10-2" }, { name: "unit_id", value: "U03" }, { name: "sampled_at", value: 899841 }] },
    { id: "run:RUN7", table: "run", key: "RUN7", fields: [{ name: "started_at", value: 900000 }, { name: "instrument_state_id", value: null }] },
    { id: "result:R7", table: "result", key: "R7", fields: [{ name: "value", value: 7.123456789 }, { name: "measured_at", value: 900887 }] },
  ],
  edges: [
    { from: "sample:U03-D10-2", to: "run:RUN7", relation: "request_id" },
    { from: "run:RUN7", to: "result:R7", relation: "measured_in" },
    { from: "run:RUN7", to: null, relation: "instrument_state_id" },
  ],
  answers: [
    { question: "unit", answer: "U03", verdict: "correct" },
    { question: "sampled_at", answer: 900887, verdict: "wrong" },
    { question: "process_context", answer: { feed_epoch: 10, batch_phase: "fed_batch" }, verdict: "correct" },
  ],
  realised_errors: [],
};
const truth = { unit_id: "U03", sampled_at: 899841, context: { feed_epoch: 10, batch_phase: "fed_batch" } };

describe("the walk of the tree", () => {
  it("Given an element with a digit and no mark above it Then the walk reports it, and a mark above it, or on it, takes it out", () => {
    const text = (extra: Record<string, unknown>, inner: unknown = "day 3") => ({ type: "text", props: { ...extra, children: inner } });
    expect(unmarked(figuresOf(text({})))).toEqual(["text: day 3"]);
    expect(unmarked(figuresOf(text({ "data-label": true })))).toEqual([]);
    expect(unmarked(figuresOf({ type: "g", props: { "data-result": "", children: [text({}), text({}, "no digit")] } }))).toEqual([]);
  });
});

describe("the drawing of a record", () => {
  it("Given a record without answers Then it has figures (keys, times, a value) and every one is marked", () => {
    const figures = figuresOf(RecordSvg({ column: { ...column, answers: [] }, sample: "U03-D10-2" }));
    expect(figures.length).toBeGreaterThanOrEqual(8);
    expect(unmarked(figures)).toEqual([]);
  });

  it("Given the answers and the truth Then the answered values and the truth written beside a wrong answer are marked too", () => {
    const figures = figuresOf(RecordSvg({ column, sample: "U03-D10-2", truth }));
    expect(figures.some((f) => f.text.includes("899841") && f.tag === "text")).toBe(true); // the truth of the wrong answer is in the drawing
    expect(unmarked(figures)).toEqual([]);
  });
});
