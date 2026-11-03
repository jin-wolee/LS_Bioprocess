import { Group, Matrix4, Vector3 } from "three";
import type { BufferGeometry, InstancedMesh, Material } from "three";
import { describe, expect, it, vi } from "vitest";
import { casePlan } from "../fixture_case.ts";
import { itemsAt } from "../items_at.ts";
import { layoutOf } from "../layout.ts";
import { sceneAt } from "../scene_at.ts";
import type { Labels } from "./labels.ts";
import { buildItemsMotion } from "./motion_items.ts";
import { buildVesselMotion } from "./motion_vessels.ts";
import { buildStore } from "./store.ts";
import { buildThings } from "./shapes.ts";

// P7c (docs/design/plant_ui.md section 3.2, "As built in P7c"): what the scene of a case draws, read from the instanced meshes it fills (no renderer: three.js builds the meshes and their matrices in Node).
// Shape carries the meaning and colour only repeats it, so the tests count instances by shape: a held item has one band and a quarantined one two, a stamp that reads detected is a diamond and one that reads not
// detected a disc, a medium lot is a box and a seed lot a cylinder, a link is a gantry of an upright at each end and a bar across, and a beacon is a ball of its own, not a recoloured lamp. Expected values are hand
// arithmetic on the case of fixture_case.ts (lens c_context): the layout is worked out in layout_store.test.ts and pick_items.test.ts, the instants in items_at.test.ts.

const plan = casePlan();
const layout = layoutOf(plan.layout);
const C = "c_context";

const stubLabels = () => {
  const set = vi.fn();
  const fixed = vi.fn();
  return { set, fixed, labels: { fixed, tubes: () => ({ set, setWords: vi.fn() }) } as unknown as Labels };
};

const motion = (t: number, lens = C) => {
  const { labels, set } = stubLabels();
  const group = new Group();
  const disposables: (BufferGeometry | Material)[] = [];
  const m = buildItemsMotion(layout, plan, group, labels, disposables);
  m.update(itemsAt(plan, t, lens));
  const [across, stubs, bandBoxes, bandRings, bodies, plates, diamonds, discs] = group.children as InstancedMesh[];
  return { across: across as InstancedMesh, stubs: stubs as InstancedMesh, bandBoxes: bandBoxes as InstancedMesh, bandRings: bandRings as InstancedMesh, bodies: bodies as InstancedMesh, plates: plates as InstancedMesh, diamonds: diamonds as InstancedMesh, discs: discs as InstancedMesh, set };
};
const scaleOf = (mesh: InstancedMesh, i: number): Vector3 => {
  const m = new Matrix4();
  mesh.getMatrixAt(i, m);
  return new Vector3().setFromMatrixScale(m);
};

describe("the links", () => {
  it("Given 3000 s Then three gantries stand, each of two uprights and a bar across: ML-1 on U01 and U02 and SL-A on U02", () => {
    const m = motion(3000);
    expect([m.across.count, m.stubs.count]).toEqual([3, 6]);
  });

  it("Given 4200 s Then one gantry stands (TL-1 on U01) and the others are gone", () => {
    const m = motion(4200);
    expect([m.across.count, m.stubs.count]).toEqual([1, 2]);
  });

  it("Given a link that has stood for part of its stretch Then it is thinner: 0.09 m at the instant of the use, 0.09 x (1 - 1000/1200) = 0.015 m at 1000 s of 1200, and the bar is as long as the way from the crate to the vessel", () => {
    const { across } = motion(3000);
    near(scaleOf(across, 0).y, 0.09); // ML-1 on U01, progress 0
    near(scaleOf(across, 2).y, 0.015); // SL-A on U02, progress 1000/1200
    // the crate of ML-1 stands at (10, 16.8) and U01 at (13, 11.2): a bar of sqrt(3 squared + 5.6 squared)
    near(scaleOf(across, 0).x, Math.hypot(3, 5.6));
  });

  it("Given no use standing Then nothing is drawn", () => {
    const m = motion(5400);
    expect([m.across.count, m.stubs.count]).toEqual([0, 0]);
  });
});

// a matrix holds single-precision floats
const near = (a: number, b: number): void => expect(a).toBeCloseTo(b, 5);

describe("the tape: one band for a held thing and two for a quarantined one", () => {
  it("Given 7500 s Then U02 and TL-1 have a ring each and ML-1 a band on its box: one band for each, as all three are held", () => {
    const m = motion(7500);
    expect([m.bandRings.count, m.bandBoxes.count]).toEqual([2, 1]);
  });

  it("Given 10000 s Then U02 and ML-1 are quarantined and TL-1 is held: three rings (two on U02, one on TL-1) and two bands on the box of ML-1", () => {
    const m = motion(10000);
    expect([m.bandRings.count, m.bandBoxes.count]).toEqual([3, 2]);
  });

  it("Given 25000 s Then ML-1 and TL-1 are released and U02 stays quarantined: two rings, no band on a box", () => {
    const m = motion(25000);
    expect([m.bandRings.count, m.bandBoxes.count]).toEqual([2, 0]);
  });

  it("Given the other hall as the lens Then its own holds are drawn: a_manual holds U02 from 9000 s and nothing else, one ring", () => {
    const m = motion(10000, "a_manual");
    expect([m.bandRings.count, m.bandBoxes.count]).toEqual([1, 0]);
  });

  it("Given a held thing and a quarantined one Then they differ in the number of bands (shape), not only in colour", () => {
    expect(motion(7500).bandRings.count).not.toBe(motion(10000).bandRings.count);
    expect(motion(7500).bandBoxes.count).not.toBe(motion(10000).bandBoxes.count);
  });
});

describe("the confirmation shelf: a tube with a square plate from its draw, a stamp for each reported test", () => {
  it("Given 8999 s Then the shelf is bare; given 9000 s Then two tubes stand, each with a plate, and no stamp", () => {
    const before = motion(8999);
    expect([before.bodies.count, before.plates.count]).toEqual([0, 0]);
    const at = motion(9000);
    expect([at.bodies.count, at.plates.count, at.diamonds.count, at.discs.count]).toEqual([2, 2, 0, 0]);
  });

  it("Given 20000 s Then the stamp that reads detected is a diamond and the one that reads not detected a disc", () => {
    const m = motion(20000);
    expect([m.diamonds.count, m.discs.count]).toEqual([1, 1]);
  });

  it("Given 30000 s Then a second diamond is added: the sterility test of U01-CONF, detected", () => {
    const m = motion(30000);
    expect([m.bodies.count, m.diamonds.count, m.discs.count]).toEqual([3, 2, 1]);
  });

  it("Given the labels of the tubes Then slot 0 is lit over its slot with the sample's id and its stamps, and an empty slot is told to hide", () => {
    const m = motion(20000);
    expect(m.set).toHaveBeenCalledWith(0, expect.objectContaining({ x: expect.closeTo(13.85, 9), z: expect.closeTo(16.8, 9) }), { id: "U01-CONF", stamps: [{ test: "bioburden", outcome: "detected", k: 0 }] });
    expect(m.set).toHaveBeenCalledWith(1, expect.anything(), { id: "U02-CONF", stamps: [{ test: "bioburden", outcome: "not_detected", k: 0 }] });
    expect(m.set).toHaveBeenCalledWith(3, null);
  });
});

describe("the store that does not move", () => {
  const made = () => {
    const { labels, fixed } = stubLabels();
    return { store: buildStore(layout, plan, labels), fixed };
  };

  it("Given two medium lots and a seed lot Then the medium lots are boxes (two) and the seed lot a cylinder (one): the kind is a shape", () => {
    // children: the board and the two posts of the rack, the boxes, the cylinders, the table tops, the legs, the tanks, the board (four slots, one row) and the two posts of the shelf
    expect((made().store.group.children as InstancedMesh[]).map((x) => x.count)).toEqual([1, 2, 2, 1, 1, 4, 1, 1, 2]);
  });

  it("Given the objects Then the scene built three lots and one station", () => {
    expect(made().store.objects).toEqual({ lot: 3, equipment: 1 });
  });

  it("Given the ids Then each crate and station wears its own as a label: no label says what is contaminated", () => {
    const { fixed } = made();
    expect(fixed).toHaveBeenCalledTimes(1);
    expect((fixed.mock.calls[0]?.[0] as { text: string; kind: string }[]).map((x) => [x.text, x.kind])).toEqual([["ML-1", "crate"], ["ML-2", "crate"], ["SL-A", "crate"], ["TL-1", "station"]]);
  });
});

describe("the beacon: a ball of its own, not a lamp of another colour", () => {
  const build = () => {
    const group = new Group();
    const built = buildThings(layout);
    const update = buildVesselMotion(layout, plan, group, built.jackets, []);
    const meshes = group.children as InstancedMesh[];
    return { update, lamps: meshes[0] as InstancedMesh, signals: meshes[3] as InstancedMesh, deviations: meshes[7] as InstancedMesh, stopped: meshes[6] as InstancedMesh };
  };

  it("Given a quiet unit and the unit that signalled (U02 at 7000 s) Then both have a lamp, and the signalling one has a ball besides", () => {
    const quiet = build();
    quiet.update(sceneAt(plan, 6999));
    const lit = build();
    lit.update(sceneAt(plan, 7000));
    expect([quiet.lamps.count, quiet.signals.count]).toEqual([2, 0]);
    expect([lit.lamps.count, lit.signals.count]).toEqual([2, 1]);
  });

  it("Given the beacon's stretch over (1800 s) Then the ball is gone, the deviation tag stays and the stopped plate comes with the stop", () => {
    const later = build();
    later.update(sceneAt(plan, 12000));
    expect([later.signals.count, later.deviations.count, later.stopped.count]).toEqual([0, 1, 1]);
  });
});
