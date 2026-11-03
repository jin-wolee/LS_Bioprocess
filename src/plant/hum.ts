// The optional room hum of the plant (docs/design/plant_ui.md sections 2 and 9, P8a): two low sine oscillators through a low-pass filter, made in code (no sound file). It is off until the reader turns it
// on: browsers refuse sound before a gesture and the plant never plays one by itself, so no audio context is made until the toggle is pressed (or, when an earlier visit left it on, until the first gesture
// of this one). It is never the only carrier of information: nothing on the floor is told by it. The choice is kept in `localStorage` inside try/catch; storage that is blocked only means the choice is not kept.
// Pure of the page: the storage and the way to make an audio context are given, so Vitest runs it in Node with a stub.

/** The key of the choice, the two frequencies of the hum in hertz, its level, and the corner of the low-pass filter in hertz. View constants, not domain numbers. */
export const HUM = { key: "plant.hum", hz: [50, 100.4], level: 0.04, corner: 400 } as const;

export interface Hum {
  /** Whether the reader has it on (the toggle's state): true after an earlier visit left it on, though nothing sounds before a gesture. */
  isOn(): boolean;
  /** The toggle: on when it was off and off when it was on; the press is the gesture that lets the sound start. Returns the new state. */
  toggle(): boolean;
  /** A gesture of the reader on the page (a press, a key): starts the hum if an earlier visit left it on and it has not sounded yet. Otherwise nothing. */
  gesture(): void;
  /** The reader leaves the plant: the audio context is closed. */
  close(): void;
}

type Store = Pick<Storage, "getItem" | "setItem">;

const read = (storage: Store | null): boolean => {
  try {
    return storage?.getItem(HUM.key) === "on";
  } catch {
    return false;
  }
};
const write = (storage: Store | null, on: boolean): void => {
  try {
    storage?.setItem(HUM.key, on ? "on" : "off");
  } catch {
    // blocked storage: the choice is not kept, the hum still works
  }
};

export const createHum = (storage: Store | null, makeContext: () => AudioContext): Hum => {
  let on = read(storage);
  let ctx: AudioContext | null = null;

  const start = (): void => {
    if (ctx) {
      void ctx.resume();
      return;
    }
    ctx = makeContext();
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = HUM.corner;
    const gain = ctx.createGain();
    gain.gain.value = HUM.level;
    filter.connect(gain);
    gain.connect(ctx.destination);
    for (const hz of HUM.hz) {
      const oscillator = ctx.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.value = hz;
      oscillator.connect(filter);
      oscillator.start();
    }
  };

  return {
    isOn: () => on,
    toggle() {
      on = !on;
      write(storage, on);
      if (on) start();
      else void ctx?.suspend();
      return on;
    },
    gesture() {
      if (on && ctx === null) start();
    },
    close() {
      void ctx?.close();
      ctx = null;
    },
  };
};
