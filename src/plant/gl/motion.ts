import { Color, Fog, Group } from "three";
import type { BufferGeometry, DirectionalLight, HemisphereLight, Material, MeshBasicMaterial, Scene as ThreeScene } from "three";
import type { HallView } from "../halls_at.ts";
import type { Layout } from "../layout.ts";
import type { SceneState } from "../scene_at.ts";
import type { ScenePlan } from "../../protocol.ts";
import { PALETTE } from "./floor.ts";
import type { Labels } from "./labels.ts";
import { buildAnalyzerMotion } from "./motion_analyzers.ts";
import { buildHallMotion } from "./motion_halls.ts";
import { buildStaffMotion } from "./motion_staff.ts";
import { buildTubeMotion } from "./motion_tubes.ts";
import { buildVesselMotion } from "./motion_vessels.ts";
import type { Built } from "./shapes.ts";

// Everything on the floor that follows the clock (docs/design/plant_ui.md section 4.2), drawn from one call of `sceneAt` for each new clock reading: the reactors, the analyzers, the tubes, the
// staff and the floor light. Each part owns instanced meshes with a fixed capacity and rewrites the instances it shows; none of them reads the wall clock, so a paused scene at a fixed instant is
// drawn the same every time.

export interface Lights {
  scene: ThreeScene;
  hemi: HemisphereLight;
  sun: DirectionalLight;
  /** The glass of the windows along the walls. */
  glass: MeshBasicMaterial;
}

export interface Motion {
  group: Group;
  update(state: SceneState): void;
  /** The cards on the shelves (`hallsAt`), with the hall the lens reads; the other halls are dimmed. */
  halls(views: readonly HallView[], lens: string): void;
}

// the light at its brightest inside the staffed window, and at its dimmest outside it (docs/design/plant_ui.md section 4.2)
const HEMI = { lit: 1.6, dim: 0.7 };
const SUN = { lit: 1.6, dim: 0.25 };
const SKY = { lit: new Color(PALETTE.sky), dim: new Color(0x56677a) };
const GLASS = { lit: new Color(PALETTE.window), dim: new Color(0x2b3a4b) };
const mix = (dim: number, lit: number, daylight: number): number => dim + (lit - dim) * daylight;

export const buildMotion = (layout: Layout, plan: ScenePlan, built: Built, lights: Lights, labels: Labels, disposables: (BufferGeometry | Material)[]): Motion => {
  const group = new Group();
  const vessels = buildVesselMotion(layout, plan, group, built.jackets, disposables);
  const analyzers = buildAnalyzerMotion(layout, group, disposables);
  const tubes = buildTubeMotion(plan.samples.filter((s) => !s.skipped).length, group, disposables);
  const staff = buildStaffMotion(plan.staff.length, group, disposables);
  // a hall holds at most one card for each planned sample
  const cards = buildHallMotion(layout, plan.samples.length * layout.halls.length, group, disposables);
  const sky = new Color();
  return {
    group,
    halls: cards.draw,
    update(state) {
      vessels(state);
      analyzers(state);
      tubes(state);
      labels.follow(staff(state));
      const d = state.daylight;
      lights.hemi.intensity = mix(HEMI.dim, HEMI.lit, d);
      lights.sun.intensity = mix(SUN.dim, SUN.lit, d);
      sky.copy(SKY.dim).lerp(SKY.lit, d);
      if (lights.scene.background instanceof Color) lights.scene.background.copy(sky);
      if (lights.scene.fog instanceof Fog) lights.scene.fog.color.copy(sky);
      lights.glass.color.copy(GLASS.dim).lerp(GLASS.lit, d);
      cards.light(d);
    },
  };
};
