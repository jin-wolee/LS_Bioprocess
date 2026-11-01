import { describe, expect, it } from "vitest";
import { canvasHasWebGL2 } from "./loader.ts";

// docs/design/plant_ui.md section 9: the loader checks for a WebGL version two context before the dynamic import, so a reader without it never downloads the plant chunk and gets the text
// alternative. The check is a function of the canvas it is given; the page passes a scratch canvas, the tests a fake one. The end-to-end check `plant_fallback` runs the real thing with WebGL off.

type Canvas = Parameters<typeof canvasHasWebGL2>[0];
const canvasWith = (context: unknown): Canvas & { asked: string[] } => {
  const asked: string[] = [];
  return { asked, getContext: (kind: string) => (asked.push(kind), context) } as Canvas & { asked: string[] };
};

describe("canvasHasWebGL2", () => {
  it("Given a canvas that gives a webgl2 context Then the answer is yes, only the second version was asked for, and the scratch context is released at once", () => {
    const released: string[] = [];
    const gl = { getExtension: (name: string) => (name === "WEBGL_lose_context" ? { loseContext: () => released.push("lost") } : null) };
    const canvas = canvasWith(gl);
    expect(canvasHasWebGL2(canvas)).toBe(true);
    expect(canvas.asked).toEqual(["webgl2"]);
    expect(released).toEqual(["lost"]);
  });

  it("Given a context with no lose-context extension Then the answer is still yes", () => {
    expect(canvasHasWebGL2(canvasWith({ getExtension: () => null }))).toBe(true);
  });

  it("Given a canvas that gives no context (WebGL off, or only version one) Then the answer is no", () => {
    expect(canvasHasWebGL2(canvasWith(null))).toBe(false);
  });

  it("Given a canvas that throws Then the answer is no and nothing escapes", () => {
    const canvas = { getContext: () => { throw new Error("blocked"); } } as unknown as Canvas;
    expect(canvasHasWebGL2(canvas)).toBe(false);
  });
});
