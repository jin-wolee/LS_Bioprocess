import { describe, expect, it } from "vitest";
import { DAY, DEFAULT_SPEED, HOUR, SPEEDS, advance, seek, startClock, toggle, withSpeed } from "./clock.ts";

// P4 (docs/design/plant_ui.md section 4.2): the clock of the plant is a plain state and pure functions of it. Wall time moves it only while it plays, by the wall seconds times the speed; nothing
// else moves it. Expected values are hand arithmetic.

const HORIZON = 40000;
const playing = (t: number, speed: (typeof SPEEDS)[number] = 120) => ({ t, speed, playing: true });

describe("The speed presets", () => {
  it("Given section 4.2 Then the presets are 30, 120, 600 and 3600 simulated seconds for each second, and 120 is the default", () => {
    expect([...SPEEDS]).toEqual([30, 120, 600, 3600]);
    expect(DEFAULT_SPEED).toBe(120);
    expect([HOUR, DAY]).toEqual([3600, 86400]);
  });

  it("Given a new clock Then it holds the instant it was given, at the default speed, playing or not as asked", () => {
    expect(startClock(28800, true)).toEqual({ t: 28800, speed: 120, playing: true });
    expect(startClock(28800, false)).toEqual({ t: 28800, speed: 120, playing: false });
  });
});

describe("advance: wall time moves the clock only while it plays", () => {
  it("Given a paused clock Then any wall time leaves it where it is", () => {
    const paused = { t: 1000, speed: 120, playing: false } as const;
    for (const dt of [0, 0.016, 1, 100]) expect(advance(paused, dt, HORIZON)).toEqual(paused);
  });

  it("Given a playing clock at 120 Then half a wall second is 60 simulated seconds", () => {
    expect(advance(playing(1000), 0.5, HORIZON).t).toBe(1060);
  });

  it("Given each preset Then a tenth of a wall second is 3, 12, 60 and 360 simulated seconds", () => {
    expect(SPEEDS.map((speed) => advance(playing(0, speed), 0.1, HORIZON).t)).toEqual([3, 12, 60, 360]);
  });

  it("Given a frame at the top speed Then it advances 60 simulated seconds at 60 frames a second, well under the 600 s a transport takes at least", () => {
    expect(advance(playing(0, 3600), 1 / 60, HORIZON).t).toBeCloseTo(60, 9);
  });

  it("Given the clock reaches the horizon Then it stops there and stops playing, and more wall time changes nothing", () => {
    const end = advance(playing(39990), 1, HORIZON);
    expect(end).toEqual({ t: 40000, speed: 120, playing: false });
    expect(advance(end, 5, HORIZON)).toEqual(end);
  });

  it("Given a clock that was advanced Then the one it came from is unchanged (a pure function)", () => {
    const before = playing(1000);
    advance(before, 1, HORIZON);
    expect(before).toEqual({ t: 1000, speed: 120, playing: true });
  });
});

describe("seek, speed and toggle", () => {
  it("Given a seek outside the run Then the clock is held to 0 s and to the horizon, and keeps its speed and its play state", () => {
    expect(seek(playing(5000, 600), -50, HORIZON)).toEqual({ t: 0, speed: 600, playing: true });
    expect(seek(playing(5000, 600), 99999, HORIZON)).toEqual({ t: 40000, speed: 600, playing: true });
    expect(seek(playing(5000), 12345, HORIZON).t).toBe(12345);
  });

  it("Given a seek by an hour and by a day Then the instant moves by 3600 and by 86400", () => {
    expect(seek(playing(10000), 10000 + HOUR, 200000).t).toBe(13600);
    expect(seek(playing(100000), 100000 - DAY, 200000).t).toBe(13600);
  });

  it("Given a speed Then the clock takes it and keeps the instant", () => {
    expect(withSpeed(playing(5000), 3600)).toEqual({ t: 5000, speed: 3600, playing: true });
  });

  it("Given play and pause Then toggle flips the state and keeps the instant", () => {
    const paused = { t: 5000, speed: 120, playing: false } as const;
    expect(toggle(paused, HORIZON, 0)).toEqual({ t: 5000, speed: 120, playing: true });
    expect(toggle(playing(5000), HORIZON, 0)).toEqual({ t: 5000, speed: 120, playing: false });
  });

  it("Given the clock stopped at the horizon Then play starts again from the start of the plan", () => {
    expect(toggle({ t: 40000, speed: 120, playing: false }, HORIZON, 28800)).toEqual({ t: 28800, speed: 120, playing: true });
  });
});
