import type { ScenePlan } from "../protocol.ts";

// The layout of the plant (docs/design/plant_ui.md section 3.1): a pure function of the shape of the run, in metres. No three.js, no DOM, no clock: Vitest runs it without WebGL. Its input is the
// `layout` of the scene plan (the bays with their sizes and profiles, the analyzers with their groups, the architectures of the record halls) and nothing else.
//
// The floor, north (z = 0) to south: rows of record halls (one wall of shelves per architecture), rows of bays (at most three bays to a row, each bay a plinth with its vessels in rows of at most
// six), and the bench with the analyzers in a row and one intake lane per group. Between every two bands, and around them, runs an aisle; the walk graph is the middle line of each aisle. x runs
// east, z south, so the entrance at the south edge looks north across the bench and the bays to the halls. Profiles change the look and never the position, so a profile is not read here.

/** The metres of the layout. Every position below is hand arithmetic on these. */
export const METRES = {
  /** Between the centres of two vessels, along a row and between rows. */
  pitch: 2,
  /** The plinth margin around the vessels of a bay. */
  bayPad: 1,
  /** Vessels in a row of a bay, and bays in a row of the floor. */
  vesselsPerRow: 6,
  baysPerRow: 3,
  /** The aisle between two bands and around them; the wall margin outside the outer aisle. */
  aisle: 3,
  edge: 2,
  /** The bench: depth, the length one analyzer takes, the margin at each end. */
  benchDepth: 1.2,
  analyzerPitch: 2.4,
  benchPad: 1.2,
  /** A record hall: the shelf wall's length and depth, and the distance between the centres of two. */
  hallWidth: 5,
  hallDepth: 1.2,
  hallPitch: 6,
  /** The least width of the working part of the floor, so that three halls stand in one row. */
  minInner: 18,
  /** What stands on the floor, for the camera that must not go inside it. */
  heights: { bay: 2.2, bench: 1.2, hall: 2.4 },
} as const;

export interface Point {
  x: number;
  z: number;
}

/** A footprint on the floor: its corner of least x and least z, and its size. */
export interface Rect extends Point {
  w: number;
  d: number;
  /** The height of what stands on it. */
  h: number;
}

export interface Vessel extends Point {
  /** The index into the plan's `units`. */
  unit: number;
  bay: number;
  slot: number;
  /** The point of the walk graph that serves it: the aisle in front of the bay (south of it). */
  access: Point;
}

export interface Bay {
  index: number;
  profile: string;
  footprint: Rect;
}

export interface Analyzer extends Point {
  /** The index into the plan's `analyzers`. */
  index: number;
  profile: string;
  group: string;
  /** Where a sample is handed in, in front of the analyzer (south of the bench). */
  intake: Point;
}

export interface Lane extends Point {
  group: string;
  /** The analyzers that share it, by index. */
  analyzers: number[];
}

export interface Hall {
  index: number;
  architecture: string;
  footprint: Rect;
  access: Point;
}

export interface Graph {
  nodes: Point[];
  edges: [number, number][];
}

export interface Layout {
  width: number;
  depth: number;
  bays: Bay[];
  vessels: Vessel[];
  bench: Rect;
  analyzers: Analyzer[];
  lanes: Lane[];
  halls: Hall[];
  /** Everything a walker must not enter. */
  obstacles: Rect[];
  walk: Graph;
  /** Where the avatar enters: on the aisle in front of the bench, in the middle of the floor. */
  entrance: Point;
}

type Spec = ScenePlan["layout"];

/** The columns and rows of vessels in a bay of `size` (rows of at most six). */
const gridOf = (size: number): { cols: number; rows: number } => ({ cols: Math.min(size, METRES.vesselsPerRow), rows: Math.ceil(size / METRES.vesselsPerRow) });
const bayWidth = (size: number): number => gridOf(size).cols * METRES.pitch + 2 * METRES.bayPad;
const bayDepth = (size: number): number => gridOf(size).rows * METRES.pitch + 2 * METRES.bayPad;
const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);
const max = (xs: readonly number[]): number => xs.reduce((a, b) => Math.max(a, b), 0);

export const layoutOf = (spec: Spec): Layout => {
  const m = METRES;
  const sizes = spec.bays.map((b) => b.size);
  const nBayCols = Math.min(sizes.length, m.baysPerRow);
  const nBayRows = Math.ceil(sizes.length / m.baysPerRow);
  const cellW = max(sizes.map(bayWidth));
  const rowDepth = Array.from({ length: nBayRows }, (_, r) => max(sizes.slice(r * m.baysPerRow, (r + 1) * m.baysPerRow).map(bayDepth)));
  const baysW = nBayCols === 0 ? 0 : nBayCols * cellW + (nBayCols - 1) * m.aisle;
  const benchW = spec.analyzers.length * m.analyzerPitch + 2 * m.benchPad;
  const inner = Math.max(baysW, benchW, m.minInner);
  const width = inner + 2 * (m.edge + m.aisle);
  const innerLeft = m.edge + m.aisle;
  const hallsPerRow = Math.max(1, Math.floor((inner + (m.hallPitch - m.hallWidth)) / m.hallPitch));
  const hallRows = Math.ceil(spec.architectures.length / hallsPerRow);

  // the bands from the north: hall rows, bay rows, the bench; each band top sits one aisle below the bottom of the one before
  const bands: { top: number; depth: number }[] = [];
  let z = m.edge + m.aisle;
  for (const depth of [...Array<number>(hallRows).fill(m.hallDepth), ...rowDepth, m.benchDepth]) {
    bands.push({ top: z, depth });
    z += depth + m.aisle;
  }
  const depth = z + m.edge; // z is one aisle below the bench; then the wall margin
  const bayBand = (r: number) => bands[hallRows + r] as { top: number; depth: number };
  const benchBand = bands[bands.length - 1] as { top: number; depth: number };
  const lineAbove = (band: number): number => (bands[band] as { top: number }).top - m.aisle / 2;
  const lineBelow = (band: number): number => (bands[band] as { top: number; depth: number }).top + (bands[band] as { depth: number }).depth + m.aisle / 2;

  // bays and vessels
  const baysX0 = innerLeft + (inner - baysW) / 2;
  const bays: Bay[] = [];
  const vessels: Vessel[] = [];
  let unit = 0;
  for (const [i, size] of sizes.entries()) {
    const col = i % m.baysPerRow;
    const row = Math.floor(i / m.baysPerRow);
    const footprint: Rect = { x: baysX0 + col * (cellW + m.aisle), z: bayBand(row).top, w: bayWidth(size), d: bayDepth(size), h: m.heights.bay };
    bays.push({ index: i, profile: (spec.bays[i] as { profile: string }).profile, footprint });
    const south = lineBelow(hallRows + row);
    for (let slot = 0; slot < size; slot++, unit++) {
      const x = footprint.x + m.bayPad + ((slot % m.vesselsPerRow) + 0.5) * m.pitch;
      vessels.push({ unit, bay: i, slot, x, z: footprint.z + m.bayPad + (Math.floor(slot / m.vesselsPerRow) + 0.5) * m.pitch, access: { x, z: south } });
    }
  }

  // the bench, the analyzers along it, and the lanes of the groups
  const benchX0 = innerLeft + (inner - benchW) / 2;
  const bench: Rect = { x: benchX0, z: benchBand.top, w: benchW, d: m.benchDepth, h: m.heights.bench };
  const front = lineBelow(bands.length - 1);
  const analyzers: Analyzer[] = spec.analyzers.map((a, index) => {
    const x = benchX0 + m.benchPad + (index + 0.5) * m.analyzerPitch;
    return { index, profile: a.profile, group: a.group, x, z: benchBand.top + m.benchDepth / 2, intake: { x, z: front } };
  });
  const lanes: Lane[] = [...new Set(analyzers.map((a) => a.group))].map((group) => {
    const own = analyzers.filter((a) => a.group === group);
    return { group, x: sum(own.map((a) => a.x)) / own.length, z: front, analyzers: own.map((a) => a.index) };
  });

  // the record halls, centred in rows
  const halls: Hall[] = [];
  for (let r = 0; r < hallRows; r++) {
    const names = spec.architectures.slice(r * hallsPerRow, (r + 1) * hallsPerRow);
    const x0 = innerLeft + (inner - ((names.length - 1) * m.hallPitch + m.hallWidth)) / 2;
    for (const [k, architecture] of names.entries()) {
      const footprint: Rect = { x: x0 + k * m.hallPitch, z: (bands[r] as { top: number }).top, w: m.hallWidth, d: m.hallDepth, h: m.heights.hall };
      halls.push({ index: r * hallsPerRow + k, architecture, footprint, access: { x: footprint.x + m.hallWidth / 2, z: lineBelow(r) } });
    }
  }

  // the walk graph: a node wherever a vertical aisle crosses a horizontal one. The outer aisles run the full depth; the aisles between bay columns only along the bays.
  const outer = [m.edge + m.aisle / 2, width - m.edge - m.aisle / 2];
  const gaps = Array.from({ length: Math.max(0, nBayCols - 1) }, (_, c) => baysX0 + (c + 1) * cellW + c * m.aisle + m.aisle / 2);
  const lines = Array.from({ length: bands.length + 1 }, (_, k) => (k === 0 ? lineAbove(0) : lineBelow(k - 1)));
  const baysFrom = hallRows; // the line above the first bay row, as an index into `lines`
  const baysTo = hallRows + nBayRows;
  const nodes: Point[] = [];
  const edges: [number, number][] = [];
  const at = new Map<string, number>();
  const node = (x: number, zz: number): number => {
    const key = `${x}/${zz}`;
    let k = at.get(key);
    if (k === undefined) {
      k = nodes.push({ x, z: zz }) - 1;
      at.set(key, k);
    }
    return k;
  };
  for (const x of [outer[0] as number, ...gaps, outer[1] as number]) {
    const isOuter = x === outer[0] || x === outer[1];
    for (let k = isOuter ? 0 : baysFrom; k < (isOuter ? lines.length : baysTo + 1) - 1; k++) edges.push([node(x, lines[k] as number), node(x, lines[k + 1] as number)]);
  }
  const verticals = [outer[0] as number, ...gaps, outer[1] as number];
  for (const [k, zz] of lines.entries()) {
    // a horizontal aisle joins the outer aisles, and, along the bays, the aisles between the columns
    const xs = k >= baysFrom && k <= baysTo ? verticals : outer;
    for (let i = 0; i + 1 < xs.length; i++) edges.push([node(xs[i] as number, zz), node(xs[i + 1] as number, zz)]);
  }
  const entrance: Point = { x: width / 2, z: front };

  return {
    width,
    depth,
    bays,
    vessels,
    bench,
    analyzers,
    lanes,
    halls,
    obstacles: [...bays.map((b) => b.footprint), bench, ...halls.map((h) => h.footprint)],
    walk: { nodes, edges },
    entrance,
  };
};
