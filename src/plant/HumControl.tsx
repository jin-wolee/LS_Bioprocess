import { useContext, useEffect, useRef, useState } from "preact/hooks";
import { text } from "../i18n/index.ts";
import { LangContext, T } from "../ui/T.tsx";
import { createHum } from "./hum.ts";
import type { Hum } from "./hum.ts";

// The toggle of the optional room hum (docs/design/plant_ui.md section 2, P8a): "Sound: off" until the reader presses it. The hum is hum.ts's; this makes it once for the route, turns the press into the
// toggle, gives it the first gesture of the page (for a visit that an earlier one left on) and closes its audio context when the route is left. Nothing on the floor depends on it.

const storageOf = (): Storage | null => {
  try {
    return window.localStorage;
  } catch {
    return null; // blocked storage: the choice is not kept
  }
};

export function HumControl() {
  const lang = useContext(LangContext);
  const hum = useRef<Hum | null>(null);
  if (hum.current === null && typeof AudioContext !== "undefined") hum.current = createHum(storageOf(), () => new AudioContext());
  const [on, setOn] = useState(hum.current?.isOn() ?? false);
  useEffect(() => {
    const h = hum.current;
    if (!h) return;
    const gesture = (): void => h.gesture();
    window.addEventListener("pointerdown", gesture);
    window.addEventListener("keydown", gesture);
    return () => {
      window.removeEventListener("pointerdown", gesture);
      window.removeEventListener("keydown", gesture);
      h.close();
    };
  }, []);
  if (!hum.current) return null; // a browser without Web Audio: nothing to turn on
  return (
    <button type="button" class="plant-hum" data-hum aria-pressed={on} title={text(lang, "plant.hum.hint")} onClick={() => setOn((hum.current as Hum).toggle())}>
      <T k={on ? "plant.hum.on" : "plant.hum.off"} />
    </button>
  );
}
