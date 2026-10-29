import { describe, expect, it } from "vitest";
import { NONE_OCCURRED, NOT_APPLICABLE, rawMetrics } from "../../src/evaluate/raw_metrics.ts";
import type { RowObservation } from "../../src/evaluate/raw_metrics.ts";
import type { RawRecordState } from "../../src/ingest/canonical.ts";
import type { KeyRow } from "../../src/raw/key.ts";
import { casesOf, runCase } from "../support/raw_fixtures.ts";

// Step 6: the idempotent re-ingest property and the raw-layer metrics of spec section 2.4.7. All values are test-only and typed by hand.

const names = (xs: ReturnType<typeof runCase>["outputs"]): string[] => xs.flatMap((o) => o.records.map((r) => `${r.envelope.idempotency_key}|${r.payload.value}|${r.payload.measured_at}`)).sort();
const set = (dialect: string, order: string[], flags: { ingest_idempotency: boolean } = { ingest_idempotency: true }, twice = false): string[] => {
  const c = { ...(casesOf(dialect, "clean")[0] as ReturnType<typeof casesOf>[number]), flags, after: [] as string[] };
  const files = twice ? [...order, ...order] : order;
  const last = files[files.length - 1] as string;
  return names(runCase(dialect, last, { ...c, after: files.slice(0, -1) }).outputs);
};

describe("Idempotent re-ingest (property)", () => {
  const sets: [string, string[]][] = [["allinone_csv", ["clean", "overlap"]], ["counter_csv", ["clean", "append"]]];
  it.each(sets)("Given the files %s %j When they are ingested in the other order Then the canonical set is the same", (dialect, order) => {
    expect(set(dialect, [...order].reverse())).toEqual(set(dialect, order));
  });
  it.each(sets)("Given the files %s %j When the whole set is ingested twice Then the canonical set is the same as after one pass", (dialect, order) => {
    expect(set(dialect, order, { ingest_idempotency: true }, true)).toEqual(set(dialect, order));
  });
  it.each(sets)("Given %s %j and ingest_idempotency off When the set is ingested twice Then the second pass doubles the rows", (dialect, order) => {
    const once = set(dialect, order, { ingest_idempotency: false });
    expect(set(dialect, order, { ingest_idempotency: false }, true).length).toBe(2 * once.length);
  });
  it("Given a truncated file When parsed Then its complete lines load and one parse_error is written for the broken one", () => {
    const p = runCase("allinone_csv", "truncated", casesOf("allinone_csv", "truncated")[0] as ReturnType<typeof casesOf>[number]);
    expect([p.last.records.length, p.last.parse_errors.length, p.last.raw_records.filter((r) => r.state === "rejected").length]).toEqual([4, 1, 1]);
  });
});

const key = (line: number, more: Partial<KeyRow> = {}): KeyRow => ({ line, sample_id: `S${line}`, intended_s: 1000 * line, resolution_s: 1, ambiguous: false, repeat: false, quirks: [], unreadable: false, ...more });
const obs = (k: KeyRow, state: RawRecordState | "file_rejected", parsed_s: number | null = null): RowObservation => ({ key: k, state, parsed_s });

/** Ten rows written: five clean, two repeats, one unreadable, two with ambiguous stamps (one pinned by another row, one unresolved). */
const TEN = (repeatState: RawRecordState): RowObservation[] => [
  ...[1, 2, 3, 4, 5].map((n) => obs(key(n), "loaded", 1000 * n)),
  obs(key(6, { repeat: true, quirks: ["RQ4"] }), repeatState, 6000), obs(key(7, { repeat: true, quirks: ["RQ4"] }), repeatState, 7000),
  obs(key(8, { unreadable: true }), "rejected"),
  obs(key(9, { ambiguous: true, quirks: ["RQ2"] }), "loaded", 9000), obs(key(10, { ambiguous: true, quirks: ["RQ2"] }), "quarantined"),
];

describe("Raw-layer metrics (spec section 2.4.7), hand fixture: 10 rows written, 2 repeats, 1 unreadable, 2 ambiguous", () => {
  it("Given the fixture with ingest_idempotency on Then parse failure is 1 of 10", () => {
    expect(rawMetrics(TEN("no_op")).parse_failure).toEqual({ status: "reported", num: 1, den: 10 });
  });
  it("Given the repeats were no-ops Then duplicate rows suppressed are 2 of 2, none loaded again, none quarantined", () => {
    expect(rawMetrics(TEN("no_op")).duplicates).toEqual({ status: "reported", den: 2, suppressed: 2, loaded_again: 0, quarantined: 0 });
  });
  it("Given the repeats loaded again (the flag off) Then duplicate rows suppressed are 0 of 2 and 2 loaded again", () => {
    expect(rawMetrics(TEN("loaded")).duplicates).toEqual({ status: "reported", den: 2, suppressed: 0, loaded_again: 2, quarantined: 0 });
  });
  it("Given one ambiguous stamp pinned by another row and one left unresolved Then 1 of 2 is resolved correctly, 0 of 2 wrongly, 1 of 2 unresolved", () => {
    expect(rawMetrics(TEN("no_op")).ambiguous).toEqual({ status: "reported", den: 2, correct: 1, wrong: 0, unresolved: 1 });
  });
  it("Given the same rows Then the clean rows are 5 and none of them was quarantined or held (0 of 5)", () => {
    expect(rawMetrics(TEN("no_op")).clean).toEqual({ status: "reported", den: 5, held_or_quarantined: 0 });
  });
  it("Given the same rows Then 1 row is quarantined and 0 held, of 10 rows", () => {
    expect(rawMetrics(TEN("no_op")).stage).toEqual({ quarantined: 1, held: 0, den: 10 });
  });
  it("Given an ambiguous row parsed to another valid instant Then it counts as resolved wrongly, not as unresolved", () => {
    expect(rawMetrics([obs(key(1, { ambiguous: true, quirks: ["RQ2"] }), "loaded", 777)]).ambiguous).toEqual({ status: "reported", den: 1, correct: 0, wrong: 1, unresolved: 0 });
  });
  it("Given a minute-truncated stamp (resolution 60 s) parsed to the minute Then it is resolved correctly", () => {
    expect(rawMetrics([obs(key(1, { ambiguous: true, resolution_s: 60, intended_s: 33270 }), "loaded", 33240)]).ambiguous).toMatchObject({ correct: 1 });
  });
  it("Given a rejected file Then every row of it counts as unreadable", () => {
    expect(rawMetrics([1, 2, 3].map((n) => obs(key(n), "file_rejected"))).parse_failure).toEqual({ status: "reported", num: 3, den: 3 });
  });
  it("Given rows with no repeat and no ambiguity Then the metrics print 'none occurred' and never 100 percent", () => {
    const m = rawMetrics([1, 2].map((n) => obs(key(n), "loaded", 1000 * n)));
    expect([m.duplicates, m.ambiguous]).toEqual([NONE_OCCURRED, NONE_OCCURRED]);
    expect(NONE_OCCURRED).toEqual({ status: "none_occurred" });
  });
  it("Given a run on manual_transcription Then the ingest metrics read 'not applicable', never zero", () => {
    expect(NOT_APPLICABLE.status).toBe("not_applicable");
    expect(JSON.stringify(NOT_APPLICABLE)).not.toMatch(/"(num|den|correct|quarantined)"/);
  });
  it("Given quarantining every row Then the share of clean rows quarantined shows it (the guard against a good-looking number from a harsh adapter)", () => {
    expect(rawMetrics([1, 2, 3].map((n) => obs(key(n), "quarantined"))).clean).toEqual({ status: "reported", den: 3, held_or_quarantined: 3 });
  });
});
