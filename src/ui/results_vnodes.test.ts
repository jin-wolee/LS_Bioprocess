import { describe, expect, it } from "vitest";
import type { ExperimentReport } from "../../engine/src/generated/experiment_report.schema";
import { en } from "../i18n/en.ts";
import { ko } from "../i18n/ko.ts";
import { READY } from "./fixture.ts";
import { Architecture, Detection } from "./Results.tsx";
import { groupRows } from "./results_view.ts";
import type { ReportRow } from "./results_view.ts";

// The Results screen as elements (no DOM): which figures a detection block shows and in what order, and when the label-error sentence appears (lab_ui.md sections 3 and 10; spec section 8,
// rule 3: recall beside precision and the false-alarm rate). Function components that use no hook can be called, and their output walked; a child component stays an element with its props.

interface VNode {
  type: unknown;
  props: Record<string, unknown>;
}
type Block = ExperimentReport["architectures"][number];

const isVNode = (x: unknown): x is VNode => typeof x === "object" && x !== null && "type" in x && "props" in x;
const walk = (node: unknown, found: VNode[] = []): VNode[] => {
  if (Array.isArray(node)) node.forEach((n) => walk(n, found));
  else if (isVNode(node)) {
    found.push(node);
    walk(node.props.children, found);
    // props that hold elements of their own (the `name` of a figure) are not children: only the ones this test reads are followed
  }
  return found;
};
const named = (nodes: VNode[], name: string): VNode[] => nodes.filter((n) => typeof n.type === "function" && (n.type as { name?: string }).name === name);

const row = (metric: string): ReportRow => ({ metric, status: "reported", n_seeds: 20, n_defined: 20, median: 0.5, lo: 0.25, hi: 0.75, denominator: "all analysis requests", den: { min: 1, median: 2, max: 3 }, reason: null });
const DETECTION_ROWS = ["label_error", "feed_in_gap"].flatMap((t) => ["realised", "recall", "precision", "false_alarm"].map((f) => row(`detection.by_type.${t}.${f}`)));
const block = (id: string, role: "preset" | "ablation" = "preset", ablated: string | null = null): Block => ({ id, role, ablated_flag: ablated, n_seeds: 20, not_modelled: [], not_evaluable: [], rows: [row("holding_time.median_s"), row("exact_reconstruction"), ...DETECTION_ROWS] });
const BLOCKS = [block("a_manual"), block("b_lims_lite"), block("c_context"), block("c_context_minus_system_issued_id", "ablation", "system_issued_id"), block("c_context_minus_audit_trail", "ablation", "audit_trail")];

const tree = (id: string) => walk(Architecture({ block: BLOCKS.find((b) => b.id === id) as Block, blocks: BLOCKS, ready: READY }));
const noteShown = (id: string): boolean => tree(id).some((n) => n.props["data-note"] === "label-error");

describe("Detection: recall always beside precision and the false-alarm rate (spec section 8, rule 3)", () => {
  const group = groupRows(DETECTION_ROWS).detection[0];
  const figures = walk(Detection({ group: group as NonNullable<typeof group>, blocks: BLOCKS, name: "a_manual" }));

  it("Given an error type with all its rows Then its figures are recall, precision, the false-alarm rate and the realised opportunities, in the same block", () => {
    expect(named(figures, "Figure").map((f) => (f.props.row as ReportRow).metric)).toEqual([
      "detection.by_type.label_error.recall",
      "detection.by_type.label_error.precision",
      "detection.by_type.label_error.false_alarm",
      "detection.by_type.label_error.realised",
    ]);
  });

  it("Given the block Then it names its error type", () => {
    expect(figures.find((n) => n.props["data-error-type"])?.props["data-error-type"]).toBe("label_error");
  });
});

describe("Architecture: the label-error sentence follows the flags, not the id (lab_ui.md section 10)", () => {
  it.each([
    ["a_manual", false, "no flag on: without the idempotency check no conflict arises"],
    ["b_lims_lite", false, "system_issued_id is on"],
    ["c_context", false, "system_issued_id is on"],
    ["c_context_minus_system_issued_id", true, "system_issued_id off and ingest_idempotency on"],
    ["c_context_minus_audit_trail", false, "system_issued_id is on"],
  ])("Given %s Then the sentence is shown: %s (%s)", (id, shown) => {
    expect(noteShown(id)).toBe(shown);
  });

  it("Given the sentence Then it fills its placeholders with labels (the flag, the two rule ids and the error type), so no identifier is a bare text", () => {
    const note = tree("c_context_minus_system_issued_id").find((n) => n.props["data-note"] === "label-error");
    expect(note?.props.k).toBe("results.note.label_error");
    expect(Object.keys(note?.props.parts as object).sort()).toEqual(["double", "dup", "flag", "type"]);
  });

  it("Given an ablation that is not the one of the sentence Then its heading names the ablated flag and the sentence is absent from every other block", () => {
    expect(BLOCKS.filter((b) => noteShown(b.id)).map((b) => b.id)).toEqual(["c_context_minus_system_issued_id"]);
  });

  it("Given an architecture block Then it has a legend of the flags, the timing, the record and detection figures, and no rank, score or order of its own", () => {
    const nodes = tree("a_manual");
    expect(named(nodes, "FlagLegend")).toHaveLength(1);
    expect(named(nodes, "Detection").map((d) => (d.props.group as { type: string }).type)).toEqual(["label_error", "feed_in_gap"]);
    const keys = nodes.flatMap((n) => (typeof n.props.k === "string" ? [n.props.k] : []));
    expect(keys.filter((k) => /rank|score|order|best|winner/i.test(k))).toEqual([]);
  });
});

describe("the texts of the lab never order the architectures (spec section 8, anti-gaming rules 3 and 6; 00 section 2, item 8)", () => {
  const ENGLISH = /\b(rank(s|ed|ing)?|best|better|worse|worst|win(s|ner|ning)?|outperform(s|ed)?|superior|inferior|leaderboard)\b/i;
  const KOREAN = /순위|우수|최고|최상|열등|우열|승자/;

  it("Given every English text Then none ranks, scores up or declares a winner", () => {
    for (const [key, value] of Object.entries(en)) expect(value, key).not.toMatch(ENGLISH);
  });

  it("Given every Korean text Then none ranks or declares a winner", () => {
    for (const [key, value] of Object.entries(ko)) expect(value, key).not.toMatch(KOREAN);
  });

  it("Given the texts about a score Then they say there is none (a negation), never that there is one", () => {
    const about = Object.entries(en).filter(([, v]) => /\bscore\b/i.test(v));
    expect(about.map(([k]) => k).sort()).toEqual(["notes.scope.score", "results.lead", "reveal.score.none", "reveal.score.note"]); // the reveal of the challenge says there is no running score
    for (const [key, value] of about) expect(value, key).toMatch(/\b(no|not)\b/i);
  });
});
