import { beforeAll, describe, expect, it } from "vitest";
import type { ScenarioRun } from "../src/run.ts";
import { DAY, holds } from "./support/metrics.ts";
import { runOf } from "./support/scenarios.ts";

// SC5 One analyzer down (spec 7): whom does the priority rule hand the cost?
// Metrics are reported, not gated (spec section 8; docs/prompts/00 section 2 item 8). These tests gate structural facts only: that nothing
// changes before the window opens, that no run occupies the analyzer inside it, that the window is logged where the ledger puts it, and
// that the queue order of each policy equals its definition. The metric questions (the hold_time of samples that arrive during or just
// before the window, and who bears the cost under EDF against FIFO) are reported in docs/progress.md over 20 seeds, never asserted here.
// AN-1 is in maintenance on day 8 (a Tuesday) from 08:30 to 12:30 beside the daily QC window of 08:00 to 08:30; AN-2 stays up.

const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);
const OPENS = 8 * DAY + 8 * 3600 + 1800; // A205: 08:30 on day 8
const CLOSES = OPENS + 4 * 3600; // A096: four hours

/** Replays the log: each visit_started must take the waiting request the policy puts first (earliest deadline, then arrival, then seq under EDF). */
const orderViolations = (run: ScenarioRun, policy: "fifo" | "edf"): string[] => {
  const groupOf = new Map(run.l3Input.analyzers.map((a) => [a.id, a.group] as const));
  const deadline = new Map(run.l3Input.requests.map((r) => [r.request_id, r.deadline_s ?? Infinity] as const));
  const waiting: { k: string; group: string; t: number; seq: number; dl: number }[] = [];
  const bad: string[] = [];
  for (const e of run.events) {
    if (e.type === "request_queued") waiting.push({ k: `${e.request_id}#${e.attempt}#${e.visit}`, group: e.group, t: e.t, seq: e.seq, dl: deadline.get(e.request_id) as number });
    if (e.type !== "visit_started") continue;
    const group = groupOf.get(e.analyzer);
    const order = (a: (typeof waiting)[number], b: (typeof waiting)[number]): number => (policy === "edf" ? a.dl - b.dl : 0) || a.t - b.t || a.seq - b.seq;
    const head = waiting.filter((w) => w.group === group).sort(order)[0];
    const k = `${e.request_id}#${e.attempt}#${e.visit}`;
    if (!head || head.k !== k) bad.push(`${policy} at t=${e.t}: took ${k}, expected ${head?.k}`);
    if (head) waiting.splice(waiting.indexOf(head), 1);
  }
  return bad;
};

describe("SC5 one analyzer down", () => {
  const control: ScenarioRun[] = [];
  const down: ScenarioRun[] = [];
  const edf: ScenarioRun[] = [];

  beforeAll(() => {
    for (const seed of SEEDS) {
      control.push(runOf("default", { seed }));
      down.push(runOf("sc05_one_analyzer_down", { seed }));
      edf.push(runOf("sc05_one_analyzer_down", { seed, queue_policy: "edf" }));
    }
  }, 600_000);

  it("Given the maintenance window and no maintenance with the same seed When the runs that started before the window opened are compared Then they are identical (the window changes nothing before it)", () => {
    SEEDS.forEach((seed, i) => {
      const before = (r: ScenarioRun) => new Map(holds((r as ScenarioRun).events).filter((h) => h.started_s < OPENS).map((h) => [h.sample_id, h.hold_s] as const));
      const a = before(control[i] as ScenarioRun);
      const b = before(down[i] as ScenarioRun);
      expect(a.size, `seed ${seed}`).toBeGreaterThan(100);
      expect([...b], `seed ${seed}`).toEqual([...a]);
    });
  });

  it("Then the log has maintenance_started at 08:30 and maintenance_ended at 12:30 on day 8 for AN-1 only, beside a daily QC window of 08:00 to 08:30 on both analyzers (A205, A096, A204)", () => {
    const ev = (down[0] as ScenarioRun).events;
    const m = ev.filter((e) => e.type === "maintenance_started" || e.type === "maintenance_ended");
    expect(m).toMatchObject([
      { type: "maintenance_started", t: OPENS, analyzer: "AN-1" },
      { type: "maintenance_ended", t: CLOSES, analyzer: "AN-1" },
    ]);
    const qc = ev.filter((e) => e.type === "qc_window_started") as { t: number; analyzer: string }[];
    expect(qc.filter((e) => e.t === 8 * DAY + 8 * 3600).map((e) => e.analyzer).sort()).toEqual(["AN-1", "AN-2"]);
    expect(ev.some((e) => e.type === "maintenance_started") && (control[0] as ScenarioRun).events.some((e) => e.type === "maintenance_started")).toBe(false);
  });

  it("Then no run occupies AN-1 inside the window, setup included, and AN-2 keeps running inside it", () => {
    for (const [i, seed] of SEEDS.entries()) {
      const runs = (down[i] as ScenarioRun).runs;
      for (const r of runs.filter((x) => x.analyzer === "AN-1")) {
        expect(r.start_s - r.setup_s < CLOSES && OPENS < r.end_s, `seed ${seed} ${r.request_id}#${r.attempt} on AN-1`).toBe(false);
      }
      expect(runs.some((r) => r.analyzer === "AN-2" && r.start_s >= OPENS && r.start_s < CLOSES), `seed ${seed}`).toBe(true);
    }
  });

  it("Given FIFO and then EDF When the queue is replayed Then every run takes the waiting request the policy puts first: arrival then seq, or earliest deadline (A206) then arrival then seq", () => {
    for (const [i, seed] of SEEDS.slice(0, 5).entries()) {
      expect(orderViolations(down[i] as ScenarioRun, "fifo"), `fifo seed ${seed}`).toEqual([]);
      expect(orderViolations(edf[i] as ScenarioRun, "edf"), `edf seed ${seed}`).toEqual([]);
    }
  });

  it("Given FIFO and EDF with the same seed Then the same samples and the same attempts are run (the draws are keyed, not ordered), and EDF reorders at least one run in the 20 seeds", () => {
    let reordered = 0;
    SEEDS.forEach((seed, i) => {
      const keys = (r: ScenarioRun) => r.runs.map((x) => `${x.request_id}#${x.attempt}#${x.visit}`);
      const a = keys(down[i] as ScenarioRun);
      const b = keys(edf[i] as ScenarioRun);
      expect([...b].sort(), `seed ${seed}`).toEqual([...a].sort());
      if (JSON.stringify([...(down[i] as ScenarioRun).runs].sort((x, y) => x.start_s - y.start_s || (x.request_id < y.request_id ? -1 : 1)).map((x) => x.request_id)) !== JSON.stringify([...(edf[i] as ScenarioRun).runs].sort((x, y) => x.start_s - y.start_s || (x.request_id < y.request_id ? -1 : 1)).map((x) => x.request_id))) reordered++;
    });
    expect(reordered).toBeGreaterThan(0);
  });
});
