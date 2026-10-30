import type { LineageEdge, LineageField, LineageNode } from "../protocol.ts";

// The geometry of one lineage column (docs/design/lab_ui.md section 8). Nodes are stacked in the order of the tables; a key that joins two of them is an edge drawn in a lane of the gutter at
// the left of the boxes, so that no edge crosses a box; an edge whose key is null is a stub on its node (the picture ends in a gap and the key is named in words). Pure data in, pure data
// out: the SVG component only draws what this returns.

export const COL_W = 360;
export const BOX_X = 44;
export const BOX_W = 304;
const HEAD_H = 22;
const LINE_H = 15;
const PAD = 6;
const GAP = 22;
const LANE_X0 = 36;
const LANE_DX = 7;
const ORDER = ["sample", "process_context", "analysis_request", "run", "instrument_state", "result", "audit_event", "validation_finding"];

export interface Box {
  id: string;
  table: string;
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** `value` is null where the record stores nothing ("not stored"). */
  lines: { name: string; value: string | null }[];
  /** The keys that are null in the record: a stub line that ends in a gap, one per missing key. */
  stubs: string[];
  /** The relations that arrive at this box, with the join basis where there is one; empty for a box nothing points at. */
  incoming: string;
}

export interface Path {
  from: string;
  to: string;
  relation: string;
  dashed: boolean;
  lane: number;
  laneX: number;
  y1: number;
  y2: number;
}

export interface Laid {
  width: number;
  height: number;
  boxes: Box[];
  edges: Path[];
}

/** Integers as they are, other numbers to six significant digits; the full value stays in the data. */
export const formatValue = (value: LineageField["value"]): string | null => (value === null ? null : typeof value === "number" ? (Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(6)))) : value);

const rank = (table: string): number => {
  const i = ORDER.indexOf(table);
  return i < 0 ? ORDER.length : i;
};

export const layoutRecord = ({ nodes, edges }: { nodes: readonly LineageNode[]; edges: readonly LineageEdge[] }): Laid => {
  const ordered = nodes.map((n, i) => ({ n, i })).sort((a, b) => rank(a.n.table) - rank(b.n.table) || a.i - b.i).map((x) => x.n);
  const stubsOf = (id: string): string[] => edges.filter((e) => e.from === id && e.to === null).map((e) => e.relation);
  const incomingOf = (id: string): string =>
    edges.filter((e) => e.to === id).map((e) => (e.basis ? `${e.relation} (${e.basis})` : e.relation)).filter((r, i, all) => all.indexOf(r) === i).join(", ");

  let y = 0;
  const boxes = ordered.map((n): Box => {
    const stubs = stubsOf(n.id);
    const incoming = incomingOf(n.id);
    const h = HEAD_H + PAD + n.fields.length * LINE_H + stubs.length * LINE_H + PAD;
    const box: Box = { id: n.id, table: n.table, key: n.key, x: BOX_X, y, w: BOX_W, h, lines: n.fields.map((f) => ({ name: f.name, value: formatValue(f.value) })), stubs, incoming };
    y += h + GAP;
    return box;
  });

  const at = new Map(boxes.map((b) => [b.id, b]));
  const linked = edges.flatMap((e) => {
    const [a, b] = [at.get(e.from), e.to === null ? undefined : at.get(e.to)];
    return a && b && e.to !== null ? [{ e, y1: a.y + HEAD_H / 2, y2: b.y + HEAD_H / 2 }] : [];
  });
  // greedy lanes: the edges by the top of their span, each in the first lane whose last edge ended above it
  const byTop = linked.map((l, i) => ({ ...l, i })).sort((p, q) => Math.min(p.y1, p.y2) - Math.min(q.y1, q.y2) || p.i - q.i);
  const laneEnds: number[] = [];
  const lanes = new Map<number, number>();
  for (const l of byTop) {
    const [lo, hi] = [Math.min(l.y1, l.y2), Math.max(l.y1, l.y2)];
    let lane = laneEnds.findIndex((end) => end < lo);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = hi;
    lanes.set(l.i, lane);
  }
  const paths = linked.map((l, i): Path => {
    const lane = lanes.get(i) as number;
    return { from: l.e.from, to: l.e.to as string, relation: l.e.relation, dashed: l.e.relation === "process_context", lane, laneX: Math.max(LANE_X0 - lane * LANE_DX, 4), y1: l.y1, y2: l.y2 };
  });
  return { width: COL_W, height: Math.max(y - GAP, 0), boxes, edges: paths };
};
