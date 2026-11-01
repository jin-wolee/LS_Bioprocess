import { beforeAll, describe, expect, it } from "vitest";
import { createChallenges } from "../../src/experiments/assembly/lab/challenges.ts";
import { answerPlantRun } from "../../src/experiments/assembly/lab/plant.ts";
import { layoutOf } from "../../../src/plant/layout.ts";
import { LOOK, sceneAt } from "../../../src/plant/scene_at.ts";
import { blockedAt } from "../../../src/plant/walk.ts";
import type { ScenePlan } from "../../../src/protocol.ts";
import { labData } from "../support/lab_data.ts";

// P4 (docs/design/plant_ui.md section 4): `sceneAt` on the real scene plan of the default scenario, seed 1, the 21 days with 394 drawn samples and 24 reactors (the run the plant shows). The
// hand plan of src/plant/fixture.ts fixes the arithmetic; this fixes what no hand plan can: that the real instants (draws 6 s apart for one operator, a queue held over a night, a rerun on the
// other analyzer) put every object where the log says it is. The properties are stated as the log states them: a tube is inside an analyzer exactly while a visit of it is open there, the queue
// of a lane is the tubes between `request_queued` and `visit_started`, an operator is at the vessel at the draw instant.

let plan: ScenePlan;
beforeAll(async () => {
  const data = labData();
  const run = { schema_version: "1" as const, scenario: "default", settings: {}, architectures: ["a_manual"], seeds: [1] };
  const out = await answerPlantRun(data, createChallenges(data), { spec: { run, seed: 1, actions: [] } });
  if (!out.ok) throw new Error(out.message);
  plan = out.answer.plan as ScenePlan;
}, 120_000);

const INSIDE = new Set(["enter", "setup", "run"]);

describe("The real plan of the default scenario at the instants of its log", () => {
  it("Given the run Then it has 394 drawn samples, 24 reactors and two analyzers (the plan the checks below walk)", () => {
    expect(plan.samples).toHaveLength(394);
    expect(plan.units).toHaveLength(24);
    expect(plan.analyzers).toHaveLength(2);
    expect(plan.horizon_s).toBe(1814400);
  });

  it("Given every visit Then its tube is inside its analyzer from visit_started to visit_finished and not one second before or after, and the analyzer holds it", () => {
    const bad: string[] = [];
    for (const [i, s] of plan.samples.entries()) {
      for (const v of s.visits) {
        const during = [v.started_s, v.started_s + 1, v.run_started_s, v.ended_s - 1];
        for (const t of during) {
          const tube = sceneAt(plan, t).tubes.find((x) => x.sample === i);
          const state = sceneAt(plan, t);
          if (!tube || !INSIDE.has(tube.phase)) bad.push(`${s.id} at ${t}: phase ${tube?.phase}`);
          if (v.ended_s - v.started_s > 1 && state.analyzers[v.analyzer]?.tube !== i && t < v.ended_s) bad.push(`${s.id} at ${t}: analyzer ${v.analyzer} holds ${state.analyzers[v.analyzer]?.tube}`);
        }
        // a later attempt can start the second the one before ends, on the other analyzer: the tube is then still in that one a second earlier
        const earlier = s.visits.find((o) => o.attempt === v.attempt - 1);
        const before = sceneAt(plan, v.started_s - 1).tubes.find((x) => x.sample === i);
        if (before && INSIDE.has(before.phase) && !(earlier && earlier.ended_s >= v.started_s)) bad.push(`${s.id} at ${v.started_s - 1}: in an analyzer before visit_started`);
        const after = sceneAt(plan, v.ended_s).tubes.find((x) => x.sample === i);
        if (after && after.phase !== "leave" && after.phase !== "wait" && after.phase !== "enter" && after.phase !== "setup" && after.phase !== "run") bad.push(`${s.id} at ${v.ended_s}: phase ${after.phase}`);
      }
    }
    expect(bad.slice(0, 5)).toEqual([]);
  });

  it("Given any instant of the busy mornings Then no more tubes are inside analyzers than there are analyzers, and each is the one that holds it", () => {
    for (let t = 8 * 86400 + 28800; t < 8 * 86400 + 46800; t += 97) {
      const state = sceneAt(plan, t);
      const inside = state.tubes.filter((x) => INSIDE.has(x.phase));
      expect(inside.length, `t = ${t}`).toBeLessThanOrEqual(plan.analyzers.length);
      expect(new Set(inside.map((x) => x.sample))).toEqual(new Set(state.analyzers.flatMap((a) => (a.tube === null ? [] : [a.tube]))));
    }
  });

  it("Given the queue of the lane at any instant Then its tubes hold the ranks 0, 1, 2 ... without a gap, and the analyzers report that many waiting", () => {
    for (let t = 6 * 86400; t < 9 * 86400; t += 1013) {
      const state = sceneAt(plan, t);
      const ranks = state.tubes.flatMap((x) => (x.phase === "wait" && x.rank !== null ? [x.rank] : [])).sort((a, b) => a - b);
      expect(ranks, `t = ${t}`).toEqual(ranks.map((_, k) => k));
      for (const a of state.analyzers) expect(a.queue, `t = ${t}`).toBe(ranks.length);
    }
  });

  it("Given a tube that arrives at the lane Then it does not jump when the ride ends: the place a second before and at the arrival are within 0.15 m", () => {
    const bad: string[] = [];
    for (const [i, s] of plan.samples.entries()) {
      if (s.arrived_s === null || s.skipped) continue;
      const a = sceneAt(plan, s.arrived_s - 1).tubes.find((x) => x.sample === i);
      const b = sceneAt(plan, s.arrived_s).tubes.find((x) => x.sample === i);
      if (!a || !b) bad.push(`${s.id}: missing`);
      else if (Math.hypot(a.x - b.x, a.z - b.z) > 0.15) bad.push(`${s.id}: ${Math.hypot(a.x - b.x, a.z - b.z).toFixed(2)} m`);
    }
    expect(bad.slice(0, 5)).toEqual([]);
  });

  it("Given every draw Then the operator is at the access point of the vessel at the draw instant, carrying that tube (a second draw of the same operator in the same second apart)", () => {
    const layout = layoutOf(plan.layout);
    const same = new Map<string, number>();
    for (const s of plan.samples) if (s.operator !== null && s.drawn_s !== null) same.set(`${s.operator}/${s.drawn_s}`, (same.get(`${s.operator}/${s.drawn_s}`) ?? 0) + 1);
    const bad: string[] = [];
    let checked = 0;
    for (const [i, s] of plan.samples.entries()) {
      if (s.operator === null || s.skipped || s.drawn_s === null || (same.get(`${s.operator}/${s.drawn_s}`) ?? 0) > 1) continue;
      const staff = sceneAt(plan, s.drawn_s).staff[s.operator];
      const access = (layout.vessels[s.unit] as { access: { x: number; z: number } }).access;
      if (!staff || !staff.on_duty || Math.hypot(staff.x - access.x, staff.z - access.z) > 1e-6 || staff.mode !== "at_vessel" || staff.carrying !== i) bad.push(`${s.id}: ${JSON.stringify(staff)}`);
      checked++;
    }
    expect(checked).toBeGreaterThan(380);
    expect(bad.slice(0, 3)).toEqual([]);
  });

  it("Given the staff over the busy mornings Then no figure is ever inside a vessel, the bench or a hall, or outside the floor", () => {
    const layout = layoutOf(plan.layout);
    const bad: string[] = [];
    for (let t = 7 * 86400 + 28800; t < 7 * 86400 + 64800; t += 41) {
      for (const [k, s] of sceneAt(plan, t).staff.entries()) if (s.on_duty && blockedAt(layout, s)) bad.push(`staff ${k} at ${t}: (${s.x.toFixed(1)}, ${s.z.toFixed(1)})`);
    }
    expect(bad.slice(0, 3)).toEqual([]);
  });

  it("Given the draw of a skipped sample or one with a lost tube Then no tube exists for it (the default run skips none, so the hand plan carries this case)", () => {
    expect(plan.samples.filter((s) => s.skipped)).toHaveLength(0);
  });

  it("Given the roster Then the floor is lit exactly when an operator is on duty, and the hour of the first shift is lit", () => {
    for (const t of [28800, 28800 + 3 * 3600, 64800 - 1, 64800, 86400 + 3600, 5 * 86400 + 12 * 3600, 5 * 86400 + 15 * 3600]) {
      const state = sceneAt(plan, t);
      expect(state.lit, `t = ${t}`).toBe(plan.staff.some((s) => s.on_duty.some(([a, b]) => a <= t && t < b)));
      expect(state.daylight).toBeGreaterThanOrEqual(LOOK.dim);
      expect(state.daylight).toBeLessThanOrEqual(1);
    }
    expect(sceneAt(plan, 28800).lit).toBe(true);
    expect(sceneAt(plan, 70000).lit).toBe(false);
  });
});
