import { Color, DirectionalLight, Fog, HemisphereLight, Scene as ThreeScene, WebGLRenderer } from "three";
import type { Material, Mesh, MeshStandardMaterial } from "three";
import type { Layout } from "../layout.ts";
import type { Tier } from "../scene_types.ts";
import { PALETTE } from "./floor.ts";

// The stage of the plant (docs/design/plant_ui.md sections 2 and 9): the canvas and its renderer, the sky, the fog and the two lights, and the freeing of all of it. Nothing here knows what is drawn on it.

const SKY = new Color(PALETTE.sky);

export interface Stage {
  canvas: HTMLCanvasElement;
  renderer: WebGLRenderer;
  /** The name the graphics driver gives its renderer, for the status line. */
  name: string;
  scene: ThreeScene;
  hemi: HemisphereLight;
  sun: DirectionalLight;
}

/** The canvas in `host` with a renderer for the tier (shadows and the pixel ratio), the sky and fog, and the lights lit from the south. */
export const buildStage = (host: HTMLElement, layout: Layout, tier: Tier): Stage => {
  const canvas = document.createElement("canvas");
  canvas.className = "plant-canvas";
  host.appendChild(canvas);
  const renderer = new WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(tier === "high" ? Math.min(window.devicePixelRatio || 1, 2) : 1);
  renderer.shadowMap.enabled = tier === "high";

  const gl = renderer.getContext();
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  const name = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));

  const scene = new ThreeScene();
  scene.background = SKY;
  scene.fog = new Fog(PALETTE.sky, 60, 160);
  const hemi = new HemisphereLight(0xffffff, 0xc9d4dc, 1.6);
  scene.add(hemi);
  const sun = new DirectionalLight(0xffffff, 1.6);
  const span = Math.max(layout.width, layout.depth);
  sun.position.set(layout.width * 0.75, span * 0.8, layout.depth * 1.15); // from the south, over the shoulder of a walker who enters there: the faces toward the camera are lit
  sun.target.position.set(layout.width / 2, 0, layout.depth / 2);
  sun.castShadow = tier === "high";
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -span * 0.65, right: span * 0.65, top: span * 0.65, bottom: -span * 0.65, near: 1, far: span * 3 });
  sun.shadow.camera.updateProjectionMatrix();
  scene.add(sun, sun.target);
  return { canvas, renderer, name, scene, hemi, sun };
};

/** Frees what the scene holds: every geometry and material in it (and the maps of the standard ones), the renderer and its context, and the canvas. */
export const disposeStage = ({ canvas, renderer, scene }: Stage): void => {
  scene.traverse((o) => {
    const mesh = o as Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const material = mesh.material as Material | Material[] | undefined;
    for (const m of Array.isArray(material) ? material : material ? [material] : []) {
      (m as MeshStandardMaterial).map?.dispose();
      m.dispose();
    }
  });
  renderer.dispose();
  renderer.forceContextLoss();
  canvas.remove();
};
