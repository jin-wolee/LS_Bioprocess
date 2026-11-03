import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The room the chrome of the plant leaves (docs/design/plant_ui.md section 3.2, "As built in P8a"): the cards, the panels and the bars are items of one grid over the scene, so none covers another. What may
// be placed by `position: absolute` is only what is over the scene on purpose: the canvas and its labels, the layer of the grid, the loading line and the ticks of the scrubber. A rule that puts a card, a panel
// or a bar by position again (as the panel was, over the right end of the clock and the bar at 1280 by 720) fails here; the check `plant_a11y` measures the boxes in a browser.

const css = ["plant.css", "plant_act.css"].map((name) => readFileSync(new URL(`./${name}`, import.meta.url), "utf8")).join("\n");
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: (m[1] as string).replace(/\/\*[\s\S]*?\*\//g, "").trim(), body: m[2] as string }));
const positioned = (kind: "absolute" | "fixed" | "sticky"): string[] => rules.filter((r) => new RegExp(`position:\\s*${kind}\\b`).test(r.body)).map((r) => r.selector);

describe("the style sheets of the plant", () => {
  it("Given the rules that place something by position Then they are the scene's own layers and nothing of the chrome", () => {
    expect(positioned("absolute").sort()).toEqual([".plant-boot", ".plant-canvas", ".plant-gl", ".plant-huds", ".plant-label", ".plant-labels", ".plant-tick", ".plant-ticks"]);
    expect(positioned("fixed")).toEqual([]);
    expect(positioned("sticky")).toEqual([]);
  });

  it("Given the grid Then the cards, the side panel and the stack are its items, and the stack sits in the last row under the panel's column", () => {
    const body = (selector: string): string => rules.find((r) => r.selector === selector)?.body ?? "";
    expect(body(".plant-huds")).toMatch(/display:\s*grid/);
    expect(body(".plant-bottom")).toMatch(/grid-row:\s*3/);
    expect(body(".plant-side")).toMatch(/grid-column:\s*3/);
    expect(rules.some((r) => r.selector === ".plant-huds:has(.plant-side:not(:empty)) .plant-bottom" && /grid-column:\s*1 \/ 3/.test(r.body))).toBe(true);
  });
});
