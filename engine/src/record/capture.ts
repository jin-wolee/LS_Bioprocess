import type { CapturePath } from "../raw/types.ts";
import type { Architecture } from "./architecture.ts";

// The capture path of an architecture (spec section 5, "Capture path"; ADR-0014): a setting beside the labelling method, never a ninth flag. The preset carries the default
// (A manual_transcription, B and C adapter_ingest); a scenario may override it for every architecture it runs. It is read only with the raw layer on.

export const resolveCapturePath = (architecture: Pick<Architecture, "id" | "capture_path">, scenarioOverride?: CapturePath): CapturePath => {
  const path = scenarioOverride ?? architecture.capture_path;
  if (path === undefined) throw new Error(`architecture ${architecture.id}: the raw layer is on, and neither the preset nor the scenario names a capture_path`);
  return path;
};
