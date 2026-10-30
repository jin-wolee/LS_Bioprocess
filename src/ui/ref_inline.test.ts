import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Ref } from "./Ref.tsx";
import { piecesOf } from "./T.tsx";

// A <Ref> sits inside running text (the seed-minimum notice, the dialect sentence, the ids a sentence cites), so it must be an inline-level box: a block-level one (display: flex, block, grid)
// breaks the sentence into three lines, one before and one after it. The unit test cannot lay a page out, so it holds the two things that decide it: the sentence reaches the page as text, the
// element and text in one parent, and no rule of the stylesheet gives `.ref` a block-level display. The layout itself is held by the end-to-end check `results` (lab_ui.md section 12).

const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector = "", body = ""]) => ({ selectors: selector.split(",").map((s) => s.trim()), body }));
const INLINE_LEVEL = new Set(["inline", "inline-flex", "inline-block"]);

/** The rules whose subject (the last compound of a selector) is exactly `.ref`. */
const refRules = rules.filter((r) => r.selectors.some((s) => /(^|[\s>+~])\.ref$/.test(s)));

describe("a Ref in running text", () => {
  it("Given a sentence with a placeholder Then the pieces are the text before, the element and the text after, in that order", () => {
    const element = Ref({ ids: ["A103"], children: "20 seeds" });
    const pieces = piecesOf("below the minimum of {min}: the report", {}, { min: element });
    expect(pieces).toEqual(["below the minimum of ", element, ": the report"]);
  });

  it("Given the stylesheet Then a rule for .ref exists", () => {
    expect(refRules.length).toBeGreaterThan(0);
  });

  it("Given the stylesheet Then no rule gives .ref a display that breaks the line (flex, block, grid, table)", () => {
    const displays = refRules.flatMap((r) => [...r.body.matchAll(/display:\s*([a-z-]+)/g)].map((m) => ({ selectors: r.selectors.join(", "), display: m[1] })));
    expect(displays.filter((d) => !INLINE_LEVEL.has(d.display ?? ""))).toEqual([]);
  });
});
