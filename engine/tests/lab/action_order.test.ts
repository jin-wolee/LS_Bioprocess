import { describe, expect, it } from "vitest";
import { canonicalOrder, isLabSetting } from "../../../src/plant/action_list.ts";
import { ACTION_CLASS, canonicalActions } from "../../src/experiments/assembly/lab/actions.ts";
import type { Action } from "../../src/experiments/assembly/lab/actions.ts";
import { listFiles, readJson } from "../support/paths.ts";

// P6a (docs/design/plant_ui.md section 5.5, "As built in P6a"): the page lists the reader's actions in the canonical order of the Worker, and cannot import the engine, so its order is a copy of
// `canonicalActions`; this test keeps the two the same, for the actions of every hand fixture, for every order of entry of the three of three_together, and for all the fixtures' actions at once in
// orders made by a fixed generator (no Math.random: invariant 2). It also keeps the page's idea of a lab setting the engine's.

const fixtures = listFiles("tests", "fixtures", "plant").filter((n) => n.endsWith(".json")).map((n) => readJson<{ actions: Action[] }>("tests", "fixtures", "plant", n).actions);
const every = fixtures.flat();
const engine = (list: Action[]): Action[] => canonicalActions(list).map((n) => n.action);

/** A fixed shuffle: a linear congruential generator and Fisher-Yates. */
const shuffled = (list: readonly Action[], seed: number): Action[] => {
  const out = [...list];
  let s = seed;
  for (let i = out.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j] as Action, out[i] as Action];
  }
  return out;
};

describe("the page's canonical order is the Worker's", () => {
  it.each(fixtures.map((f, i) => [i, f] as const))("Given the actions of fixture %i Then both orders are the same", (_i, actions) => {
    expect(canonicalOrder(actions)).toEqual(engine(actions));
  });

  it("Given the three actions of three_together in each of the six orders of entry Then both orders are the same list", () => {
    const three = fixtures.find((f) => f.length === 3) as Action[];
    for (const p of [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]) {
      const entered = p.map((i) => three[i] as Action);
      expect(canonicalOrder(entered)).toEqual(engine(entered));
    }
  });

  it("Given the actions of all the fixtures at once (plant actions and lab settings, one instant and one target in common) in ten orders Then both orders are the same", () => {
    expect(every.length).toBeGreaterThanOrEqual(12);
    for (let seed = 1; seed <= 10; seed++) {
      const entered = shuffled(every, seed);
      expect(canonicalOrder(entered)).toEqual(engine(entered));
    }
  });

  it("Given each kind of action Then the page and the engine agree on whether it is a lab setting", () => {
    for (const a of every) expect(isLabSetting(a), a.kind).toBe(ACTION_CLASS[a.kind] === "lab");
  });
});
