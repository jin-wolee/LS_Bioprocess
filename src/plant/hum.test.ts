import { describe, expect, it, vi } from "vitest";
import { HUM, createHum } from "./hum.ts";

// The optional room hum (docs/design/plant_ui.md sections 2 and 9; P8a): made in code from oscillators, off until the reader turns it on (browsers refuse sound before a gesture, and the plant never plays
// one by itself), the choice kept in `localStorage` inside try/catch, and never the only carrier of anything. The audio context is a stub that counts what is made and started.

const stubContext = () => {
  const log = { contexts: 0, started: [] as number[], suspended: 0, resumed: 0, closed: 0 };
  const node = () => ({ connect: vi.fn() });
  const make = (): AudioContext => {
    log.contexts++;
    return {
      destination: {},
      createOscillator: () => ({ ...node(), type: "sine", frequency: { value: 0 }, start() { log.started.push((this as { frequency: { value: number } }).frequency.value); }, stop: vi.fn() }),
      createGain: () => ({ ...node(), gain: { value: 0 } }),
      createBiquadFilter: () => ({ ...node(), type: "lowpass", frequency: { value: 0 } }),
      resume: async () => { log.resumed++; },
      suspend: async () => { log.suspended++; },
      close: async () => { log.closed++; },
    } as unknown as AudioContext;
  };
  return { log, make };
};
const store = (initial?: string) => {
  const kept = new Map<string, string>(initial === undefined ? [] : [[HUM.key, initial]]);
  return { kept, storage: { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v) } };
};

describe("the room hum", () => {
  it("Given nothing saved Then the hum is off and no audio context is made, whatever the page does, until the reader turns it on", () => {
    const { log, make } = stubContext();
    const hum = createHum(store().storage, make);
    expect(hum.isOn()).toBe(false);
    hum.gesture();
    hum.gesture();
    expect(log.contexts).toBe(0);
    expect(log.started).toEqual([]);
  });

  it("Given the reader turns it on Then one context is made, the two oscillators start at the hum's two frequencies, and the choice is saved", () => {
    const { log, make } = stubContext();
    const { storage, kept } = store();
    const hum = createHum(storage, make);
    expect(hum.toggle()).toBe(true);
    expect(hum.isOn()).toBe(true);
    expect([log.contexts, log.started]).toEqual([1, [...HUM.hz]]);
    expect(kept.get(HUM.key)).toBe("on");
  });

  it("Given it is turned off and on again Then the one context is suspended and resumed, not made again, and each choice is saved", () => {
    const { log, make } = stubContext();
    const { storage, kept } = store();
    const hum = createHum(storage, make);
    hum.toggle();
    expect(hum.toggle()).toBe(false);
    expect([log.suspended, kept.get(HUM.key)]).toEqual([1, "off"]);
    hum.toggle();
    expect([log.contexts, log.resumed, kept.get(HUM.key)]).toEqual([1, 1, "on"]);
  });

  it("Given an earlier visit left it on Then the toggle reads on but nothing sounds until the first gesture of this visit, and then one context is made once", () => {
    const { log, make } = stubContext();
    const hum = createHum(store("on").storage, make);
    expect(hum.isOn()).toBe(true);
    expect(log.contexts).toBe(0);
    hum.gesture();
    hum.gesture();
    expect([log.contexts, log.started]).toEqual([1, [...HUM.hz]]);
  });

  it("Given an earlier visit left it off, or a value that is not on Then it stays off", () => {
    for (const saved of ["off", "", "yes"]) {
      const { log, make } = stubContext();
      const hum = createHum(store(saved).storage, make);
      hum.gesture();
      expect([hum.isOn(), log.contexts]).toEqual([false, 0]);
    }
  });

  it("Given storage that throws on every call Then the hum still works and the choice is simply not kept", () => {
    const { log, make } = stubContext();
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    const hum = createHum(broken, make);
    expect(hum.isOn()).toBe(false);
    expect(hum.toggle()).toBe(true);
    expect(log.contexts).toBe(1);
    expect(createHum(null, make).toggle()).toBe(true);
  });

  it("Given the reader leaves the plant Then the context is closed", () => {
    const { log, make } = stubContext();
    const hum = createHum(store().storage, make);
    hum.toggle();
    hum.close();
    expect(log.closed).toBe(1);
    hum.close();
    expect(log.closed).toBe(1);
  });
});
