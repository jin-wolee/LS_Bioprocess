import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lookKey } from "./controls.ts";
import { clockKeys } from "./keys.ts";
import type { Playback } from "./playback.ts";

// The keys of the clock (docs/design/plant_ui.md section 3.4): F is the follow of a picked sample and the camera's look never uses it (P8a). The test runs in Node, so the two DOM classes the handler asks about are stubbed.

const press = (handler: (e: KeyboardEvent) => void, key: string): { prevented: boolean } => {
  const seen = { prevented: false };
  handler({ key, ctrlKey: false, metaKey: false, altKey: false, target: null, preventDefault: () => (seen.prevented = true) } as unknown as KeyboardEvent);
  return seen;
};

describe("F", () => {
  beforeEach(() => {
    vi.stubGlobal("HTMLElement", class {});
    vi.stubGlobal("HTMLInputElement", class {});
  });
  afterEach(() => vi.unstubAllGlobals());

  const handler = (picked: boolean, toggled: string[]) =>
    clockKeys({ playback: {} as Playback, times: () => undefined, follow: () => picked, toggleFollow: () => toggled.push("follow") });

  it("Given a sample is picked When F is pressed Then the follow is toggled and the key is taken", () => {
    const toggled: string[] = [];
    expect(press(handler(true, toggled), "f").prevented).toBe(true);
    expect(press(handler(true, toggled), "F").prevented).toBe(true);
    expect(toggled).toEqual(["follow", "follow"]);
  });

  it("Given no sample is picked When F is pressed Then nothing happens: it does not tilt the camera either", () => {
    const toggled: string[] = [];
    expect(press(handler(false, toggled), "f").prevented).toBe(false);
    expect(toggled).toEqual([]);
    expect(lookKey("f")).toBeNull();
  });
});
