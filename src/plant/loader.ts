// The loader of the plant (docs/design/plant_ui.md sections 8 and 9): the capability check and the dynamic import, and nothing else. It stays in the first load, which is why it is small: the scene
// and `three` are a chunk of their own, fetched only when a reader enters the plant in a browser that can draw it. The size test holds this module's chunk to 4 KB gzip.

/** The one thing of a canvas the check needs. */
interface Probe {
  getContext(kind: "webgl2"): unknown;
}

/** Whether a canvas gives a WebGL version two context. The scratch context is released at once so that it does not count against the browser's limit of live contexts. */
export const canvasHasWebGL2 = (canvas: Probe): boolean => {
  try {
    const gl = canvas.getContext("webgl2") as { getExtension(name: string): { loseContext(): void } | null } | null;
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
    return gl !== null && gl !== undefined;
  } catch {
    return false;
  }
};

let known: boolean | undefined;

/** The check on a scratch canvas, made once per page load: Home and the plant ask, and the answer does not change while the page is open. */
export const webgl2 = (): boolean => {
  known ??= typeof document !== "undefined" && canvasHasWebGL2(document.createElement("canvas"));
  return known;
};

/** The plant chunk: the scene and `three`. Called only after `webgl2()` says yes. */
export const loadScene = () => import("./gl/plant_scene.ts");
