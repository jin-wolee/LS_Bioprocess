import type { RunSpec } from "../protocol.ts";

// The identity of a run for the lock of a challenge (docs/design/lab_ui.md section 4, rule 2): everything that makes the truth of a run except the architectures. The Worker holds it as `runKey` in
// engine/src/experiments/assembly/lab/challenges.ts; the page cannot import the engine, so this is a copy, and engine/tests/lab/run_key.test.ts keeps the two the same. The page uses it to empty what
// it holds of a run when a challenge starts on it (docs/design/plant_ui.md section 7, "As built in P5c").

export const runKeyOf = (spec: Pick<RunSpec, "scenario" | "settings" | "bay_profiles" | "analyzer_profiles" | "capture_path">, seed: number): string =>
  JSON.stringify([spec.scenario, Object.entries(spec.settings).sort(([a], [b]) => (a < b ? -1 : 1)), spec.bay_profiles ?? null, spec.analyzer_profiles ?? null, spec.capture_path ?? null, seed]);
