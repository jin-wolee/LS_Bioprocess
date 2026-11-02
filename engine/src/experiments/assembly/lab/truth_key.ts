import type { Event } from "../../../generated/event.schema";
import { hashString } from "../../../rng.ts";
import { runScenario } from "../../../run.ts";
import { canonicalJsonl } from "../../../trace.ts";
import { scenarioConfig } from "./setup.ts";
import type { LabData } from "./setup.ts";
import type { RunSpec } from "./spec.ts";

// The identity of the truth of a run, for the lock of a challenge (docs/design/lab_ui.md section 4, rule 2; audit A1, finding F7 and its rework of 2026-11-02): a request is locked when
// its run, with its actions stripped, has the truth of an open challenge's run. So the key is made from the truth itself and not from the spec as written: the 64-bit hash (the engine's
// synchronous string hash, rng.ts) of the canonical truth log of the run its spec and seed make. A setting the run does not read (a capture path, the staggered windows under the burst
// plan) leaves the key as it is, and a setting it reads moves it; nothing about the spec can be in the key without being in the truth. A hash that two different truths shared would only
// lock more, never less.

/** The key of a truth log. */
export const truthKeyOf = (events: readonly Event[]): string => hashString(canonicalJsonl(events)).toString(16).padStart(16, "0");

/** The key of the truth run a spec and a seed make, without any operator action (the caller has checked the spec; the engine's exception reaches the caller). */
export const truthKey = (data: LabData, spec: RunSpec, seed: number): string =>
  truthKeyOf(runScenario(scenarioConfig(data, spec.scenario, spec.settings, seed, {
    ...(spec.bay_profiles && { bay_profiles: spec.bay_profiles }),
    ...(spec.analyzer_profiles && { analyzer_profiles: spec.analyzer_profiles }),
    ...(spec.capture_path && { capture_path: spec.capture_path }),
  })).events);
