import { describe, expect, it } from "vitest";
import { en } from "./en.ts";
import { ko } from "./ko.ts";

// A2 (docs/design/lab_ui.md section 23; the audit of 2026-11-02, findings F8, F9 and F13 and the reading of the comparison; the author's decisions of the same day): the texts of the lab say what the
// code does and no more. The phrases are typed by hand from those decisions; the placeholders and the ids of each pair are held by i18n.test.ts.

const flat = (text: string): string => text.replace(/\s+/g, " ");

describe("the lab says what its comparison is", () => {
  it("Given the notes on the comparison Then A and B are zero by construction, the comparison is a constructive example, and it measures no real system", () => {
    const text = flat(en["notes.reading.construct"]);
    expect(text).toMatch(/zero by construction/);
    expect(text).toMatch(/constructive example/);
    expect(text).toMatch(/not a measure of the quality, the efficiency or the return of real spreadsheets or laboratory systems/);
  });

  it("Given the notes on the spread Then it is the variation of the inputs and not the uncertainty of the model, and the seed minimum is a threshold and no proof", () => {
    expect(en["notes.reading.spread"]).toMatch(/variation of operations and measurement that the inputs allow/);
    expect(en["notes.reading.spread"]).toMatch(/constants of the cell line do not change with the seed/);
    expect(en["notes.reading.spread"]).toMatch(/not the uncertainty of the model/);
    expect(en["notes.reading.seeds"]).toMatch(/threshold of the design/);
    expect(en["notes.reading.seeds"]).toMatch(/not a proof of statistical sufficiency/);
  });
});

describe("the lab says what the hold-time rule is", () => {
  it("Given the lead of the group in Results and the note Then the limit is a blood-gas proxy applied as an assumption to every analyte, and the figures are no real laboratory's accuracy", () => {
    for (const key of ["results.hold_limit.lead", "notes.hold.text"] as const) {
      const text = flat(en[key]);
      expect(text, key).toMatch(/proxy taken from blood-gas handling and applied, as an assumption, to every analyte/);
      expect(text, key).toMatch(/not the accuracy of a real laboratory/);
    }
    expect(flat(en["results.hold_limit.lead"])).toMatch(/how many requests the rule rejected, and what exact reconstruction and availability would be if those were not counted as failures/);
  });

  it("Given a record that stores no hold time Then the group says the rule cannot run on it", () => {
    expect(en["results.hold_limit.cannot"]).toMatch(/stores no hold time, so the rule cannot run/);
  });

  it("Given the three metric names Then each names the rule or the lifted limit, and both languages have them", () => {
    for (const metric of ["rejected", "exact_reconstruction_limit_lifted", "availability_limit_lifted"]) {
      const key = `metric.hold_limit.${metric}` as keyof typeof en;
      expect(en[key]).toMatch(/hold-time/i);
      expect(ko[key]).toMatch(/보관 시간/);
    }
  });
});

describe("the lab says what the audit trail, the labels and the Break-out screen are", () => {
  it("Given the audit trail Then it keeps what changed and when and the operator of the draw, and neither the text of the flag nor the notes claim who changed a result or why", () => {
    expect(en["flag.audit_trail.on"]).not.toMatch(/\bwho\b/i);
    expect(en["flag.audit_trail.on"]).toMatch(/what changed and when/);
    expect(en["notes.audit.trail"]).toMatch(/the old and the new value, the version and the time/);
    expect(en["notes.audit.trail"]).toMatch(/does not keep who changed a result or why/);
    expect(ko["flag.audit_trail.on"]).not.toMatch(/누가/);
  });

  it("Given the label note Then the modelled label error is a typed or written id and a correct barcode on the wrong tube is not modelled", () => {
    expect(en["notes.audit.label"]).toMatch(/an id typed or written by hand/);
    expect(en["notes.audit.label"]).toMatch(/barcode stuck on the wrong tube is not modelled/);
  });

  it("Given the Break-out screen Then a hold is a state of the record, containment is the effect of tracking and holding, and a confirming test is coverage and no sensitivity", () => {
    for (const key of ["notes.breakout.hold", "breakout.reading"] as const) expect(en[key], key).toMatch(/hold is a state of the record/);
    expect(en["notes.breakout.hold"]).toMatch(/effect of tracking and holding on the record, not of a control of the culture or of how a contamination spreads/);
    expect(en["breakout.reading"]).toMatch(/confirming test is judged by coverage, not by a sensitivity/);
    expect(en["notes.breakout.tests"]).toMatch(/judged by coverage, not by a sensitivity/);
  });

  it("Given the utilisation lead Then the staffed time is the roster's hours summed over the days and the time after QC and maintenance is not taken off", () => {
    const text = flat(en["util.lead"]);
    expect(text).toMatch(/hours the roster staffs on each day of the run, summed/);
    expect(text).toMatch(/time after quality control and maintenance is not taken off/);
  });
});
