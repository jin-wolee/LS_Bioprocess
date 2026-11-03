import { describe, expect, it } from "vitest";
import { ClockReading } from "../plant/ActionRefs.tsx";
import { LineageTruth } from "./LineageView.tsx";

// The truth column of the lineage view, on the Lineage screen, in the challenge's reveal and in the record panel of the plant (P8a): the instant the sample was drawn is a clock reading, as the panels of the
// plant print every instant, and not the seconds of the run. A function component that uses no hook can be called and its output walked.

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

const view = { sample: { sample_id: "U12-D08-1", unit_id: "U12", picked_by: "reader" as const }, truth: { unit_id: "U12", sampled_at: 721579, context: { feed_epoch: 3, batch_phase: "after_shift" } } };

describe("the truth column", () => {
  const drawn = walk(LineageTruth({ view })).find((n) => n.props["data-truth"] === "sampled_at");

  it("Given the instant drawn (721,579 s of the run, day 8 at 08:26) Then it is printed as a clock reading and not as the seconds", () => {
    const readings = walk(drawn?.props.children).filter((n) => n.type === ClockReading);
    expect(readings.map((n) => n.props.t)).toEqual([721579]);
    expect(walk(drawn?.props.children).some((n) => n.props.children === 721579)).toBe(false);
  });

  it("Given the clock reading Then 721,579 s is day 8 at 08:26", () => {
    const parts = (ClockReading({ t: 721579 }) as unknown as VNode).props.parts as Record<string, VNode>;
    expect([parts.day?.props.children, parts.time?.props.children]).toEqual([8, "08:26"]);
  });
});
