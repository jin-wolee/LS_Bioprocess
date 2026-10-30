import { describe, expect, it } from "vitest";
import { inject } from "../../src/inject/inject.ts";
import { FLAG_NAMES } from "../../src/record/architecture.ts";
import type { FlagName } from "../../src/record/architecture.ts";
import { STREAM, arch, byTime } from "../support/record_fixture.ts";

// S2b Step 2: error types that are not drawn but follow from the stream and the flags (spec section 5 matrix): feed in the gap,
// lost rerun, unattributable record, and planned-versus-actual time (a structural limit of B, not a random error). Per preset and
// ablation, the materialised (type, sample) pairs are typed by hand from the matrix column "Prevented by" and the fixture:
//   feed in the gap   feed on U1 at 1200, S1 drawn at 1100 and measured at 2000 -> S1. S2 (5000-6500) and S3 (U2, 9100-10000) have no feed in their gap.
//   lost rerun        S2 has a second attempt (measured at 9000) -> S2.
//   unattributable    every drawn sample, where no audit trail stores who drew it -> S1, S2, S3.
//   planned vs actual every drawn sample, where a plan issues the label (planned time stored) and the actual draw time is not (no two_clocks) -> S1, S2, S3.

const on = (...f: FlagName[]) => f;
const ALL = [...FLAG_NAMES];
const minus = (flag: FlagName) => ALL.filter((f) => f !== flag);
const pairs = (flags: FlagName[], events = STREAM) =>
  inject({ seed: 1, architecture: { id: "t", flags: arch(...flags).flags }, events, forced: [] }).materialised.map((m) => `${m.type}:${m.sample_id}`);

const CELLS: [string, FlagName[], string[]][] = [
  ["A (no flag)", on(), ["feed_in_gap:S1", "lost_rerun:S2", "unattributable_record:S1", "unattributable_record:S2", "unattributable_record:S3"]],
  ["B (system_issued_id, ingest_idempotency, audit_trail)", on("system_issued_id", "ingest_idempotency", "audit_trail"), ["feed_in_gap:S1", "lost_rerun:S2", "planned_vs_actual:S1", "planned_vs_actual:S2", "planned_vs_actual:S3"]],
  ["C (all ten)", ALL, []],
  ["C minus two_clocks", minus("two_clocks"), ["feed_in_gap:S1", "planned_vs_actual:S1", "planned_vs_actual:S2", "planned_vs_actual:S3"]],
  ["C minus append_only_versions", minus("append_only_versions"), ["lost_rerun:S2"]],
  ["C minus audit_trail", minus("audit_trail"), ["unattributable_record:S1", "unattributable_record:S2", "unattributable_record:S3"]],
  ["C minus system_issued_id", minus("system_issued_id"), []],
  ["C minus write_time_keys", minus("write_time_keys"), []],
];

describe("Structural error types per architecture", () => {
  it.each(CELLS)("%s", (_name, flags, expected) => {
    expect(pairs(flags)).toEqual(expected);
  });
});

describe("Feed in the gap: a feed on the sample's unit after the draw and up to the measurement", () => {
  const withFeed = (t: number, unit = "U1") => byTime([...STREAM, { type: "process_event", t, unit_id: unit, batch_id: `B-${unit}`, kind: "feed", source: "scheduled", amount: 0.1, amount_unit: "L" }]);
  const gapOf = (events: typeof STREAM) => pairs(on(), events).filter((p) => p.startsWith("feed_in_gap"));
  it("Given a feed at the draw instant (1100) Then it is before the draw, not in the gap (the fixture feed at 1200 still is)", () => {
    expect(gapOf(withFeed(1100))).toEqual(["feed_in_gap:S1"]);
    expect(gapOf(withFeed(1100).filter((e) => !(e.type === "process_event" && e.t === 1200)))).toEqual([]);
  });
  it("Given a feed at the measurement instant (2000) Then it is in the gap", () => {
    expect(gapOf(withFeed(2000).filter((e) => !(e.type === "process_event" && e.t === 1200)))).toEqual(["feed_in_gap:S1"]);
  });
  it("Given a feed on another unit between draw and measurement Then it is not in the gap", () => {
    expect(gapOf(withFeed(1500, "U2").filter((e) => !(e.type === "process_event" && e.t === 1200)))).toEqual([]);
  });
  it("Given the detail Then the key names the feed instant", () => {
    const out = inject({ seed: 1, architecture: { id: "t", flags: arch().flags }, events: STREAM, forced: [] });
    expect(out.materialised.find((m) => m.type === "feed_in_gap")?.detail).toEqual({ feed_at: 1200 });
  });
});

describe("Details of the other structural types", () => {
  it("Given B Then planned-versus-actual names the stored planned time and the true draw time, and lost rerun the number of attempts", () => {
    const out = inject({ seed: 1, architecture: { id: "t", flags: arch("system_issued_id", "ingest_idempotency", "audit_trail").flags }, events: STREAM, forced: [] });
    expect(out.materialised.filter((m) => m.type === "planned_vs_actual").map((m) => m.detail)).toEqual([
      { planned_at: 900, sampled_at: 1100 }, { planned_at: 4800, sampled_at: 5000 }, { planned_at: 9000, sampled_at: 9100 },
    ]);
    expect(out.materialised.find((m) => m.type === "lost_rerun")?.detail).toEqual({ attempts: 2 });
  });
  it("Given a skipped draw Then it has no run and no operator, so it is neither a lost rerun nor an unattributable record", () => {
    const skip = [...STREAM, { type: "draw_skipped_volume_budget" as const, t: 11100, sample_id: "S4", unit_id: "U2", batch_id: "B-U2", volume_ul: 200, cumulative_ul: 3000 }];
    expect(pairs(on(), skip).filter((p) => p.endsWith(":S4"))).toEqual([]);
  });
});
