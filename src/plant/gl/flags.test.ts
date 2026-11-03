import { ExtrudeGeometry, Group, Matrix4, Quaternion, Vector3 } from "three";
import type { BufferGeometry, InstancedMesh, Material } from "three";
import { describe, expect, it, vi } from "vitest";
import type { ScenePlan } from "../../protocol.ts";
import { cellCentre, flagMatrix, flagsGeometry } from "../flags_board.ts";
import { handPlan } from "../fixture.ts";
import { layoutOf } from "../layout.ts";
import { buildFlagsBoard } from "./flags.ts";
import type { Labels } from "./labels.ts";

// P8a (ADR-0011: shape and text carry meaning, colour only repeats it): the flags board of the scene. A flag that is on is a raised block, a flag that is off is a hollow outline (it was a flat filled tile, told
// from an on cell by its colour and its height alone), and a hall whose record has not arrived is a small flat mark. The meshes are read as the scene built them (no renderer: three.js builds them in Node).
// The expected counts are hand arithmetic on the matrix below.

const FLAGS = ["system_issued_id", "two_clocks", "available_at", "audit_trail"];

const planOf = (records: { architecture: string; flags_on: string[] }[]): ScenePlan => {
  const plan = handPlan();
  plan.layout = { ...plan.layout, architectures: ["a_manual", "b_lims_lite", "c_context"] };
  plan.records = records.map((r) => ({ ...r, cards: [] }));
  return plan;
};
// the three halls with their flags: a has none, b has two of the four, c has all four: 6 cells on, 6 off
const ALL = planOf([
  { architecture: "a_manual", flags_on: [] },
  { architecture: "b_lims_lite", flags_on: ["system_issued_id", "audit_trail"] },
  { architecture: "c_context", flags_on: FLAGS },
]);

const board = (plan: ScenePlan) => {
  const group = new Group();
  const labels = { fixed: vi.fn() } as unknown as Labels;
  const disposables: (BufferGeometry | Material)[] = [];
  const b = buildFlagsBoard(layoutOf(plan.layout), plan, FLAGS, group, labels, disposables);
  const [plate, blocks, frames] = group.children as InstancedMesh[];
  return { b, plate: plate as InstancedMesh, blocks: blocks as InstancedMesh, frames: frames as InstancedMesh, labels, disposables };
};
const matrixOf = (mesh: InstancedMesh, i: number): { at: Vector3; scale: Vector3 } => {
  const m = new Matrix4();
  mesh.getMatrixAt(i, m);
  const at = new Vector3();
  const scale = new Vector3();
  m.decompose(at, new Quaternion(), scale);
  return { at, scale };
};

describe("the flags board in the scene", () => {
  it("Given every hall has arrived Then the six cells that are on are raised blocks and the six that are off are outlines, so the two states differ in shape", () => {
    const { blocks, frames } = board(ALL);
    expect([blocks.count, frames.count]).toEqual([6, 6]);
    expect(blocks.geometry.type).toBe("BoxGeometry");
    expect(frames.geometry).toBeInstanceOf(ExtrudeGeometry);
  });

  it("Given the outline Then it is a rectangle with a hole in it, not a filled tile", () => {
    const { frames } = board(ALL);
    const shapes = (frames.geometry as ExtrudeGeometry).parameters.shapes;
    const shape = Array.isArray(shapes) ? shapes[0] : shapes;
    expect(shape?.holes.length).toBe(1);
  });

  it("Given a cell Then an outline stands on the centre of an off cell and a block on the centre of an on cell (system_issued_id: off in a, on in b)", () => {
    const { blocks, frames } = board(ALL);
    const g = flagsGeometry(layoutOf(ALL.layout).width, FLAGS.length, 3);
    const off = cellCentre(g, 0, 0);
    const on = cellCentre(g, 0, 1);
    const frameAt = Array.from({ length: frames.count }, (_, i) => matrixOf(frames, i).at);
    const blockAt = Array.from({ length: blocks.count }, (_, i) => matrixOf(blocks, i).at);
    expect(frameAt.some((p) => Math.abs(p.x - off.x) < 1e-3 && Math.abs(p.y - off.y) < 1e-3)).toBe(true);
    expect(blockAt.some((p) => Math.abs(p.x - on.x) < 1e-3 && Math.abs(p.y - on.y) < 1e-3)).toBe(true);
    expect(blockAt.some((p) => Math.abs(p.x - off.x) < 1e-3 && Math.abs(p.y - off.y) < 1e-3)).toBe(false);
  });

  it("Given only the first hall has arrived Then its four cells are outlines (it has no flag on) and the eight cells of the others are small marks, which are blocks of a smaller size than a block that is on", () => {
    const { blocks, frames } = board(planOf([{ architecture: "a_manual", flags_on: [] }]));
    expect([blocks.count, frames.count]).toEqual([8, 4]);
    const mark = matrixOf(blocks, 0).scale;
    const full = flagMatrix(ALL, FLAGS).cells.flat().filter((c) => c === true).length;
    expect(full).toBe(6);
    expect(mark.x).toBeLessThan(0.5 * 0.8);
    expect(mark.z).toBeLessThan(0.07);
  });

  it("Given the next hall arrives Then the meshes are written again for the new matrix", () => {
    const first = planOf([{ architecture: "a_manual", flags_on: [] }]);
    const { b, blocks, frames } = board(first);
    b.setHalls(ALL.records);
    expect([blocks.count, frames.count]).toEqual([6, 6]);
  });

  it("Given every cell Then each is drawn once: the blocks and the outlines together are the cells of the matrix", () => {
    const { blocks, frames } = board(ALL);
    expect(blocks.count + frames.count).toBe(FLAGS.length * 3);
  });
});
