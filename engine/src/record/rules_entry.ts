import { dimensionMatches, physicallyPossible } from "./entry_checks.ts";
import type { Rule } from "./rule_types.ts";
import type { RecordedDataset, ResultRow } from "./types.ts";

// The rules on a typed entry: VR-005, VR-006 and VR-013 (data_model section 8; spec section 5, rule table row "(manual)"). They read the unit, the value and the dilution factor
// of a row that a person typed (`capture_path` manual_transcription), and are therefore run only on that path; on adapter_ingest the parser applies VR-005 and VR-006 to the
// file at the ingest stage. A rule changes a state and never a value.

const NEEDS = (what: string): Rule["unmet"] => (_ds, cfg) => (cfg.entry === undefined ? `${what} is not configured (the method's units, bounds and dilution rule)` : null);
const typed = (ds: RecordedDataset): ResultRow[] => ds.result.filter((r) => r.capture_path === "manual_transcription");

export const ENTRY_RULES: Rule[] = [
  {
    id: "VR-005", severity: "error", action: "quarantine",
    unmet: NEEDS("the unit rule"),
    check: (ds, cfg) =>
      typed(ds).filter((r) => {
        const expected = cfg.entry?.analytes[r.analyte]?.dimension;
        const actual = r.unit_ucum === null || r.unit_ucum === undefined ? undefined : cfg.entry?.dimension_of[r.unit_ucum];
        return expected !== undefined && (actual === undefined || !dimensionMatches(expected, actual));
      }).map((r) => `result:${r.result_id}`),
  },
  {
    id: "VR-006", severity: "error", action: "quarantine",
    unmet: NEEDS("the range rule"),
    check: (ds, cfg) => typed(ds).filter((r) => { const a = cfg.entry?.analytes[r.analyte]; return a !== undefined && !physicallyPossible(a.physical, r.value); }).map((r) => `result:${r.result_id}`),
  },
  {
    id: "VR-013", severity: "warning", action: "hold",
    unmet: NEEDS("the dilution rule"),
    check: (ds, cfg) =>
      typed(ds).filter((r) => cfg.entry?.dilution.analytes.includes(r.analyte) === true && (r.dilution_factor === null || r.dilution_factor === undefined || !cfg.entry.dilution.factors.includes(r.dilution_factor))).map((r) => `result:${r.result_id}`),
  },
];
