import { describe, expect, it } from "vitest";
import { inject } from "../../src/inject/inject.ts";
import { RATE_GAPS, labelErrorRate } from "../../src/inject/rates.ts";
import { loadProfile } from "../../src/profiles.ts";
import { arch } from "../support/record_fixture.ts";
import { BASE, byTime, sampleWithRun } from "../support/cell_stream.ts";
import { bulk } from "../support/inject_fixture.ts";
import { lookup } from "../support/scenarios.ts";

// S2b Step 2: rates come from the staff profile (ledger refs), never from the injector. The staff profile multiplies the label rate:
// experienced 6.1 per 1000 (A047); trainee the same base times 2.0 (A062). Hand arithmetic: 6.1 / 1000 = 0.0061; 0.0061 x 2 = 0.0122.

const staff = (id: string) => loadProfile(lookup("staff", id), "staff").params;

describe("Staff multipliers on the label-error rate", () => {
  it("Given the experienced profile Then the rate is 0.0061 per sample", () => {
    expect(labelErrorRate(staff("experienced"))).toBeCloseTo(0.0061, 12);
  });
  it("Given the trainee profile Then the rate is 0.0122, twice the experienced one (A062)", () => {
    expect(labelErrorRate(staff("trainee"))).toBeCloseTo(0.0122, 12);
  });
  it("Given a profile whose unit is not 'per 1000' Then reading it fails loudly", () => {
    const bad = { ...staff("experienced"), label_error_per_1000: { value: 6.1, unit: "per 100", ref: "A047" } };
    expect(() => labelErrorRate(bad)).toThrow(/unit/);
  });
  it("Given two operators with different rates Then each operator's samples use that operator's rate: a rate of 1 takes the even-numbered samples (drawn by OP-2) only", () => {
    const events = bulk(40, ["OP-1", "OP-2"]); // OP-1 draws S1, S3, ...; OP-2 draws S2, S4, ...
    const out = inject({ seed: 7, architecture: { id: "t", flags: arch().flags }, events, label_rate_by_operator: { "OP-1": 0, "OP-2": 1 } });
    expect(out.materialised.filter((m) => m.type === "label_error").map((m) => m.sample_id)).toEqual(Array.from({ length: 20 }, (_, i) => `S${2 * i + 2}`));
  });
  it("Given an operator with no rate Then the injector refuses rather than assume zero", () => {
    expect(() => inject({ seed: 7, architecture: { id: "t", flags: arch().flags }, events: bulk(3, ["OP-9"]), label_rate_by_operator: { "OP-1": 0.1 } })).toThrow(/OP-9/);
  });
});

describe("Types without a ledger rate are not modelled in production", () => {
  const measured = byTime([...BASE, ...sampleWithRun("S1", "U1", 1000, 500, 5.1)]); // one sample measured on AN-1 (test-only values)
  it("Given a production run (no forced list, no clock offset named) Then unit re-keys, clock errors and replayed files are reported as not modelled, never given a number", () => {
    const out = inject({ seed: 7, architecture: { id: "t", flags: arch().flags }, events: bulk(50), label_rate_by_operator: { "OP-1": 1 } });
    expect(out.not_modelled).toEqual(["unit_rekey", "clock_offset", "duplicate_replay"]); // the order of the hypothesis matrix
    for (const t of ["unit_rekey", "clock_offset", "duplicate_replay"]) expect(out.materialised.map((m) => m.type)).not.toContain(t);
    expect(Object.keys(RATE_GAPS).sort()).toEqual(["duplicate_replay", "unit_rekey"]);
  });
  it("Given a production run whose scenario names an offset for an analyzer (A049 is an example, not a rate) Then the clock error is injected where that analyzer measured, and is no longer not modelled", () => {
    const out = inject({ seed: 7, architecture: { id: "t", flags: arch().flags }, events: measured, label_rate_by_operator: { "OP-1": 0 }, clock_offsets: { "AN-1": 18000 } });
    expect(out.not_modelled).toEqual(["unit_rekey", "duplicate_replay"]);
    expect(out.materialised.filter((m) => m.type === "clock_offset").length).toBeGreaterThan(0);
  });
  it("Given an offset of zero seconds Then nothing is named: the clock error stays not modelled", () => {
    const out = inject({ seed: 7, architecture: { id: "t", flags: arch().flags }, events: measured, label_rate_by_operator: { "OP-1": 0 }, clock_offsets: { "AN-1": 0 } });
    expect(out.not_modelled).toContain("clock_offset");
  });
});
