export type CapturePath = "manual_transcription" | "adapter_ingest";

export interface RunSpec {
  schema_version: "1";
  scenario: string;
  /** Replaces only the `value` of named scenario settings; unit and ref stay. */
  settings: Record<string, number>;
  /** One bioreactor profile id per bay, bay 1 first (spec section 4.5.2); absent: every bay takes the scenario's own. */
  bay_profiles?: string[];
  /** One analyzer profile id per analyzer, analyzer 1 first; absent: every analyzer takes the scenario's own. */
  analyzer_profiles?: string[];
  /** Overrides the capture path of every preset and turns the raw layer on. */
  capture_path?: CapturePath;
  architectures: string[];
  seeds: number[];
}
