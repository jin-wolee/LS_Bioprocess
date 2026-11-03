import { describe, expect, it } from "vitest";
import { CLOCK } from "./support/cell_rows_a.ts";
import { CLOCK_CELLS } from "./support/cell_tables.ts";
import { CONFIGS, classify, run } from "./support/cells.ts";

// SC6 Wrong clock (spec 7): what if one clock is wrong? One analyzer, AN-1, runs 5 h (18000 s) ahead (A049, S029, S030); it measures all three samples of the
// fixture. Structural relations only (docs/prompts/20 Step 4): the offset sits in the recorded stamps whatever the architecture, no flag prevents it, and
// what each architecture can see follows the forced-error cell table of the clock row (support/cell_tables.ts, typed by hand from the matrix and the
// rule catalogue). The VR-004 tolerance is 600 s (test-only). Author decision of 2026-10-29: every architecture that stores an ingestion stamp (all but A) detects the offset by VR-004, B and C minus two_clocks included.

describe("SC6 wrong clock", () => {
  it.each(CONFIGS.map((c) => c.name))("Given %s When AN-1 runs 18000 s ahead Then S1's result carries the wrong stamp: measured_at is 19800, the true 1800 plus 5 h", (name) => {
    const { ds } = run(CLOCK, (CONFIGS.find((c) => c.name === name) as (typeof CONFIGS)[number]).config);
    expect(ds.result.find((r) => r.request_id === "S1")?.measured_at).toBe(19800);
  });

  it.each(CONFIGS.map((c) => c.name))("Given %s Then all three clock errors are realised: no flag prevents a clock error", (name) => {
    const { out } = run(CLOCK, (CONFIGS.find((c) => c.name === name) as (typeof CONFIGS)[number]).config);
    expect(out.materialised.filter((m) => m.type === "clock_offset").map((m) => [m.sample_id, m.detail])).toEqual([
      ["S1", { analyzer: "AN-1", offset_s: 18000 }], ["S2", { analyzer: "AN-1", offset_s: 18000 }], ["S3", { analyzer: "AN-1", offset_s: 18000 }],
    ]);
  });

  it("Given an architecture that stores a row-creation stamp (B and C) Then ingested_at is the true receipt time 1800 beside the wrong measured_at 19800; A stores none", () => {
    const stamps = (name: string) => run(CLOCK, (CONFIGS.find((c) => c.name === name) as (typeof CONFIGS)[number]).config).ds.result.find((r) => r.request_id === "S1")?.ingested_at;
    expect(["A", "B", "C"].map(stamps)).toEqual([null, 1800, 1800]);
  });

  CONFIGS.forEach((c, i) => {
    const want = CLOCK_CELLS[i];
    it(`Given ${c.name} When AN-1 runs 5 h ahead Then ${want}, as the forced-error cell table says`, () => {
      expect(classify(CLOCK, c.config)).toBe(want);
    });
  });

  it("Given A, which has no ingested_at, Then VR-004 is not evaluable and the reason names the missing stamp", () => {
    const { not_evaluable } = run(CLOCK, (CONFIGS[0] as (typeof CONFIGS)[number]).config);
    expect(not_evaluable.find((n) => n.rule === "VR-004")?.reason).toMatch(/ingested_at is not stored/);
  });
});
