import { describe, expect, it } from "vitest";
import { FLAG_NAMES } from "../../src/record/architecture.ts";
import { resultsAsOf } from "../../src/record/asof.ts";
import { auditChange, bridgingOffset, holdContext, lotOffset } from "../../src/record/evidence.ts";
import { ATTRIB_CELLS, FEED_CELLS, FLAG_SHOWN_BY, LABEL_CELLS, LATE_CELLS, LOT_CELLS, REKEY_CELLS, REPLAY_CELLS, RERUN_CELLS } from "../support/cell_tables.ts";
import { CLOCK, FEED, LABEL, REKEY, REPLAY } from "../support/cell_rows_a.ts";
import { ATTRIB, DECISION_AT, INSTRUMENT, LATE, LATE_QUALIFICATION, LOT, RERUN, TECHNIQUE } from "../support/cell_rows_b.ts";
import { CONFIGS, CONFIG_NAMES, classify, ruleFlags, run } from "../support/cells.ts";
import type { CellRow } from "../support/cells.ts";

// S2c1: what sits inside the forced cells, typed by hand. Where one flag both prevents an error and is the only way to see it (feed in the gap and
// VR-010 on two_clocks; a replayed file and the idempotency log; a late correction and the as-of query; an unattributable record and VR-015 on
// audit_trail) no cell reads `detected`; the evidence is asserted here instead, so that a rule or a log that stopped working fails a test.

const config = (name: string) => (CONFIGS.find((c) => c.name === name) as (typeof CONFIGS)[number]).config;
const ON = (flag: string): string[] => CONFIGS.filter((c) => c.config.flags[flag as keyof typeof c.config.flags]).map((c) => c.name);
const OFF = (flag: string): string[] => CONFIG_NAMES.filter((n) => !ON(flag).includes(n));
const at = (row: CellRow, name: string) => run(row, config(name));

describe("Feed in the gap: the hold-time rule (VR-010) works wherever both clocks are stored", () => {
  // S1 waits 500 s (run start 1500, draw 1000), S2 and S3 wait 100 s; the limit is 300 s.
  it.each(ON("two_clocks"))("Given %s (two_clocks on) Then the mis-join is prevented and VR-010 holds S1's result and neither S2's nor S3's", (name) => {
    const { ds } = at(FEED, name);
    expect([ruleFlags(ds, ["VR-010"], ["S1"]), ruleFlags(ds, ["VR-010"], ["S2", "S3"])]).toEqual([["VR-010"], []]);
  });
  it.each(OFF("two_clocks"))("Given %s (one time stored) Then VR-010 is not evaluable and the reason names the missing sampled_at", (name) => {
    const { not_evaluable } = at(FEED, name);
    expect(not_evaluable.find((n) => n.rule === "VR-010")?.reason).toMatch(/sampled_at is not stored/);
  });
});

describe("Duplicate or replayed file: the idempotency log (a VR-008 information no-op) is the prevention", () => {
  it.each(ON("ingest_idempotency"))("Given %s Then S1 has one result row and the replay is logged once as a resolved VR-008 no-op", (name) => {
    const { ds } = at(REPLAY, name);
    expect(ds.result.filter((r) => r.request_id === "S1").length).toBe(1);
    expect(ds.validation_finding).toEqual([{ rule: "VR-008", target: "source_event:AN-1/S1/1/1/glucose", severity: "info", action: "no-op", status: "resolved" }]);
  });
  it.each(OFF("ingest_idempotency"))("Given %s Then S1 is counted twice (5.1 and 5.1) and no log shows it", (name) => {
    const { ds } = at(REPLAY, name);
    expect(ds.result.filter((r) => r.request_id === "S1").map((r) => r.value)).toEqual([5.1, 5.1]);
    expect(ds.validation_finding.filter((f) => f.rule === "VR-008")).toEqual([]);
  });
});

describe("Late correction: what an as-of read at the decision time (2500) returns for S1's glucose", () => {
  const read = (name: string) => resultsAsOf(at(LATE, name).ds, DECISION_AT).filter((r) => r.request_id === "S1" && r.analyte === "glucose").map((r) => r.value);
  it.each(["C", "C-system_issued_id", "C-two_clocks", "C-instrument_state_snapshot", "C-write_time_keys", "C-ingest_idempotency", "C-audit_trail"])(
    "Given %s (available_at and append_only_versions on) Then the read returns the pre-correction 5.1",
    (name) => expect(read(name)).toEqual([5.1]),
  );
  it("Given C minus append_only_versions Then the correction overwrote the row and its available_at, so the read at 2500 returns nothing: the earlier version no longer exists", () => {
    expect(read("C-append_only_versions")).toEqual([]);
  });
  it.each(["A", "B", "C-available_at"])("Given %s (available_at off) Then the read sees rows as of now and returns the corrected 5.3: the leak", (name) => {
    expect(read(name)).toEqual([5.3]);
  });
});

describe("Unattributable record: the qualification check (VR-015) works wherever audit_trail stores the operator", () => {
  // The qualification of OP-2 is valid from 6000; S2 is drawn at 2000 by OP-2, S1 and S3 by OP-1 (valid from 0).
  const flagged = (name: string) => {
    const { ds } = run(ATTRIB, config(name), { qualifications: LATE_QUALIFICATION });
    return ["S1", "S2", "S3"].filter((s) => ruleFlags(ds, ["VR-015"], [s]).length > 0);
  };
  it.each(ON("audit_trail"))("Given %s Then VR-015 holds S2 only", (name) => expect(flagged(name)).toEqual(["S2"]));
  it.each(OFF("audit_trail"))("Given %s Then VR-015 is not evaluable and nothing is flagged", (name) => {
    expect(flagged(name)).toEqual([]);
    expect(run(ATTRIB, config(name), { qualifications: LATE_QUALIFICATION }).not_evaluable.map((n) => n.rule)).toContain("VR-015");
  });
});

describe("Lost rerun: what the record keeps of S2's first attempt (3.2) and of the change", () => {
  const values = (name: string) => at(RERUN, name).ds.result.filter((r) => r.request_id === "S2").map((r) => r.value);
  it.each(ON("append_only_versions"))("Given %s Then both attempts are rows: 3.2 as version 1 and 3.4 as version 2", (name) => expect(values(name)).toEqual([3.2, 3.4]));
  it.each(OFF("append_only_versions"))("Given %s Then only 3.4 remains: the first attempt is gone from the result rows", (name) => expect(values(name)).toEqual([3.4]));
  it.each(["B", "C-append_only_versions"])("Given %s (audit_trail on, versions off) Then the audit event holds the old and the new value: 3.2 to 3.4, version 1 to 2", (name) => {
    expect(auditChange(at(RERUN, name).ds, "S2", "glucose")).toMatchObject({ request_id: "S2", analyte: "glucose", old_value: 3.2, new_value: 3.4, old_version: 1, new_version: 2 });
  });
  it("Given A (no audit_trail, no versions) Then no history of the change exists", () => {
    expect(auditChange(at(RERUN, "A").ds, "S2", "glucose")).toBeNull();
  });
});

describe("Instrument effect between analyzers: the bridging study recovers the offset exactly, whatever the architecture records of the instrument state", () => {
  it.each(CONFIG_NAMES)("Given %s Then the two requests of CTL-1 were measured on AN-1 and AN-2 (the analyzer name) and AN-2 reads exactly 0.5 above AN-1 (4.5 against 4.0)", (name) => {
    expect(bridgingOffset(at(INSTRUMENT, name).ds, "CTL-1")).toEqual({ control_id: "CTL-1", analyte: "glucose", reference_analyzer: "AN-1", other_analyzer: "AN-2", offset: 0.5 });
  });
  it("Given the stream and the plan Then the control_id pair and the analyzer name are stored in every architecture (no flag owns them)", () => {
    for (const name of CONFIG_NAMES) {
      const { ds } = at(INSTRUMENT, name);
      expect(ds.analysis_request.filter((r) => r.control_id === "CTL-1").map((r) => r.request_id), name).toEqual(["B1", "B2"]);
      expect(ds.run.filter((r) => r.request_id === "B2").map((r) => r.analyzer_name), name).toEqual(["AN-2"]);
    }
  });
});

describe("Instrument effect within an analyzer (reagent lot step on AN-2 at 3000): attributable only where the runs link to the instrument state", () => {
  it.each(ON("instrument_state_snapshot"))("Given %s Then B1 (run at 1500) is linked to LOT-1 and B2 (run at 4000) to LOT-2 of AN-2, and the lot step reads exactly 0.5", (name) => {
    expect(lotOffset(at(LOT, name).ds, "CTL-1")).toEqual({
      control_id: "CTL-1", analyte: "glucose", instrument_id: "AN-2", reference_state: "AN-2@0", other_state: "AN-2@3000", reference_lot: "LOT-1", other_lot: "LOT-2", offset: 0.5,
    });
  });
  it.each(OFF("instrument_state_snapshot"))("Given %s (no instrument-state link) Then the runs name no lot and the step cannot be attributed", (name) => {
    const { ds } = at(LOT, name);
    expect(ds.run.every((r) => r.instrument_state_id === null)).toBe(true);
    expect(lotOffset(ds, "CTL-1")).toBeNull();
  });
});

describe("Sampling technique error: the container and the hold time of S2", () => {
  it.each(ON("two_clocks"))("Given %s Then the open container and a hold of 1000 s (run start 3000, draw 2000) are both stored", (name) => {
    expect(holdContext(at(TECHNIQUE, name).ds, "S2")).toEqual({ container: "open", hold_time_s: 1000 });
  });
  it.each(OFF("two_clocks"))("Given %s Then the container is stored but no draw time, so the hold time is not: no context", (name) => {
    const { ds } = at(TECHNIQUE, name);
    expect(ds.sample.find((s) => s.sample_id === "S2")?.container).toBe("open");
    expect(holdContext(ds, "S2")).toBeNull();
  });
});

describe("Label error and clock error: what the records hold", () => {
  it("Given a mislabelled S2 in A Then its result sits under 'S2?', which matches no sample row (VR-009 and VR-014 have nothing to compare)", () => {
    const { ds } = at(LABEL, "A");
    expect(ds.result.map((r) => r.request_id)).toEqual(["S1", "S2?", "S3"]);
    expect(ds.sample.map((s) => s.sample_id)).toEqual(["S1", "S2", "S3"]);
  });
  it("Given AN-1 18000 s ahead in C Then measured_at is the wrong stamp (1800 + 18000) and ingested_at the true receipt time (1800): the offset is in the record", () => {
    const first = at(CLOCK, "C").ds.result[0];
    expect([first?.request_id, first?.measured_at, first?.ingested_at]).toEqual(["S1", 19800, 1800]);
  });
  it("Given A Then the same result has no ingested_at: there is no second stamp to compare", () => {
    expect(at(CLOCK, "A").ds.result[0]?.ingested_at).toBeNull();
  });
});

describe("Every flag changes at least one cell when it is ablated from C (a flag that changes none would be dead code)", () => {
  const TABLES: Record<string, readonly (string | null)[]> = {
    label_error: LABEL_CELLS, feed_in_gap: FEED_CELLS, unit_rekey: REKEY_CELLS, duplicate_replay: REPLAY_CELLS, lost_rerun: RERUN_CELLS,
    lot_effect: LOT_CELLS, late_correction: LATE_CELLS, unattributable_record: ATTRIB_CELLS,
  };
  const C = CONFIG_NAMES.indexOf("C");
  it.each(FLAG_NAMES)("Given the hand-typed tables Then C minus %s differs from C in the row that shows it", (flag) => {
    const table = TABLES[FLAG_SHOWN_BY[flag]] as readonly (string | null)[];
    expect(table[CONFIG_NAMES.indexOf(`C-${flag}`)]).not.toBe(table[C]);
  });
  it.each(FLAG_NAMES)("Given the recorders Then C minus %s differs from C in at least one cell of the rows run", (flag) => {
    const rows = [LABEL, FEED, REKEY, CLOCK, REPLAY, RERUN, INSTRUMENT, LOT, LATE, ATTRIB, TECHNIQUE];
    const changed = rows.filter((row) => classify(row, config(`C-${flag}`)) !== classify(row, config("C")));
    expect(changed.length, `${flag} changed no cell`).toBeGreaterThan(0);
  });
});
