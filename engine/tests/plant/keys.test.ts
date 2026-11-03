import { describe, expect, it } from "vitest";
import { ACTION_DRAWS, applyActions } from "../../src/experiments/assembly/lab/actions.ts";
import type { Action } from "../../src/experiments/assembly/lab/actions.ts";
import { scenarioDocument } from "../../src/experiments/assembly/lab/setup.ts";
import { parseArchitecture } from "../../src/record/architecture.ts";
import { canonicalKey, streamSeed } from "../../src/rng.ts";
import type { StreamKey } from "../../src/rng.ts";
import { runScenario } from "../../src/run.ts";
import { loadScenario } from "../../src/scenario.ts";
import { labData } from "../support/lab_data.ts";
import { readJson } from "../support/paths.ts";
import { SMALL, configOf, lookup } from "../support/scenarios.ts";

// P2 (docs/design/plant_ui.md section 5.4): an action adds no random draw of its own. Run the small default scenario with one action of every kind that touches the truth run and enumerate the
// streams it asks for, as the collision test of the contract does: none has a purpose of the form operator:<kind>, none is asked for twice, no two keys share a stream seed, and the acted run
// asks for no purpose the base run does not (the list of action keys, ACTION_DRAWS, is empty for that reason).

const data = labData();
const ALL: Action[] = [
  { kind: "add_feed", at: 291600, unit_id: "U03" },
  { kind: "raise_alarm", at: 295200, unit_id: "U05" },
  { kind: "move_draw", at: 291600, sample_id: "U03-D03-1", to: 297000 },
  { kind: "analyzer_down", at: 291600, analyzer: "AN-1", from: 306000, length_min: 120 },
  { kind: "change_lot", at: 291600, analyzer: "AN-2", effective: 345600 },
  { kind: "set_labelling", at: 291600, method: "preprinted_barcode" },
];

const keysOf = (cfg: ReturnType<typeof configOf>): StreamKey[] => {
  const keys: StreamKey[] = [];
  runScenario({ ...cfg, seed: 1 }, { onKey: (k) => keys.push(k as StreamKey) });
  return keys;
};

describe("The action keys (section 5.4)", () => {
  const base = keysOf(configOf("default", { settings: SMALL }));
  const doc = applyActions({ scenario: scenarioDocument(data, "default", SMALL), capture_path: undefined, architectures: ["a_manual"].map((id) => parseArchitecture(readJson("data", "scenarios", "architectures", `${id}.json`))) }, ALL).scenario;
  const acted = keysOf({ ...loadScenario(doc, lookup), seed: 1 });

  it("Given the table of action keys Then it is empty: no action takes a draw of its own", () => {
    expect(ACTION_DRAWS).toEqual([]);
  });

  it("Given a run with every action Then it asks for streams (the enumeration saw the run), none has an operator purpose, and none is asked for twice", () => {
    expect(acted.length).toBeGreaterThan(400);
    expect(acted.filter((k) => k[4].startsWith("operator:"))).toEqual([]);
    const names = new Set(acted.map(canonicalKey));
    expect(names.size).toBe(acted.length);
  });

  it("Given the keys of the acted run Then no two hash to one 64-bit stream seed", () => {
    expect(new Set(acted.map(streamSeed)).size).toBe(acted.length);
  });

  it("Given the purposes of the acted run Then each is a purpose of the base run", () => {
    const purposes = (keys: StreamKey[]) => new Set(keys.map((k) => k[4]));
    expect([...purposes(acted)].filter((p) => !purposes(base).has(p))).toEqual([]);
  });

  it("Given the moved draw Then the sampling and logistics keys of its sample (plan, delay, transport, operator) are the same tuples as in the base run", () => {
    const own = (keys: StreamKey[]) => keys.filter((k) => k[1] === "U03-D03-1" && ["plan", "delay", "transport", "operator"].includes(k[4])).map(canonicalKey).sort();
    expect(own(acted)).toEqual(own(base));
    expect(own(acted)).toHaveLength(4);
  });
});
