import type { Graph, Layout, Point } from "./layout.ts";

// Walking on the plant's floor (docs/design/plant_ui.md section 3.4): click-to-walk follows the walk graph, the keyboard slides along what blocks it. Pure functions of the layout and of points
// in metres; no three.js, so Vitest runs them without WebGL. Walking speed is in wall time and independent of the playback speed (view constants, not domain numbers).

/** The radius of the walker: it keeps this far from every obstacle and from the walls. */
export const RADIUS = 0.35;
/** Metres per second of wall time. */
export const SPEED = 3.2;

const EPS = 1e-9;
const dist = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.z - b.z);

export const lengthOf = (path: readonly Point[]): number => path.slice(1).reduce((sum, p, i) => sum + dist(path[i] as Point, p), 0);

/** The point of the segment a-b nearest to p. */
const project = (p: Point, a: Point, b: Point): Point => {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len2 = dx * dx + dz * dz;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2));
  return { x: a.x + t * dx, z: a.z + t * dz };
};

/** The point of the walk graph nearest to p, and the edge it is on. */
export const nearestOnGraph = (g: Graph, p: Point): { point: Point; edge: number } => {
  let best = { point: g.nodes[0] as Point, edge: 0, d: Number.POSITIVE_INFINITY };
  for (const [k, [i, j]] of g.edges.entries()) {
    const q = project(p, g.nodes[i] as Point, g.nodes[j] as Point);
    const d = dist(p, q);
    if (d < best.d - EPS) best = { point: q, edge: k, d };
  }
  return { point: best.point, edge: best.edge };
};

/** Whether a walker centred at p would touch an obstacle or a wall. */
export const blockedAt = (l: Layout, p: Point): boolean =>
  p.x < RADIUS || p.z < RADIUS || p.x > l.width - RADIUS || p.z > l.depth - RADIUS ||
  l.obstacles.some((o) => p.x > o.x - RADIUS && p.x < o.x + o.w + RADIUS && p.z > o.z - RADIUS && p.z < o.z + o.d + RADIUS);

/** One step of the keyboard: all of it if it is free, else the part along x, else the part along z, else none (the walker slides along a wall or a plinth). */
export const stepTo = (l: Layout, from: Point, dx: number, dz: number): Point => {
  for (const q of [{ x: from.x + dx, z: from.z + dz }, { x: from.x + dx, z: from.z }, { x: from.x, z: from.z + dz }]) if (!blockedAt(l, q)) return q;
  return from;
};

/** Whether the straight way from a to b is free (sampled every quarter of a metre). */
const clear = (l: Layout, a: Point, b: Point): boolean => {
  const n = Math.max(1, Math.ceil(dist(a, b) / 0.25));
  for (let k = 1; k <= n; k++) if (blockedAt(l, { x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n })) return false;
  return true;
};

/** The nodes between two points of the graph by the shortest way (Dijkstra over a graph of a few dozen nodes), with the two points at the ends. */
const route = (g: Graph, s: { point: Point; edge: number }, e: { point: Point; edge: number }): Point[] => {
  const n = g.nodes.length;
  const best = Array<number>(n).fill(Number.POSITIVE_INFINITY);
  const prev = Array<number>(n).fill(-1); // -2: reached from the start point
  const done = Array<boolean>(n).fill(false);
  const around: [number, number][][] = Array.from({ length: n }, () => []);
  for (const [i, j] of g.edges) {
    const d = dist(g.nodes[i] as Point, g.nodes[j] as Point);
    (around[i] as [number, number][]).push([j, d]);
    (around[j] as [number, number][]).push([i, d]);
  }
  for (const k of g.edges[s.edge] as [number, number]) {
    best[k] = dist(s.point, g.nodes[k] as Point);
    prev[k] = -2;
  }
  for (;;) {
    let u = -1;
    for (let k = 0; k < n; k++) if (!done[k] && (u === -1 || (best[k] as number) < (best[u] as number))) u = k;
    if (u === -1 || best[u] === Number.POSITIVE_INFINITY) break;
    done[u] = true;
    for (const [v, d] of around[u] as [number, number][]) {
      if ((best[u] as number) + d < (best[v] as number) - EPS) {
        best[v] = (best[u] as number) + d;
        prev[v] = u;
      }
    }
  }
  const [c, d] = g.edges[e.edge] as [number, number];
  let node = (best[c] as number) + dist(g.nodes[c] as Point, e.point) <= (best[d] as number) + dist(g.nodes[d] as Point, e.point) ? c : d;
  const chain: Point[] = [];
  while (node >= 0) {
    chain.unshift(g.nodes[node] as Point);
    node = prev[node] as number;
  }
  return [s.point, ...chain, e.point];
};

/** Drops a point that lies on the straight line between its neighbours, and a point that repeats the one before it. */
const simplified = (path: readonly Point[]): Point[] => {
  const out: Point[] = [];
  for (const p of path) {
    const last = out[out.length - 1];
    if (last && dist(last, p) < EPS) continue;
    const before = out[out.length - 2];
    if (before && last) {
      const cross = (last.x - before.x) * (p.z - last.z) - (last.z - before.z) * (p.x - last.x);
      const dot = (last.x - before.x) * (p.x - last.x) + (last.z - before.z) * (p.z - last.z);
      if (Math.abs(cross) < EPS && dot > 0) out.pop();
    }
    out.push(p);
  }
  return out;
};

/**
 * The way from `from` to a click at `to`: to the nearest point of the walk graph, along the aisles, to the point of the graph nearest to the click, and from there to the click itself if that
 * last stretch is free. A click on a vessel, a plinth or the bench therefore ends the walk at the aisle in front of it, never inside it.
 */
export const pathOf = (l: Layout, from: Point, to: Point): Point[] => {
  const s = nearestOnGraph(l.walk, from);
  const e = nearestOnGraph(l.walk, to);
  const middle = s.edge === e.edge ? [s.point, e.point] : route(l.walk, s, e);
  const open = !blockedAt(l, to) && clear(l, e.point, to);
  return simplified([from, ...middle, ...(open ? [to] : [])]);
};

/** Walks `distance` metres along a path whose first point is where the walker is: where it ends up, what remains of the path (starting there), and whether it has arrived. */
export const advance = (path: readonly Point[], distance: number): { position: Point; rest: Point[]; done: boolean } => {
  let left = distance;
  let at = path[0] as Point;
  for (let k = 1; k < path.length; k++) {
    const next = path[k] as Point;
    const leg = dist(at, next);
    if (leg > left + EPS) {
      const t = leg === 0 ? 0 : left / leg;
      const position = { x: at.x + (next.x - at.x) * t, z: at.z + (next.z - at.z) * t };
      return { position, rest: [position, ...path.slice(k)], done: false };
    }
    left -= leg;
    at = next;
  }
  return { position: at, rest: [at], done: true };
};
