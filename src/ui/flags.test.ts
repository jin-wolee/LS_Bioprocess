import { describe, expect, it } from "vitest";
import { FLAGS, READY } from "./fixture.ts";
import { FlagLegend, FlagMatrix, FlagTable } from "./Flags.tsx";
import { defaultForm } from "./form.ts";
import { Architectures } from "./SetupChoices.tsx";
import type { ReadyInfo } from "./state.ts";

// docs/design/lab_ui.md section 11: every place that lists the flags reads `ready.flags`, so a further flag appears everywhere without a page change (ADR-0017 and ADR-0020 added `material_lot_links` and
// `equipment_links` that way). These tests give the page a ready payload with a synthetic flag the dictionary has never heard of and look at every list that exists now: the flag matrix, the "C with one flag off"
// picker, the legend of each Results block and the flag table of Notes. The end-to-end check `flags` does the same in the built page.

const EXTRA = "synthetic_extra_flag";
const NINE: ReadyInfo = {
  ...READY,
  flags: [...FLAGS, EXTRA],
  presets: [
    ...READY.presets.map((p) => ({ ...p, flags: { ...p.flags, [EXTRA]: p.id === "c_context" } })),
    { id: `c_context_minus_${EXTRA}`, role: "ablation", ablated_flag: EXTRA, flags: Object.fromEntries([...FLAGS, EXTRA].map((f) => [f, f !== EXTRA])), labelling: "handwritten", capture_path: "manual_transcription" },
  ],
};

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
const flagsIn = (tree: unknown): string[] => walk(tree).flatMap((n) => (typeof n.props["data-flag"] === "string" ? [n.props["data-flag"]] : []));
const listsIn = (tree: unknown): VNode[] => walk(tree).filter((n) => "data-flag-list" in n.props);

describe("the lists of flags are read from ready.flags", () => {
  it("Given nine flags Then the matrix of Setup has a row for each, in the order of ready, and nothing else", () => {
    expect(flagsIn(FlagMatrix({ ready: NINE }))).toEqual(NINE.flags);
  });

  it("Given nine flags Then the legend of a Results block lists each, whatever the architecture", () => {
    for (const architecture of ["a_manual", "c_context", `c_context_minus_${EXTRA}`]) expect(flagsIn(FlagLegend({ ready: NINE, architecture })), architecture).toEqual(NINE.flags);
  });

  it("Given nine flags Then the flag table of Notes has an entry for each, and a flag without dictionary entries is still listed", () => {
    expect(flagsIn(FlagTable({ ready: NINE }))).toEqual(NINE.flags);
  });

  it("Given nine flags Then the picker of C with one flag off has an option for the ablation of each flag the engine offers, including the extra one", () => {
    const ready = NINE;
    const tree = Architectures({ ready, form: defaultForm(ready, "default"), update: () => undefined });
    const picker = walk(tree).find((n) => n.props["data-flag-list"] === "setup-ablation");
    // an option is an element of its own component here: it carries the flag as a prop and writes it as data-flag when it is rendered (the end-to-end check reads that)
    const options = walk(picker).flatMap((n) => (typeof n.type === "function" && typeof n.props.flag === "string" ? [n.props.flag] : []));
    expect(options).toEqual(["system_issued_id", "audit_trail", EXTRA]);
  });

  it("Given the eight flags of today Then each list has the eight and no more (the page counts nothing)", () => {
    expect(flagsIn(FlagMatrix({ ready: READY }))).toEqual(FLAGS);
    expect(flagsIn(FlagTable({ ready: READY }))).toEqual(FLAGS);
  });

  it("Given each list Then it is marked data-flag-list, which the end-to-end check reads", () => {
    expect(listsIn(FlagMatrix({ ready: NINE })).map((n) => n.props["data-flag-list"])).toEqual(["setup-matrix"]);
    expect(listsIn(FlagLegend({ ready: NINE, architecture: "c_context" })).map((n) => n.props["data-flag-list"])).toEqual(["results-legend"]);
    expect(listsIn(FlagTable({ ready: NINE })).map((n) => n.props["data-flag-list"])).toEqual(["notes-table"]);
  });

  it("Given the extra flag Then its state in the legend is the state the preset has (C on, A off)", () => {
    const state = (architecture: string): unknown =>
      walk(FlagLegend({ ready: NINE, architecture }))
        .filter((n) => typeof n.type === "function" && "on" in n.props)
        .map((n) => n.props.on)
        .at(-1);
    expect(state("c_context")).toBe(true);
    expect(state("a_manual")).toBe(false);
  });
});
