import { runScenario } from "../../../run.ts";
import type { RunSpec } from "./spec.ts";
import { scenarioConfig } from "./setup.ts";
import type { LabData } from "./setup.ts";

// The `run` request in its Home form (docs/design/lab_ui.md sections 3 and 4): one seed and no architectures return the count of events by type of one run of the
// scenario, as tests/golden/*.summary.json states it. Only the counts leave this function; the truth log stays here (spec section 3, rule 2).

export interface RunSummary {
  events: number;
  event_counts: Record<string, number>;
}

export type HomeRun = { ok: true; summary: RunSummary } | { ok: false; message: string };

export const summaryOf = (events: readonly { type: string }[]): RunSummary => {
  const event_counts: Record<string, number> = {};
  for (const e of events) event_counts[e.type] = (event_counts[e.type] ?? 0) + 1;
  return { events: events.length, event_counts };
};

/** The Home form of a checked spec: no architecture, one seed. A scenario that fails the engine's own validation throws with the engine's English message; the caller reports it as an engine error. */
export const homeRun = (data: LabData, spec: RunSpec): HomeRun => {
  const [seed] = spec.seeds;
  if (seed === undefined || spec.seeds.length !== 1) return { ok: false, message: "a run with no architecture counts the events of one run, so it takes exactly one seed" };
  const cfg = scenarioConfig(data, spec.scenario, spec.settings, seed, { ...(spec.bay_profiles && { bay_profiles: spec.bay_profiles }), ...(spec.analyzer_profiles && { analyzer_profiles: spec.analyzer_profiles }) });
  return { ok: true, summary: summaryOf(runScenario(cfg).events) };
};
