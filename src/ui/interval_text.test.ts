import { describe, expect, it } from "vitest";
import { INTERVAL_TEXT } from "../../engine/src/evaluate/aggregate.ts";
import { en } from "../i18n/en.ts";
import { ko } from "../i18n/ko.ts";
import { Interval } from "./Results.tsx";

// The line of the Results report on what the range is (P8a): a text of the dictionary in each language. The engine's own text is English data and stays as it is; the page no longer prints it on the Korean page.
// Function components that use no hook can be called and their output walked.

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

describe("the line on what the range is", () => {
  it("Given the report Then the line is a dictionary text and not the engine's string as a label of its own", () => {
    const nodes = walk(Interval());
    expect(nodes.map((n) => n.props.k).filter(Boolean)).toEqual(["results.interval.label", "results.interval.text"]);
    expect(nodes.some((n) => n.props.engine === true)).toBe(false);
  });

  it("Given the English text Then it says what the engine's text says, with the two percentiles in words (the rule of the dictionary: no digit) and without the word rank, which no text of the lab uses", () => {
    expect(INTERVAL_TEXT).toBe("spread across seeds: the 5th to the 95th percentile, nearest rank; not a confidence interval");
    expect(en["results.interval.text"]).toBe("spread across seeds: the fifth to the ninety-fifth percentile, each an observed value; not a confidence interval");
  });

  it("Given the Korean text Then it says the same three things: a spread across seeds, the two percentiles, each an observed value, and that it is not a confidence interval; and it has no Latin letters", () => {
    const text = ko["results.interval.text"];
    expect(text).toMatch(/시드/);
    expect(text).toMatch(/다섯.*아흔다섯/);
    expect(text).toMatch(/관측된 값/);
    expect(text).toMatch(/신뢰구간이 아님/);
    expect(text).not.toMatch(/[A-Za-z]/);
  });
});
