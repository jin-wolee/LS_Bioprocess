// The columns of the AI-ready export (data_model section 10): one row per sample x analyte x released version. The table schema of the data package is this list; the data
// dictionary (docs/design/data_dictionary.yaml, entity `export_result`) describes the same columns and a test compares the two, so a column cannot be added to one alone.
// Time columns are integer seconds of the scenario (the engine has no calendar before the raw layer); `ucum` is the UCUM code of the unit, `ucum_column` names the column
// that holds the code when it differs per row (the value of an analyte).

export type FieldType = "string" | "integer" | "number";

export interface ExportField {
  name: string;
  type: FieldType;
  /** A required column has a value on every row; the others are null where the architecture cannot know the value (data_model principle 7). */
  required: boolean;
  ucum?: string;
  ucum_column?: string;
}

export const SIGNALS = ["pH", "DO", "temperature"] as const;

const f = (name: string, type: FieldType, required: boolean, unit: { ucum?: string; ucum_column?: string } = {}): ExportField => ({ name, type, required, ...unit });
const s = { ucum: "s" };

export const EXPORT_FIELDS: readonly ExportField[] = [
  f("sample_id", "string", true), f("unit_id", "string", true), f("batch_id", "string", false), f("analyte", "string", true), f("version", "integer", true),
  f("value", "number", true, { ucum_column: "canonical_unit" }), f("canonical_unit", "string", true),
  f("sampled_at", "integer", false, s), f("measured_at", "integer", true, s), f("hold_time", "integer", false, s), f("turnaround", "integer", false, s),
  f("calibration_ref", "string", false), f("reagent_lot", "string", false), f("method_version", "string", false),
  f("operator_id", "string", false), f("qualification_id", "string", false),
  f("ctx_join_basis", "string", false), f("ctx_join_time", "integer", false, s), f("ctx_feed_epoch", "integer", false), f("ctx_batch_phase", "string", false),
  f("ctx_pv_pH", "number", false, { ucum: "[pH]" }), f("ctx_pv_DO", "number", false, { ucum: "%" }), f("ctx_pv_temperature", "number", false, { ucum: "Cel" }),
  f("available_at", "integer", false, s), f("context_as_of", "integer", true, s),
];

/**
 * The canonical UCUM unit of each analyte (data_model section 9, master data). The engine works in these units: they are the units of the profile settings that bound
 * each analyte (glucose and lactate g/L, glutamine mM = mmol/L, viable cell density 1e6 cells/mL = 10*6/mL, viability in percent, titer g/L, pH on its scale).
 * An analyte without an entry is an error: a conversion that is not defined is a finding, not a guess (data_model section 9).
 */
export const ANALYTE_UNITS: Readonly<Record<string, string>> = {
  vcd: "10*6/mL", viability: "%", glucose: "g/L", glutamine: "mmol/L", lactate: "g/L", titer: "g/L", ph: "[pH]",
};
