import { BoxGeometry, CanvasTexture, Group, InstancedMesh, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, RepeatWrapping, SRGBColorSpace } from "three";
import type { Layout, Point } from "../layout.ts";
import { placed } from "./place.ts";

// The room of the plant, drawn in code (docs/design/plant_ui.md section 2: procedural, no asset file): a tiled floor whose texture is made on a canvas, three walls with a band of daylight windows
// (the south side is open, so the camera behind the walker sees in), and the aisles painted along the walk graph. A bright, clean lab; the look stays the author's to adjust.

export const PALETTE = {
  sky: 0xdbe8f2,
  floor: "#eef2f5",
  grid: "#d4dce3",
  wall: 0xf6f8fa,
  window: 0xcde5f7,
  aisle: 0xc7dcec,
  plinth: 0xe1e8ee,
  bench: 0xfafbfc,
  steel: 0xd3dae0,
  glass: 0xbfdcf0,
  accent: 0x2f6fb0,
  lampIdle: 0x9aa5ae,
  lampRunning: 0x2e9e5b,
  lampEnded: 0xb08c3a,
} as const;

/** One tile of the floor: two metres square, a soft grid line on its edges. */
const tileTexture = (): CanvasTexture => {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext("2d") as CanvasRenderingContext2D;
  g.fillStyle = PALETTE.floor;
  g.fillRect(0, 0, size, size);
  g.strokeStyle = PALETTE.grid;
  g.lineWidth = 3;
  g.strokeRect(0, 0, size, size);
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(size / 2, 0);
  g.lineTo(size / 2, size);
  g.moveTo(0, size / 2);
  g.lineTo(size, size / 2);
  g.stroke();
  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
};

/** The floor, the walls and the painted aisles; and the material of the windows, which the light of the day changes (motion.ts). */
export const buildRoom = (layout: Layout): { room: Group; glass: MeshBasicMaterial } => {
  const room = new Group();
  const { width, depth } = layout;

  const tiles = tileTexture();
  tiles.repeat.set(width / 2, depth / 2);
  const floor = new Mesh(new PlaneGeometry(width, depth), new MeshStandardMaterial({ map: tiles, roughness: 0.85, metalness: 0 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(width / 2, 0, depth / 2);
  floor.receiveShadow = true;
  room.add(floor);

  const wallMaterial = new MeshStandardMaterial({ color: PALETTE.wall, roughness: 0.95 });
  const walls: [number, number, number, number, number][] = [
    [width, 3.2, 0.3, width / 2, -0.15], // north
    [0.3, 3.2, depth, -0.15, depth / 2], // west
    [0.3, 3.2, depth, width + 0.15, depth / 2], // east
  ];
  for (const [w, h, d, x, z] of walls) {
    const wall = new Mesh(new BoxGeometry(w, h, d), wallMaterial);
    wall.position.set(x, h / 2, z);
    wall.receiveShadow = true;
    room.add(wall);
  }
  // a band of windows along the north wall, and one on each side wall: daylight, drawn flat on the wall
  const glass = new MeshBasicMaterial({ color: PALETTE.window });
  const north = new Mesh(new PlaneGeometry(width * 0.86, 1.3), glass);
  north.position.set(width / 2, 1.9, 0.01);
  room.add(north);
  for (const [x, rotation] of [[0.01, Math.PI / 2], [width - 0.01, -Math.PI / 2]] as const) {
    const side = new Mesh(new PlaneGeometry(depth * 0.86, 1.3), glass);
    side.position.set(x, 1.9, depth / 2);
    side.rotation.y = rotation;
    room.add(side);
  }

  // the aisles, painted along the walk graph
  const edges = layout.walk.edges;
  const paint = new InstancedMesh(new BoxGeometry(1, 0.02, 1), new MeshStandardMaterial({ color: PALETTE.aisle, roughness: 0.9 }), edges.length);
  for (const [k, [i, j]] of edges.entries()) {
    const a = layout.walk.nodes[i] as Point;
    const b = layout.walk.nodes[j] as Point;
    const horizontal = a.z === b.z;
    const [sx, sz] = horizontal ? [Math.abs(a.x - b.x) + 0.14, 0.14] : [0.14, Math.abs(a.z - b.z) + 0.14];
    paint.setMatrixAt(k, placed((a.x + b.x) / 2, 0.012, (a.z + b.z) / 2, sx, 1, sz));
  }
  paint.instanceMatrix.needsUpdate = true;
  paint.receiveShadow = true;
  room.add(paint);
  return { room, glass };
};
