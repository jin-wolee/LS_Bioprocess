import { auditChange, bridgingOffset, holdContext, lotOffset } from "../../src/record/evidence.ts";
import { resultsAsOf } from "../../src/record/asof.ts";
import type { QualificationInput } from "../../src/record/types.ts";
import { BASE, byTime, calibration, draw, header, inoculation, sampleWithRun, visit } from "./cell_stream.ts";
import { inKey, ruleFlags } from "./cells.ts";
import type { CellRow } from "./cells.ts";

// Matrix rows 6 to 10 of spec section 5 as hand-built streams (test-only values); rows 1 to 5 are in cell_rows_a.ts. Rows 7, 8 and 10 have no
// injector type (the error sits in the values or the order of the stream by construction), so `realised` reads the stream or the record.

/**
 * Row 6, lost rerun or silent overwrite. S2 on U1 (drawn 2000): attempt 1 reads 3.2 and fails QC, attempt 2 reads 3.4. Where the rerun overwrites,
 * the first attempt is gone from the result rows; audit_trail keeps an audit event with the old and the new value.
 */
export const RERUN: CellRow = {
  events: byTime([
    ...BASE, inoculation("U1"), inoculation("U2"), ...sampleWithRun("S1", "U1", 1000, 500, 5.1),
    ...draw("S2", "U1", 2000, "OP-2"), ...visit({ request: "S2", queued: 2100, started: 2500, finished: 2800, value: 3.2, outcome: "qc_failed" }),
    ...visit({ request: "S2", attempt: 2, queued: 2800, started: 3500, finished: 3800, value: 3.4 }),
    ...sampleWithRun("S3", "U2", 3000, 500, 7.0),
  ]),
  forced: [],
  rules: {},
  realised: (out) => inKey(out, "lost_rerun", "S2"),
  evidence: (ds) => (auditChange(ds, "S2", "glucose") ? ["audit_event"] : []),
};

/**
 * Row 7, instrument effect between analyzers. AN-2 reads 0.5 high (the bias sits in its values). B1 and B2 are two aliquots of one control material (control
 * CTL-1, true value 4.0), B1 measured on AN-1 and B2 on AN-2; S1 and S2 are ordinary samples, one on each analyzer. No flag prevents an instrument effect.
 * The plan (not the event stream) names the control. 4.0, 4.5 and 0.5 are exact in binary, so the offset can be compared exactly. The evidence is a bridging
 * study: the control pair measured on both analyzers, told apart by the analyzer name.
 */
export const INSTRUMENT: CellRow = {
  events: byTime([
    header, inoculation("U1"), calibration("AN-1"), calibration("AN-2"),
    ...sampleWithRun("B1", "U1", 1000, 500, 4.0, { analyzer: "AN-1" }), ...sampleWithRun("B2", "U1", 1001, 500, 4.5, { analyzer: "AN-2" }),
    ...sampleWithRun("S1", "U1", 2000, 500, 5.0, { analyzer: "AN-1" }), ...sampleWithRun("S2", "U1", 3000, 500, 5.5, { analyzer: "AN-2" }),
  ]),
  forced: [],
  plan: { controls: { B1: "CTL-1", B2: "CTL-1" } },
  rules: {},
  realised: () => true,
  evidence: (ds) => (bridgingOffset(ds, "CTL-1") ? ["bridging_study"] : []),
};

/**
 * Row 7 again, instrument effect within one analyzer: a reagent lot step. AN-2 is calibrated with LOT-1 at 0 and with LOT-2 at 3000, and reads 0.5 high on
 * LOT-2 (the step sits in the values; the new lot is observable only through the second calibration record). B1 (drawn at 1000, run 1500) and B2 (drawn at
 * 3500, run 4000) are aliquots of control CTL-1 measured before and after the step. The effect is attributable only where the runs link to the instrument
 * state, which names the lot: the evidence is a control pair whose runs are linked to different lots.
 */
export const LOT: CellRow = {
  events: byTime([
    ...BASE, calibration("AN-2"), calibration("AN-2", 3000, "LOT-2"), inoculation("U1"), inoculation("U2"),
    ...sampleWithRun("B1", "U2", 1000, 500, 4.0, { analyzer: "AN-2" }), ...sampleWithRun("B2", "U2", 3500, 500, 4.5, { analyzer: "AN-2" }),
    ...sampleWithRun("S1", "U1", 4000, 500, 5.0, { analyzer: "AN-1" }), ...sampleWithRun("S2", "U2", 5000, 500, 6.0, { analyzer: "AN-2" }),
  ]),
  forced: [],
  plan: { controls: { B1: "CTL-1", B2: "CTL-1" } },
  rules: {},
  realised: () => true,
  evidence: (ds) => (lotOffset(ds, "CTL-1") ? ["lot_link"] : []),
};

/** The decision of row 8 is taken at this instant: after the first version of S1's result (1800) and before the correction (3300). */
export const DECISION_AT = 2500;

/**
 * Row 8, late correction leaking into an earlier decision. S1 reads 5.1 at 1800; a correction (a second version) reads 5.3 at 3300. A decision at
 * 2500 should still see 5.1. The error arises where an as-of read at 2500 returns the corrected 5.3; the evidence is an as-of read that returns
 * the pre-correction 5.1.
 */
export const LATE: CellRow = {
  events: byTime([
    ...BASE, inoculation("U1"), inoculation("U2"),
    ...draw("S1", "U1", 1000), ...visit({ request: "S1", queued: 1100, started: 1500, finished: 1800, value: 5.1 }),
    ...visit({ request: "S1", attempt: 2, queued: 2900, started: 3000, finished: 3300, value: 5.3 }),
    ...sampleWithRun("S2", "U1", 2000, 500, 3.2), ...sampleWithRun("S3", "U2", 3000, 500, 7.0),
  ]),
  forced: [],
  rules: {},
  realised: (_out, ds) => resultsAsOf(ds, DECISION_AT).some((r) => r.request_id === "S1" && r.analyte === "glucose" && r.value === 5.3),
  evidence: (ds) => (resultsAsOf(ds, DECISION_AT).some((r) => r.request_id === "S1" && r.value === 5.1) ? ["as_of_query"] : []),
};

const OPS = { operator: "OP-2" } as const;

/** Row 9, unattributable record. S2 is drawn by OP-2, the others by OP-1; both operators hold a qualification valid from 0. */
export const ATTRIB: CellRow = {
  events: byTime([...BASE, inoculation("U1"), inoculation("U2"), ...sampleWithRun("S1", "U1", 1000, 500, 5.1), ...sampleWithRun("S2", "U1", 2000, 500, 3.2, OPS), ...sampleWithRun("S3", "U2", 3000, 500, 7.0)]),
  forced: [],
  qualifications: [
    { qualification_id: "Q1", operator_id: "OP-1", qualified: true, valid_from: 0, valid_to: null },
    { qualification_id: "Q2", operator_id: "OP-2", qualified: true, valid_from: 0, valid_to: null },
  ],
  rules: {},
  realised: (out) => inKey(out, "unattributable_record", "S2"),
  evidence: (ds) => ruleFlags(ds, ["VR-015"], ["S2"]),
};

/** The qualification of OP-2 is valid only from 6000, so it does not cover the draw of S2 (2000): the check of VR-015, test-only. */
export const LATE_QUALIFICATION: QualificationInput[] = [
  { qualification_id: "Q1", operator_id: "OP-1", qualified: true, valid_from: 0, valid_to: null },
  { qualification_id: "Q2", operator_id: "OP-2", qualified: true, valid_from: 6000, valid_to: null },
];

/**
 * Row 10, sampling technique error (A064). S2's pH sample was drawn into an open container and waited 1000 s before its run (7.04 where the
 * culture read 7.00: the effect sits in the value). The plan records the container of every sample. Nothing prevents a technique error.
 */
export const TECHNIQUE: CellRow = {
  events: byTime([
    ...BASE, inoculation("U1"), inoculation("U2"),
    ...sampleWithRun("S1", "U1", 1000, 100, 7.0, { analyte: "ph" }), ...sampleWithRun("S2", "U1", 2000, 1000, 7.04, { analyte: "ph" }), ...sampleWithRun("S3", "U2", 3000, 100, 7.0, { analyte: "ph" }),
  ]),
  forced: [],
  plan: { containers: { S1: "closed", S2: "open", S3: "closed" } },
  rules: {},
  realised: () => true,
  evidence: (ds) => (holdContext(ds, "S2") ? ["container_hold"] : []),
};
