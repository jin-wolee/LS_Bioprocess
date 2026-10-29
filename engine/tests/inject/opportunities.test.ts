import { describe, expect, it } from "vitest";
import { DRAWN_TYPES, ERROR_TYPES } from "../../src/inject/types.ts";
import { inject } from "../../src/inject/inject.ts";
import { drawOpportunities } from "../../src/inject/opportunities.ts";
import { createRng } from "../../src/rng.ts";
import type { StreamKey } from "../../src/rng.ts";
import { arch } from "../support/record_fixture.ts";
import { bulk } from "../support/inject_fixture.ts";

// S2b Step 2: common error opportunities (fair by construction). One draw per physical sample and drawn error type, from the keyed stream
// of the canonical tuple (run_seed, physical_sample_id, analyte, attempt, purpose) with purpose `error:<type>` (spec section 3 rule 3;
// 00 section 2 item 2). A draw that belongs to no analyte puts `-` in the third slot and 0 in the fourth. An architecture materialises an
// opportunity when u < rate; coupling is monotone. Seeds, samples and rates below are test-only values.

const SEED = 7;
const flagsOf = (...on: Parameters<typeof arch>) => ({ id: on.join("+") || "A", flags: arch(...on).flags }); // a distinct id per architecture, so a draw keyed by it would differ
const labelErrors = (events: ReturnType<typeof bulk>, on: Parameters<typeof arch>, rate: number) =>
  inject({ seed: SEED, architecture: flagsOf(...on), events, label_rate_by_operator: { "OP-1": rate } }).materialised.filter((m) => m.type === "label_error").map((m) => m.sample_id);

describe("The opportunities are keyed by the canonical tuple", () => {
  it("Given one sample Then three draws are taken, with the keys (7, S1, -, 0, error:label_error), error:unit_rekey and error:duplicate_replay", () => {
    const keys: StreamKey[] = [];
    drawOpportunities(SEED, "S1", createRng((k) => keys.push(k)));
    expect(keys).toEqual([[7, "S1", "-", 0, "error:label_error"], [7, "S1", "-", 0, "error:unit_rekey"], [7, "S1", "-", 0, "error:duplicate_replay"]]);
    expect(DRAWN_TYPES).toEqual(["label_error", "unit_rekey", "duplicate_replay"]);
  });

  it("Given the types Then the injector knows exactly the matrix rows it can materialise plus planned-versus-actual time (the other rows are truth-side and listed apart)", () => {
    expect([...ERROR_TYPES]).toEqual(["label_error", "feed_in_gap", "unit_rekey", "clock_offset", "duplicate_replay", "lost_rerun", "unattributable_record", "planned_vs_actual"]);
  });

  it("Given a sample Then u is in [0, 1), equal to the first value of its keyed stream, and the same on every call", () => {
    const first = drawOpportunities(SEED, "S1");
    expect(first.map((o) => o.type)).toEqual([...DRAWN_TYPES]);
    for (const o of first) {
      expect(o.u).toBeGreaterThanOrEqual(0);
      expect(o.u).toBeLessThan(1);
      expect(o.u).toBe(createRng().stream([SEED, "S1", "-", 0, `error:${o.type}`]).float());
    }
    expect(drawOpportunities(SEED, "S1")).toEqual(first);
  });

  it("Given an added sample Then no other sample's draws change", () => {
    const small = new Map(bulk(10).flatMap((e) => (e.type === "sample_drawn" ? [e.sample_id] : [])).map((id) => [id, drawOpportunities(SEED, id)]));
    const large = new Map(bulk(11).flatMap((e) => (e.type === "sample_drawn" ? [e.sample_id] : [])).map((id) => [id, drawOpportunities(SEED, id)]));
    for (const [id, opps] of small) expect(large.get(id)).toEqual(opps);
  });

  it("Given another seed Then the draws differ", () => {
    expect(drawOpportunities(8, "S1")).not.toEqual(drawOpportunities(7, "S1"));
  });
});

describe("The opportunity is the same in every architecture; only the rate decides what materialises", () => {
  const events = bulk(300);
  const rate = 0.2;
  // the expected set is computed from the keyed stream directly, never from the injector: u < rate
  const expected = events.flatMap((e) => (e.type === "sample_drawn" && createRng().stream([SEED, e.sample_id, "-", 0, "error:label_error"]).float() < rate ? [e.sample_id] : []));

  it("Given the same samples and rate Then A, A with two_clocks and C without system_issued_id materialise exactly the samples with u < rate", () => {
    expect(expected.length).toBeGreaterThan(20); // a non-trivial set (rate 0.2 of 300 samples), not a claim about the rate
    expect(expected.length).toBeLessThan(300);
    for (const on of [[], ["two_clocks"], ["audit_trail", "available_at"], ["two_clocks", "write_time_keys", "ingest_idempotency", "audit_trail", "append_only_versions", "available_at", "instrument_state_snapshot"]] as const) {
      expect(labelErrors(events, [...on], rate), on.join("+") || "A").toEqual(expected);
    }
  });

  it("Given system_issued_id on Then the mechanism cannot exist and nothing materialises, whatever the opportunities and the rate (a rate of 1 included)", () => {
    expect(labelErrors(events, ["system_issued_id"], 1)).toEqual([]);
    expect(labelErrors(events, ["system_issued_id", "two_clocks", "available_at", "instrument_state_snapshot", "append_only_versions", "write_time_keys", "ingest_idempotency", "audit_trail"], 1)).toEqual([]);
  });
});

describe("Monotone coupling: an error that materialises under a lower rate also materialises under a higher one", () => {
  const events = bulk(400);
  const sets = [0.01, 0.05, 0.2, 0.6, 1].map((r) => new Set(labelErrors(events, [], r)));

  it("Given the rates 0.01 < 0.05 < 0.2 < 0.6 < 1 Then every set contains the one before it", () => {
    for (let i = 1; i < sets.length; i++) {
      for (const id of sets[i - 1] as Set<string>) expect((sets[i] as Set<string>).has(id), `${id} at rate index ${i}`).toBe(true);
    }
  });

  it("Given the same rates Then the sets grow (the coupling is not trivially equal sets) and the rate 1 takes every sample, the rate 0 none", () => {
    expect(sets.map((s) => s.size)).toEqual([...sets.map((s) => s.size)].sort((a, b) => a - b));
    expect(sets[0]?.size).toBeLessThan(sets[3]?.size as number);
    expect(sets[4]?.size).toBe(400);
    expect(labelErrors(events, [], 0)).toEqual([]);
  });
});
