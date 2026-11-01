import { describe, expect, it } from "vitest";
import { handPlan } from "./fixture.ts";
import { createPlayback } from "./playback.ts";

// P4 (docs/design/plant_ui.md section 4.2): the clock of the page. Wall seconds reach it only through `tick`, and `tick` moves the clock only while it plays; the other calls are the reader's.
// The hand plan of fixture.ts has its first event instants at 0, 1000, 1500, 2000, 2100 and horizon 40000 s.

const plan = handPlan();
const make = (playing: boolean) => createPlayback(plan, playing);

describe("The clock of the page", () => {
  it("Given a plan Then the clock starts at the opening of the first staffed window (0 s here), at the default speed", () => {
    expect(make(false).get()).toEqual({ t: 0, speed: 120, playing: false });
  });

  it("Given the clock is paused Then wall time does not move it, however long", () => {
    const pb = make(false);
    for (let i = 0; i < 100; i++) pb.tick(0.1);
    expect(pb.get().t).toBe(0);
  });

  it("Given the clock plays Then a tenth of a wall second is 12 simulated seconds at 120", () => {
    const pb = make(false);
    pb.toggle();
    pb.tick(0.1);
    expect(pb.get().t).toBe(12);
    pb.toggle();
    pb.tick(10);
    expect(pb.get().t).toBe(12);
  });

  it("Given a speed Then the next tick uses it, and 3600 gives 360 s for a tenth", () => {
    const pb = make(true);
    pb.setSpeed(3600);
    pb.tick(0.1);
    expect(pb.get()).toEqual({ t: 360, speed: 3600, playing: true });
  });

  it("Given a seek Then the clock is there, clamped to the run, and play is not changed", () => {
    const pb = make(true);
    pb.seek(5000);
    expect(pb.get()).toMatchObject({ t: 5000, playing: true });
    pb.seek(-3);
    expect(pb.get().t).toBe(0);
    pb.seek(1e9);
    expect(pb.get().t).toBe(40000);
  });

  it("Given jumps of an hour and a day Then the clock moves by 3600 and 86400, held to the run", () => {
    const pb = make(false);
    pb.seek(10000);
    pb.jump(3600);
    expect(pb.get().t).toBe(13600);
    pb.jump(-3600 * 2);
    expect(pb.get().t).toBe(6400);
    pb.jump(-86400);
    expect(pb.get().t).toBe(0);
    pb.jump(86400);
    expect(pb.get().t).toBe(40000);
  });

  it("Given a step to the next event Then the clock is at that instant, paused", () => {
    const pb = make(true);
    pb.seek(2000);
    pb.step(1);
    expect(pb.get()).toMatchObject({ t: 2100, playing: false });
    pb.step(-1);
    expect(pb.get().t).toBe(2000);
    pb.step(-1);
    expect(pb.get().t).toBe(1500);
  });

  it("Given a step with no event on that side Then the clock stays and is paused", () => {
    const pb = make(true);
    pb.step(-1);
    expect(pb.get()).toMatchObject({ t: 0, playing: false });
    pb.seek(35000);
    pb.step(1);
    expect(pb.get().t).toBe(35000);
  });

  it("Given a clock that plays to the horizon Then it stops there", () => {
    const pb = make(true);
    pb.seek(39990);
    pb.tick(1);
    expect(pb.get()).toEqual({ t: 40000, speed: 120, playing: false });
  });

  it("Given subscribers Then each hears every change, and not after it unsubscribes", () => {
    const pb = make(false);
    let heard = 0;
    const stop = pb.subscribe(() => heard++);
    pb.toggle();
    pb.setSpeed(600);
    pb.seek(100);
    expect(heard).toBe(3);
    stop();
    pb.tick(0.1);
    expect(heard).toBe(3);
    expect(pb.get().t).toBe(160);
  });

  it("Given a tick of a paused clock Then nobody is told, because nothing changed", () => {
    const pb = make(false);
    let heard = 0;
    pb.subscribe(() => heard++);
    pb.tick(1);
    expect(heard).toBe(0);
  });
});
