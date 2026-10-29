import { BASE, byTime, feed, inoculation, sampleWithRun } from "./cell_stream.ts";
import { inKey, ruleFlags } from "./cells.ts";
import type { CellRow } from "./cells.ts";

// Matrix rows 1 to 5 of spec section 5 as hand-built streams (test-only values). Each has three samples, one error, and the evidence that
// can show it. Rows 6 to 10 are in cell_rows_b.ts; the expected cells of every row are typed by hand in cell_tables.ts.

/**
 * Row 1, label or transcription error. U1 and U2 run from t = 0. S1 on U1 is drawn at 1000, S2 on U1 at 2000 (by OP-2), S3 on U2 at 3000; all on AN-1.
 * Forced: the sample-id text of S2 is wrong at the analyzer and reads "S2?", an id that matches no request. VR-009 needs two samples of one unit
 * with the same draw instant and analyte; here no two samples share one, so it has nothing to say (data_model section 8).
 */
export const LABEL: CellRow = {
  events: byTime([...BASE, inoculation("U1"), inoculation("U2"), ...sampleWithRun("S1", "U1", 1000, 500, 5.1), ...sampleWithRun("S2", "U1", 2000, 500, 3.2, { operator: "OP-2" }), ...sampleWithRun("S3", "U2", 3000, 500, 7.0)]),
  forced: [{ type: "label_error", sample_id: "S2", detail: { as_id: "S2?" } }],
  rules: {},
  realised: (out) => inKey(out, "label_error", "S2"),
  evidence: (ds) => ruleFlags(ds, ["VR-009", "VR-014"], ["S2", "S2?"]),
};

/**
 * Row 2, feed in the gap. A feed on U1 at 1300 falls between the draw of S1 (1000) and its measurement (1800). S1's hold_time is 500 s (run start 1500);
 * S2 (U1, drawn 2000) and S3 (U2, drawn 3000) wait 100 s and have no feed in their gap. The hold limit is 300 s (test-only).
 */
export const FEED: CellRow = {
  events: byTime([...BASE, inoculation("U1"), inoculation("U2"), feed("U1", 1300), ...sampleWithRun("S1", "U1", 1000, 500, 5.1), ...sampleWithRun("S2", "U1", 2000, 100, 3.2), ...sampleWithRun("S3", "U2", 3000, 100, 7.0)]),
  forced: [],
  rules: { hold_limit_s: 300 },
  realised: (out) => inKey(out, "feed_in_gap", "S1"),
  evidence: (ds) => ruleFlags(ds, ["VR-010"], ["S1"]),
};

const REKEY_EVENTS = byTime([
  ...BASE, inoculation("U1"), inoculation("U2"), inoculation("U3", 5000),
  ...sampleWithRun("S1", "U1", 1000, 500, 5.1), ...sampleWithRun("S2", "U2", 2000, 500, 3.2), ...sampleWithRun("S3", "U1", 3000, 500, 7.0),
]);

/**
 * Row 3, unit re-keyed after write. U1 and U2 are open from 0, U3 is inoculated only at 5000. Forced: the label of S1 (drawn at 1000 on U1) names U3,
 * a unit with no open batch at that instant: the gross case that VR-020 can see.
 */
export const REKEY: CellRow = {
  events: REKEY_EVENTS,
  forced: [{ type: "unit_rekey", sample_id: "S1", detail: { to_unit: "U3" } }],
  rules: {},
  realised: (out) => inKey(out, "unit_rekey", "S1"),
  evidence: (ds) => ruleFlags(ds, ["VR-020"], ["S1"]),
};

/** The same stream, but S1's label names U2, which has an open batch at 1000: the matrix says such a mis-key passes (spec section 5, rule table). */
export const REKEY_OPEN: CellRow = { ...REKEY, forced: [{ type: "unit_rekey", sample_id: "S1", detail: { to_unit: "U2" } }] };

/**
 * Row 4, clock error (A049, +5 h = 18000 s). AN-1 runs ahead and measures all three samples; the host receives each result at the true stamp. The VR-004
 * tolerance is 600 s (test-only); the tolerance of VR-003 is not set, so only the rule the matrix names can run.
 */
export const CLOCK: CellRow = {
  events: byTime([...BASE, inoculation("U1"), inoculation("U2"), ...sampleWithRun("S1", "U1", 1000, 500, 5.1), ...sampleWithRun("S2", "U1", 2000, 500, 3.2), ...sampleWithRun("S3", "U2", 3000, 500, 7.0)]),
  forced: [],
  clock_offsets: { "AN-1": 18000 },
  rules: { clock_tolerance_s: 600 },
  realised: (out) => inKey(out, "clock_offset", "S1"),
  evidence: (ds) => ruleFlags(ds, ["VR-003", "VR-004"], ["S1"]),
};

/** Row 5, duplicate or replayed file. Forced: the result file of S1 is sent twice (a source event, present in every architecture). */
export const REPLAY: CellRow = {
  events: byTime([...BASE, inoculation("U1"), inoculation("U2"), ...sampleWithRun("S1", "U1", 1000, 500, 5.1), ...sampleWithRun("S2", "U1", 2000, 500, 3.2), ...sampleWithRun("S3", "U2", 3000, 500, 7.0)]),
  forced: [{ type: "duplicate_replay", sample_id: "S1" }],
  rules: {},
  realised: (out) => inKey(out, "duplicate_replay", "S1"),
  evidence: (ds) => ruleFlags(ds, ["VR-008b"], ["S1"]),
};
