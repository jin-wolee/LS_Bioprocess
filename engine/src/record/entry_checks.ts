// The checks of VR-005 and VR-006 as pure functions (data_model section 8), shared by the parser (ingest stage, RQ7) and the recorder-stage rules on a typed entry
// (manual_transcription). A check answers yes or no; the caller turns a no into a state. They read no truth and no key.

/** The definitional bound of a value: no negative amount, a percent between 0 and 100, a pH on its scale (0 to 14). These are the meaning of the quantity, not domain parameters. */
export type Physical = "non_negative" | "percent" | "ph_scale";

/** VR-006: is the value physically possible for the analyte? */
export const physicallyPossible = (kind: Physical, value: number): boolean => {
  if (!Number.isFinite(value) || value < 0) return false;
  return kind === "percent" ? value <= 100 : kind === "ph_scale" ? value <= 14 : true;
};

/** VR-005: does the unit have the dimension the method expects for the analyte? */
export const dimensionMatches = (expected: string, actual: string): boolean => expected === actual;
