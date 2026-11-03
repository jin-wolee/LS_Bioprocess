import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Reduced motion (docs/design/plant_ui.md section 9, P8a): nothing in the style sheets of the plant animates or eases unless the reader has not asked for reduced motion. Every `animation` and `transition`
// declaration lies inside `@media (prefers-reduced-motion: no-preference)`; the browser-level half (the ring is not drawn, a follow cuts) is the check `plant_a11y`.

const FILES = ["plant.css", "plant_act.css", "plant_tour.css"].map((name) => ({ name, text: readFileSync(new URL(`./${name}`, import.meta.url), "utf8") }));

/** The at-rules (their preludes, outermost first) that enclose the character at `at`: the text before each `{` that is still open there. */
const enclosing = (text: string, at: number): string[] => {
  const open: string[] = [];
  let start = 0;
  for (let i = 0; i < at; i++) {
    const c = text[i];
    if (c === "{") {
      open.push(text.slice(start, i).trim());
      start = i + 1;
    } else if (c === "}") {
      open.pop();
      start = i + 1;
    } else if (c === ";") start = i + 1;
  }
  return open;
};

describe("the style sheets of the plant", () => {
  it("Given every animation and transition Then it is inside the media query of no preference for reduced motion", () => {
    let found = 0;
    for (const { name, text } of FILES) {
      for (const m of text.matchAll(/(^|[\s;{])(animation|transition)(-[a-z-]+)?\s*:/g)) {
        found++;
        const at = (m.index ?? 0) + m[1]!.length;
        expect(enclosing(text, at).some((p) => /^@media \(prefers-reduced-motion: no-preference\)/.test(p)), `${name}: ${text.slice(at, at + 60)}`).toBe(true);
      }
    }
    expect(found).toBeGreaterThan(0); // the turning ring of the recompute line
  });

  it("Given the turning ring Then it is not drawn at all when the reader asks for reduced motion", () => {
    const css = FILES.map((f) => f.text).join("\n");
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{ \.plant-ring \{ display: none; \} \}/);
  });

  it("Given the helper Then it finds the media query that holds a declaration, and none for a bare one", () => {
    const text = "a { b: c; } @media (x) { .r { animation: s 1s; } } .q { transition: none; }";
    expect(enclosing(text, text.indexOf("animation"))).toEqual(["@media (x)", ".r"]);
    expect(enclosing(text, text.indexOf("transition"))).toEqual([".q"]);
  });
});
