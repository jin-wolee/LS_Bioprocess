import type { Event } from "../../src/generated/event.schema";
import { runScenario } from "../../src/run.ts";
import type { RunOptions, ScenarioRun } from "../../src/run.ts";
import { loadScenario } from "../../src/scenario.ts";
import type { ScenarioConfig } from "../../src/scenario.ts";
import { readJson } from "../support/paths.ts";
import { lookup, patched, rawScenario } from "../support/scenarios.ts";
import type { Json } from "../support/schemas.ts";

// Test side of the break-out truth batch (spec 11.8.4, 11.8.5 row 2). The scenarios here are the layouts of FX12a and FX12e written as data: three reactors in one bay, all inoculated
// at 0 h (the fixtures count hours from the inoculation), the default scenario otherwise. Every value typed below is a test design choice or comes from the fixture text; none is read from the engine.

export const breakoutProfile = (id: string): unknown => readJson("scenarios", "profiles", "breakout", `${id}.json`);

export const q = (value: number, unit: string, ref: string): Json => ({ value, unit, ref });
/** An instant or a delay in hours. The ref is A177 for the topology, A176 for the response delays and A157 for an event instant the scenario chooses. */
export const h = (value: number, ref = "A177"): Json => q(value, "h", ref);

/** Three reactors in one bay, all inoculated at 0 h (the first reactor of the fixtures is U01). */
export const THREE: Record<string, number> = { reactor_count: 3, bay_size: 3, cohort_size: 3, inoculation_start_min: 0, inoculation_step_min: 0 };

export const docOf = (block?: Json, settings: Record<string, number> = {}, fields: Json = {}): Json =>
  patched(rawScenario("default"), { settings: { ...THREE, ...settings }, fields: { ...(block ? { breakout: block } : {}), ...fields } });

export const configOf = (doc: Json): ScenarioConfig => loadScenario(doc, lookup);
export const runOfDoc = (doc: Json, opts?: RunOptions): ScenarioRun => runScenario(configOf(doc), opts);

export const eventsOf = <T extends Event["type"]>(run: ScenarioRun, type: T): Extract<Event, { type: T }>[] =>
  run.events.filter((e): e is Extract<Event, { type: T }> => e.type === type);
/** The process events of one kind, as [unit, instant, item] triples in log order (the item is the lot or equipment id, or "-"). */
export const processOf = (run: ScenarioRun, kind: string): [string, number, string][] =>
  eventsOf(run, "process_event").filter((e) => e.kind === kind).map((e) => [e.unit_id, e.t, e.lot_id ?? e.equipment_id ?? "-"]);

const seed = (lot_id: string): Json => ({ lot_id, kind: "seed", prepared_at: h(0) });
const medium = (lot_id: string): Json => ({ lot_id, kind: "medium", prepared_at: h(0) });
const RESPONSE: Json = { signal_to_response: h(2, "A176"), positive_to_hold: h(4, "A176") };
/** The bioburden volume has no ledger number; 2 mL is a test design choice. */
const INPUTS: Json = { bioburden_sample_volume_ml: q(2, "mL", "A225") };

/** FX12a: U01 is contaminated through the medium lot ML-2 (contaminated from 0 h, used by U01 at 5 h); U02 shares the clean ML-1 with U01; confirm U01 and U02. */
export const fx12a = (): Json => ({
  profile: "bacterial",
  origin: { kind: "medium_lot", lot_id: "ML-2", contaminated_at: h(0, "A157") },
  topology: {
    lots: [seed("SL-1"), seed("SL-2"), seed("SL-3"), medium("ML-1"), medium("ML-2"), medium("ML-3")],
    consumption: [
      { unit_id: "U01", lot_id: "SL-1" }, { unit_id: "U02", lot_id: "SL-2" }, { unit_id: "U03", lot_id: "SL-3" },
      { unit_id: "U01", lot_id: "ML-1", at: h(1) }, { unit_id: "U02", lot_id: "ML-1", at: h(1) }, { unit_id: "U03", lot_id: "ML-3", at: h(1) },
      { unit_id: "U01", lot_id: "ML-2", at: h(5) },
    ],
  },
  response: structuredClone(RESPONSE),
  confirm: ["U01", "U02"],
  inputs: structuredClone(INPUTS),
});

/** FX12e: the transfer line TL-1 is contaminated from 0 h and used by U01 at 5 h and by U02 at 9 h; U03 does not use it; confirm U01 and U02. */
export const fx12e = (): Json => ({
  profile: "bacterial",
  origin: { kind: "shared_equipment", equipment_id: "TL-1", contaminated_at: h(0, "A157") },
  topology: {
    lots: [seed("SL-1"), seed("SL-2"), seed("SL-3"), medium("ML-1"), medium("ML-2"), medium("ML-3")],
    equipment: [{ equipment_id: "TL-1", name: "Shared transfer line" }],
    consumption: [
      { unit_id: "U01", lot_id: "SL-1" }, { unit_id: "U02", lot_id: "SL-2" }, { unit_id: "U03", lot_id: "SL-3" },
      { unit_id: "U01", lot_id: "ML-1", at: h(1) }, { unit_id: "U02", lot_id: "ML-2", at: h(1) }, { unit_id: "U03", lot_id: "ML-3", at: h(1) },
    ],
    use: [{ unit_id: "U01", equipment_id: "TL-1", at: h(5) }, { unit_id: "U02", equipment_id: "TL-1", at: h(9) }],
  },
  response: structuredClone(RESPONSE),
  confirm: ["U01", "U02"],
  inputs: structuredClone(INPUTS),
});

/** A deep copy of a block with one path changed: `set(block, "response.signal_to_response", undefined)` removes the key. */
export const set = (block: Json, path: string, value: unknown): Json => {
  const copy = structuredClone(block);
  const keys = path.split(".");
  const last = keys.pop() as string;
  let node = copy as Record<string, unknown>;
  for (const k of keys) node = node[k] as Record<string, unknown>;
  if (value === undefined) delete node[last];
  else node[last] = value;
  return copy;
};

/** Seconds from hours, the way the fixtures count. */
export const H = (hours: number): number => Math.round(hours * 3600);
