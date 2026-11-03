// The sizes of the things the scene draws on the floor, in metres (docs/design/plant_ui.md section 3.2). Pure data, with no three.js: the scene (gl/shapes.ts and the motion files) builds the meshes from
// them and the pick (pick.ts) makes the boxes a click can hit from the same numbers, so what is drawn and what is picked cannot disagree. View constants, not domain numbers.

export const PLINTH = 0.2;
export const BENCH_TOP = 1.2;

/** The vessel of each bioreactor profile: a bench vessel, a small one of a mini-parallel block, a pilot tank. Unknown profiles are drawn as the bench vessel. */
export const VESSELS: Record<string, { radius: number; height: number }> = {
  bench_manual: { radius: 0.42, height: 1 },
  micro_mini_parallel: { radius: 0.26, height: 0.7 },
  pilot: { radius: 0.62, height: 1.7 },
};
/** The analyzer of each profile: width, height and depth of its body on the bench. */
export const ANALYZERS: Record<string, [number, number, number]> = {
  allinone_atline: [1.5, 0.85, 0.75],
  hplc: [1.1, 1.15, 0.85],
  split_cellcounter_metabolite: [1.8, 0.7, 0.6],
};

export const vesselShape = (profile: string): { radius: number; height: number } => VESSELS[profile] ?? (VESSELS.bench_manual as { radius: number; height: number });
export const analyzerShape = (profile: string): [number, number, number] => ANALYZERS[profile] ?? (ANALYZERS.allinone_atline as [number, number, number]);

/** The sampling board of a bay (P6a, plant_ui.md section 3.2): a plate on two posts at the west end of the north edge of the plinth. View constants, the look is the author's to adjust. */
export const BOARD = { w: 1.6, h: 0.9, thick: 0.06, bottom: 1.5, post: 0.06, inset: 1.1, back: 0.12 } as const;

/** Where the board of a bay stands on the floor: `inset` from the west end of the bay's footprint and `back` inside its north edge. */
export const boardPoint = (footprint: { x: number; z: number }): { x: number; z: number } => ({ x: footprint.x + BOARD.inset, z: footprint.z + BOARD.back });

/** A tube in the hand is held this far in front of the operator, toward the vessel (north), not inside the figure. */
export const HELD = 0.32;

/** The things of the break-out store (P7c, plant_ui.md section 3.2, "As built in P7c"): a crate is a box (a medium lot) or a cylinder (a seed lot) on the rack, a station a table with a tank, and a confirming tube stands in a slot of the shelf. View constants; the places are layout_store.ts's. */
export const CRATE = { w: 0.7, h: 0.45 } as const;
export const STATION = { top: 0.7, tankRadius: 0.4, tankHeight: 0.8 } as const;
export const SHELF_TUBE = { radius: 0.1, height: 0.42, cue: 0.17 } as const;
