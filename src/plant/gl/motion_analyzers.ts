import { BoxGeometry, MeshBasicMaterial, OctahedronGeometry, SphereGeometry } from "three";
import type { BufferGeometry, Group, Material } from "three";
import type { Layout } from "../layout.ts";
import type { AnalyzerLamp, SceneState } from "../scene_at.ts";
import { PALETTE } from "./floor.ts";
import { makePool } from "./pool.ts";
import { BENCH_TOP, analyzerShape } from "./shapes.ts";

// The analyzers that follow the clock (docs/design/plant_ui.md sections 3.2 and 4.3): the lamp (idle, setup, run, quality control, maintenance, closed), the run bar that fills from the run's start to
// its end, the sign across the front in a window (the bigger the sign the more it closes), the quality-control lamp after a visit (a ball for passed, a diamond for anything else), the result slip on
// the bench, and the calibration card on top. Shape carries the meaning and colour repeats it.

const LAMP: Record<AnalyzerLamp, number> = { idle: PALETTE.lampIdle, setup: 0xd9a23a, run: PALETTE.lampRunning, qc: 0x2f6fb0, maintenance: 0xd9a23a, closed: 0xb5483f };
const SIGN = { closed: { color: 0xb5483f, share: 0.95 }, maintenance: { color: 0xd9a23a, share: 0.62 }, qc: { color: 0x2f6fb0, share: 0.36 } } as const;

export const buildAnalyzerMotion = (layout: Layout, group: Group, disposables: (BufferGeometry | Material)[]): ((state: SceneState) => void) => {
  const n = layout.analyzers.length;
  const geometry = <G extends BufferGeometry>(g: G): G => {
    disposables.push(g);
    return g;
  };
  const basic = (color: number): MeshBasicMaterial => {
    const m = new MeshBasicMaterial({ color });
    disposables.push(m);
    return m;
  };
  const box = geometry(new BoxGeometry(1, 1, 1));
  const lamps = makePool(geometry(new SphereGeometry(0.07, 10, 8)), basic(0xffffff), n, { colored: true });
  const bars = makePool(box, basic(PALETTE.lampRunning), n);
  const signs = makePool(box, basic(0xffffff), n, { colored: true });
  const passed = makePool(geometry(new SphereGeometry(0.06, 10, 8)), basic(PALETTE.lampRunning), n);
  const other = makePool(geometry(new OctahedronGeometry(0.08)), basic(0xb5483f), n);
  const slips = makePool(box, basic(0xffffff), n);
  const cards = makePool(box, basic(0x2f6fb0), n);
  const pools = [lamps, bars, signs, passed, other, slips, cards];
  for (const p of pools) group.add(p.mesh);

  return (state) => {
    for (const p of pools) p.begin();
    for (const [i, a] of layout.analyzers.entries()) {
      const s = state.analyzers[i];
      if (!s) continue;
      const [w, h, d] = analyzerShape(a.profile);
      const front = a.z + d / 2;
      lamps.put(a.x + w * 0.32, BENCH_TOP + h * 0.88, front + 0.03, 1, 1, 1, 0, LAMP[s.lamp]);
      if (s.progress !== null) {
        const width = w * 0.7 * Math.max(0.02, s.progress);
        bars.put(a.x - w * 0.35 + width / 2, BENCH_TOP + h * 0.18, front + 0.03, width, 0.05, 0.02);
      }
      if (s.sign) {
        const sign = SIGN[s.sign];
        signs.put(a.x, BENCH_TOP + (h * sign.share) / 2, front + 0.07, w * 0.92, h * sign.share, 0.03, 0, sign.color);
      }
      if (s.verdict === "qc_passed") passed.put(a.x - w * 0.32, BENCH_TOP + h * 0.88, front + 0.03);
      else if (s.verdict !== null) other.put(a.x - w * 0.32, BENCH_TOP + h * 0.88, front + 0.03);
      if (s.slip) slips.put(a.x + 0.4, BENCH_TOP + 0.012, layout.bench.z + layout.bench.d - 0.2, 0.2, 0.012, 0.26);
      if (s.calibration) cards.put(a.x - w * 0.2, BENCH_TOP + h + 0.12, a.z, 0.26, 0.2, 0.03);
    }
    for (const p of pools) p.end();
  };
};
