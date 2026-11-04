import { describe, expect, it } from "vitest";
import markFile from "../../docs/media/mark.svg?raw";
import { en } from "../i18n/en.ts";
import { ko } from "../i18n/ko.ts";
import { MARK_INLINE, Mark } from "./Mark.tsx";

// B1: the mark of the header. The drawing is the file docs/media/mark.svg (the one source); the lab inlines it without the palette the file carries for the places that cannot restyle it, marks it
// aria-hidden (it is decoration: the name beside it stays text), and does not translate the name. tests/test_brand.py holds the rest (the explainer, the icons, the READMEs, the stylesheet's colours).
// The expected values are typed here by hand.

interface VNode {
  type: unknown;
  props: Record<string, unknown>;
}

describe("the mark of the lab", () => {
  it("Given the file Then it is one small svg with a palette of its own for the light and the dark scheme", () => {
    expect(markFile.length).toBeLessThan(2048);
    expect(markFile.trimStart().startsWith("<svg ")).toBe(true);
    expect(markFile).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(markFile).toContain("prefers-color-scheme:dark");
    expect(markFile).not.toMatch(/<(image|text|script|foreignObject)\b|href=|url\(/);
  });

  it("Given the inline copy Then it is the file less its palette: the same shapes, no style element, three kinds of ink", () => {
    expect(MARK_INLINE).not.toContain("<style");
    expect(MARK_INLINE.startsWith("<svg ") && MARK_INLINE.endsWith("</svg>")).toBe(true);
    expect(markFile.replace(/<style>[\s\S]*?<\/style>\s*/, "").trim()).toBe(MARK_INLINE);
    expect(MARK_INLINE.match(/class="lm-k"/g)).toHaveLength(3); // the three records: a circle, a square and a triangle
    expect(MARK_INLINE.match(/class="lm-l"/g)).toHaveLength(1); // the liquid
    expect(MARK_INLINE.match(/class="lm-i"/g)).toHaveLength(1); // the tube and the line that branches
    expect(MARK_INLINE).toMatch(/<circle [^>]*class="lm-k"/);
    expect(MARK_INLINE).toMatch(/<rect [^>]*class="lm-k"/);
  });

  it("Given the component Then it is a decoration: aria-hidden, no text of its own, the inline svg as its content", () => {
    const node = Mark() as unknown as VNode;
    expect(node.type).toBe("span");
    expect(node.props["aria-hidden"]).toBe("true");
    expect(node.props.class).toBe("mark");
    expect(node.props.children).toBeUndefined();
    expect(node.props.dangerouslySetInnerHTML).toEqual({ __html: MARK_INLINE });
  });
});

describe("the name beside the mark", () => {
  it("Given the product name Then it is Sample Lineage Lab in English and in Korean (it is not translated)", () => {
    expect(en["app.title"]).toBe("Sample Lineage Lab");
    expect(ko["app.title"]).toBe("Sample Lineage Lab");
  });
});
