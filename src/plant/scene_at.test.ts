import { describe, expect, it } from "vitest";
import { handPlan, indexOf } from "./fixture.ts";
import { layoutOf } from "./layout.ts";
import { LOOK, sceneAt, slotPoint } from "./scene_at.ts";
import {
  at, DIGITS, near, plan, tube,
  staffShift, staffFirstWalk, staffCarry, staffNextDraw, staffWait, staffReturnHome, staffSecondOperator,
  tubeHand, tubeTransport, tubeEnter, tubeRun, tubeLeave, tubeLabel,
  analyzerRun, analyzerMaintenance, analyzerSetup, analyzerFailedQc, analyzerPassedQc, analyzerCalibration, analyzerWindows,
} from "./scene_at_test_helpers.ts";

// P4 (docs/design/plant_ui.md sections 4.2 and 4.3): `sceneAt(plan, t)` on the plan typed by hand in fixture.ts. Every expected value is hand arithmetic on the metres of the layout, worked out
// here from `METRES` of layout.ts for one bay of two reactors and two analyzers of one group:
//   width 28, depth 22.4. Vessels U01 (13, 11.2) and U02 (15, 11.2); their access points on the aisle south of the bay (13, 14.7) and (15, 14.7). The bench is x 10.4 to 17.6, z 16.2 to 17.4;
//   AN-1 at x 12.8, AN-2 at x 15.2. The aisle in front of the bench is z 18.9 and the lane is on it at x 14. The entrance is (14, 18.9). The walk graph is a ladder: the aisles x 3.5 and
//   x 24.5 from z 3.5 to z 18.9, and the cross aisles at z 3.5, 7.7, 14.7 and 18.9.
//   View constants (LOOK): a tray at z 17.85 with slot rows 0.15 apart, slots 0.2 apart fanning out from the middle; a tube enters an analyzer and leaves it in 60 s and 120 s; the port of an analyzer
//   is (x, 17.3) and the rack is (18.2, 16.8); the staff walk at 0.06 m for each simulated second from homes on the aisle at z 18.9, x 15.6 for OP-01 and 16.4 for OP-02.

describe("The view constants", () => {
  it("Given LOOK Then the stretches and paces are the ones the design text names", () => {
    expect(LOOK.feed_s).toBe(1200);
    expect(LOOK.alarm_s).toBe(1800);
    expect(LOOK.cap_s).toBe(1800);
    expect(LOOK.hand_s).toBe(60);
    expect(LOOK.enter_s).toBe(60);
    expect(LOOK.leave_s).toBe(120);
    expect(LOOK.walk_mps).toBe(0.06);
    expect(LOOK.dim).toBe(0.35);
    expect(LOOK.ramp_s).toBe(1800);
  });
});

describe("The slots of the intake lane", () => {
  const layout = layoutOf(plan.layout);

  it("Given the lane of the AIO group on the tray at z 17.85 Then the slots fan out from the middle x 14 in steps of 0.2 m", () => {
    expect(layout.lanes).toHaveLength(1);
    const xs = [0, 1, 2, 3, 4].map((k) => slotPoint(layout, 0, k).x);
    expect(xs[0]).toBeCloseTo(14, DIGITS);
    expect(xs[1]).toBeCloseTo(14.2, DIGITS);
    expect(xs[2]).toBeCloseTo(13.8, DIGITS);
    expect(xs[3]).toBeCloseTo(14.4, DIGITS);
    expect(xs[4]).toBeCloseTo(13.6, DIGITS);
    expect(slotPoint(layout, 0, 0).z).toBeCloseTo(17.7, DIGITS);
  });

  it("Given the lane is 4.4 m long Then a row holds 21 slots and the next row is 0.15 m nearer the aisle", () => {
    expect(slotPoint(layout, 0, 20).z).toBeCloseTo(17.7, DIGITS);
    expect(slotPoint(layout, 0, 21).x).toBeCloseTo(14, DIGITS);
    expect(slotPoint(layout, 0, 21).z).toBeCloseTo(17.85, DIGITS);
    expect(slotPoint(layout, 0, 42).z).toBeCloseTo(18, DIGITS);
  });
});

describe("The vessels (rows inoculation, harvest, unit_stopped, feed, temperature_shift, alarm, signal_observed, deviation_opened)", () => {
  it("Given U01 is inoculated at 1000 s and harvested at 9000 s Then its lamp is idle, running, then harvested, at those seconds", () => {
    expect([999, 1000, 8999, 9000].map((t) => at(t).vessels[0]?.lamp)).toEqual(["idle", "running", "running", "harvested"]);
  });

  it("Given U02 is stopped at 12000 s Then its lamp turns to stopped", () => {
    expect([11999, 12000].map((t) => at(t).vessels[1]?.lamp)).toEqual(["running", "stopped"]);
  });

  it("Given a rule feed on U01 at 3000 s and a pulse of 1200 s Then halfway through it the pulse is at 0.5, and at 4200 s it is over", () => {
    expect(at(2999).vessels[0]?.feed).toBeNull();
    expect(at(3600).vessels[0]?.feed).toEqual({ scripted: false, progress: 0.5 });
    expect(at(4199).vessels[0]?.feed?.progress).toBeCloseTo(1199 / 1200, DIGITS);
    expect(at(4200).vessels[0]?.feed).toBeNull();
  });

  it("Given a scripted feed on U02 at 3500 s Then its pulse says it is scripted, a quarter through at 3800 s", () => {
    expect(at(3800).vessels[1]?.feed).toEqual({ scripted: true, progress: 0.25 });
    expect(at(3800).vessels[0]?.feed?.scripted).toBe(false);
  });

  it("Given a temperature shift on U01 at 3600 s Then its jacket is shifted from that second on and U02's never", () => {
    expect([3599, 3600, 30000].map((t) => at(t).vessels[0]?.shifted)).toEqual([false, true, true]);
    expect(at(30000).vessels[1]?.shifted).toBe(false);
  });

  it("Given an alarm on U01 at 4000 s and a beacon of 1800 s Then the beacon is on from 4000 s to 5799 s", () => {
    expect([3999, 4000, 5799, 5800].map((t) => at(t).vessels[0]?.beacon)).toEqual([null, "alarm", "alarm", null]);
  });

  it("Given a signal on U02 at 7000 s Then an amber beacon stands for 1800 s, and the deviation tag from 7500 s stays", () => {
    expect([6999, 7000, 8799, 8800].map((t) => at(t).vessels[1]?.beacon)).toEqual([null, "signal", "signal", null]);
    expect([7499, 7500, 39999].map((t) => at(t).vessels[1]?.deviation)).toEqual([false, true, true]);
  });
});

describe("A skipped draw (row draw_skipped_volume_budget)", () => {
  it("Given the draw of U02-D00-2 at 5000 s was skipped Then the vessel wears the volume-cap tag for 1800 s and no tube ever appears", () => {
    expect([4999, 5000, 6799, 6800].map((t) => at(t).vessels[1]?.capTag)).toEqual([false, true, true, false]);
    for (const t of [5000, 5100, 5900, 9000]) expect(tube(at(t), "U02-D00-2")).toBeUndefined();
    expect(at(5000).vessels[0]?.capTag).toBe(false);
  });

  it("Given the skipped draw names no operator Then no figure stands at the vessel because of it", () => {
    expect(at(5000).staff.every((s) => s.carrying === null)).toBe(true);
  });
});

describe("The staff (rows sample_drawn and the roster)", () => {
  it("Given OP-02 is on duty from 10000 s Then it is not drawn before and is at its home (16.4, 18.9) when the shift opens", staffShift);

  it("Given OP-01 draws U01-D00-1 at U01 at 2000 s and the walk is 24.6 m at 0.06 m/s (410 s) Then it leaves home at 1590 s, is at (24.5, 15.5) halfway and arrives at 2000 s", staffFirstWalk);

  it("Given a draw at 2000 s and the next one 100 s later Then the operator carries the tube for 50 s, the half of the gap, and stays at the vessel until it must go", staffCarry);

  it("Given the next draw is at U02, 2 m away, 100 s after the first Then the operator walks the 2 m in the 33.3 s that are left and is at (15, 14.7) at 2100 s", staffNextDraw);

  it("Given 740 s between the draw at 2200 s and the next at 3000 s, too few to go home and back (820 s) Then the operator waits at the vessel", staffWait);

  it("Given 4940 s between the draw at 3000 s and the next at 8000 s Then the operator walks home after the stay, idles there and leaves again to arrive at 8000 s", staffReturnHome);

  it("Given OP-02 draws at U02 at 11000 s and the walk is 21.8 m (363.3 s) Then it is at (15, 14.7) at 11000 s carrying the tube", staffSecondOperator);
});

describe("The tube of a sample (rows sample_drawn, label_bound, sample_received, request_queued, visit_started, run_started, visit_finished)", () => { // drawn 2000 s at U01, received and started on AN-1 at 2700 s, finished at 2970 s

  it("Given the draw at 2000 s Then there is no tube before it and a tube in the hand at the vessel for 60 s", tubeHand);

  it("Given a transport of 640 s on the aisles Then the tube rides the 25.4 m (24.2 m to the lane and 1.2 m to its slot), and is at (3.5, 17.9) halfway", tubeTransport);

  it("Given the visit starts at 2700 s with no wait Then the tube is in no analyzer before 2699 s and glides in from the first slot over 60 s", tubeEnter);

  it("Given the run lasts to 2970 s Then the tube sits at the port of AN-1 (12.8, 17.3) in the phase run, and AN-1 holds it", tubeRun);

  it("Given the visit finishes at 2970 s Then the tube goes to the rack (18.2, 16.8) over 120 s, is at (15.5, 17.05) halfway, and is gone at 3090 s", tubeLeave);

  it("Given the label of the sample Then the tube carries the method it was bound with", tubeLabel);
});

describe("The queue in the intake lane (row request_queued)", () => {
  it("Given U02-D00-1 waits from 2800 s to 2970 s and U01-D00-2 from 2900 s to 3240 s Then at 2950 s they hold the first and the second slot, in the order they will enter", () => {
    const state = at(2950);
    const first = tube(state, "U02-D00-1");
    const second = tube(state, "U01-D00-2");
    expect([first?.phase, first?.rank]).toEqual(["wait", 0]);
    near(first, 14, 17.7);
    expect([second?.phase, second?.rank]).toEqual(["wait", 1]);
    near(second, 14.2, 17.7);
    expect(state.analyzers.map((a) => a.queue)).toEqual([2, 2]);
  });

  it("Given the first of them enters AN-1 at 2970 s Then the second moves up to the first slot while the first glides in", () => {
    const state = at(3000);
    const next = tube(state, "U01-D00-2");
    expect([next?.phase, next?.rank]).toEqual(["wait", 0]);
    near(next, 14, 17.7);
    const gliding = tube(state, "U02-D00-1");
    expect(gliding?.phase).toBe("enter");
    near(gliding, 13.4, 17.5);
    expect(state.analyzers.map((a) => a.queue)).toEqual([1, 1]);
  });

  it("Given a tube that arrives at 2900 s behind one that waits Then it rides to the second slot, which it will hold on arrival", () => {
    const late = tube(at(2899), "U01-D00-2");
    expect(late?.phase).toBe("transport");
    expect(late?.x).toBeCloseTo(14.2, 1);
    const settled = tube(at(2900), "U01-D00-2");
    expect([settled?.phase, settled?.rank]).toEqual(["wait", 1]);
    near(settled, 14.2, 17.7);
  });

  it("Given nothing waits Then every analyzer's queue is 0", () => {
    expect(at(1000).analyzers.map((a) => a.queue)).toEqual([0, 0]);
    expect(at(6000).analyzers.map((a) => a.queue)).toEqual([0, 0]);
  });
});

describe("A second attempt is a second pass (row rerun_requested)", () => {
  const id = "U01-D00-3"; // attempt 1 on AN-1 3700 to 3970 s (QC failed), attempt 2 on AN-2 queued 3970 s, started 4240 s, finished 4510 s

  it("Given the first attempt finishes at 3970 s Then the tube leaves AN-1 for the lane, not for the rack, with a ring", () => {
    const back = tube(at(3985), id);
    expect(back?.phase).toBe("wait");
    expect(back?.rerun).toBe(true);
    expect(back?.rank).toBe(0);
    // a quarter of the 60 s glide from the port (12.8, 17.3) to the first slot (14, 17.7)
    near(back, 13.1, 17.4);
    near(tube(at(4030), id), 14, 17.7);
  });

  it("Given the first pass is not a rerun Then it carries no ring, and the second pass enters AN-2", () => {
    expect(tube(at(3800), id)?.rerun).toBe(false);
    const entering = tube(at(4270), id);
    expect(entering?.phase).toBe("enter");
    expect(entering?.rerun).toBe(true);
    near(entering, 14.6, 17.5);
    expect(at(4400).analyzers[1]?.tube).toBe(indexOf(plan, id));
    expect(at(3800).analyzers[0]?.tube).toBe(indexOf(plan, id));
  });

  it("Given the second pass ends at 4510 s Then the tube goes to the rack", () => {
    expect(tube(at(4510), id)?.phase).toBe("leave");
    expect(tube(at(4630), id)).toBeUndefined();
  });
});

describe("A rerun that starts the second the first run ends (row rerun_requested, no wait)", () => {
  const id = "U02-D00-4"; // attempt 1 on AN-1 14700 to 14970 s (QC failed), attempt 2 on AN-2 from 14970 s to 15240 s

  it("Given the second attempt starts when the first ends Then the tube glides from the port of AN-1 (12.8, 17.3) to that of AN-2 (15.2, 17.3) and does not jump through the lane", () => {
    const last = tube(at(14969), id);
    expect(last?.phase).toBe("run");
    near(last, 12.8, 17.3);
    const first = tube(at(14970), id);
    expect([first?.phase, first?.rerun]).toEqual(["enter", true]);
    near(first, 12.8, 17.3);
    near(tube(at(15000), id), 14, 17.3);
    const done = tube(at(15030), id);
    expect(done?.phase).toBe("run");
    near(done, 15.2, 17.3);
  });
});

describe("The analyzers (rows visit_started, run_started, result_measured, qc_result, visit_finished, the windows, calibration_recorded)", () => {
  it("Given a run on AN-1 from 2700 s to 2970 s Then at 2750 s its lamp is run, the bar is 5/27 along and AN-2 wears a maintenance sign", analyzerRun);

  it("Given the maintenance window of AN-2 is 2000 s to 3300 s Then the sign is gone at 3300 s", analyzerMaintenance);

  it("Given a setup of 120 s on AN-2 from 11700 s and a run from 11820 s to 12090 s Then the lamp is setup, then run, and the bar starts at 0 and is half at 11955 s", analyzerSetup);

  it("Given a failed run ends at 3970 s Then the QC lamp of AN-1 shows failed for 600 s and the slip is out, and shows nothing at 4570 s", analyzerFailedQc);

  it("Given a passed run ends at 2970 s Then the QC lamp shows passed at 2985 s while the next run has begun", analyzerPassedQc);

  it("Given a calibration of AN-1 at 5000 s and a card of 900 s Then the card stands from 5000 s to 5899 s on AN-1 only", analyzerCalibration);

  it("Given AN-1 has a quality-control window to 1500 s and is closed from 20000 s to 30000 s Then the lamp and the sign say so", analyzerWindows);
});

describe("The lights follow the roster (section 4.2)", () => {
  it("Given the shifts of both operators cover 0 s to 30000 s Then the floor is lit inside and the daylight is 1", () => {
    for (const t of [0, 12345, 29999]) expect(at(t)).toMatchObject({ lit: true, daylight: 1 });
  });

  it("Given the window ends at 30000 s Then the floor is dim from that second and falls over 1800 s to 0.35: 0.675 after 900 s, 0.35 from 31800 s", () => {
    const edge = at(30000);
    expect(edge.lit).toBe(false);
    expect(edge.daylight).toBe(1);
    expect(at(30900).daylight).toBeCloseTo(0.675, DIGITS);
    expect(at(31800).daylight).toBeCloseTo(0.35, DIGITS);
    expect(at(40000).daylight).toBeCloseTo(0.35, DIGITS);
  });
});

describe("The seek property (section 4.2): the scene is a function of the plan and of t, so the order of the questions changes no answer", () => {
  const instants = [
    0, 1000, 1589.5, 1590, 1795, 2000, 2049.9, 2060, 2083, 2100, 2380, 2699, 2700, 2730, 2750, 2800, 2950, 2970, 3000, 3030, 3090, 3265, 3500, 3600, 3985, 4000, 4030, 4270, 4400, 4569.5, 5000, 5899, 7000,
    7590, 7800, 8000, 8700, 9000, 10000, 10700, 11000, 11730, 11790, 11955, 12000, 20000, 25000, 30000, 30900, 39999.5, 40000,
  ];

  /** A fixed shuffle with an integer sequence (no random number: the repository allows none). */
  const shuffled = (xs: readonly number[]): number[] => {
    const out = [...xs];
    let seed = 12345;
    for (let i = out.length - 1; i > 0; i--) {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      const j = seed % (i + 1);
      [out[i], out[j]] = [out[j] as number, out[i] as number];
    }
    return out;
  };

  it("Given the instants in order and in a fixed shuffle Then each instant gives the same scene, and a third question for the same instant gives it again", () => {
    const ordered = new Map(instants.map((t) => [t, JSON.stringify(sceneAt(plan, t))]));
    const mixed = shuffled(instants);
    expect(mixed).not.toEqual(instants);
    for (const t of mixed) expect(JSON.stringify(sceneAt(plan, t)), `t = ${t}`).toBe(ordered.get(t));
    for (const t of [...mixed].reverse()) expect(JSON.stringify(sceneAt(plan, t)), `t = ${t}`).toBe(ordered.get(t));
  });

  it("Given a fresh copy of the plan Then it answers as the first one does", () => {
    const copy = handPlan();
    for (const t of instants) expect(JSON.stringify(sceneAt(copy, t)), `t = ${t}`).toBe(JSON.stringify(sceneAt(plan, t)));
  });
});

describe("Nothing but the frame loop reads the wall clock", () => {
  it("Given the pure modules of the motion Then none of them names a clock, a timer or a random number", async () => {
    const { readFileSync } = await import("node:fs");
    for (const name of ["scene_at.ts", "scene_look.ts", "scene_index.ts", "clock.ts", "events.ts", "playback.ts"]) {
      const source = readFileSync(new URL(`./${name}`, import.meta.url), "utf8");
      expect(source, name).not.toMatch(/Date\.now|new Date|performance\.now|Math\.random|requestAnimationFrame|setTimeout|setInterval/);
    }
  });
});
