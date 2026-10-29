import { describe, expect, it } from "vitest";
import { inject } from "../../src/inject/inject.ts";
import type { ForcedError } from "../../src/inject/types.ts";
import type { ObservableEvent } from "../../src/observe.ts";
import { FLAG_NAMES } from "../../src/record/architecture.ts";
import { record } from "../../src/record/recorder.ts";
import { SENSORS, STREAM, arch } from "../support/record_fixture.ts";

// S2b Step 2, forced mode: given a hand-built observable stream and an explicit list of errors, the injector bypasses the rates
// (production runs never do). The mechanism still decides: where it cannot exist the error is "prevented" and the stream is untouched
// (spec section 5 matrix, column "Prevented by"). Expected streams are typed by hand from the fixture of record_fixture.ts
// (S1 on U1 drawn 1100, run 1500-2000; S2 on U1 drawn 5000, two runs; S3 on U2 drawn 9100, run 9500-10000; all on AN-1).

const FLAGS = (...on: (typeof FLAG_NAMES)[number][]) => ({ id: "t", flags: arch(...on).flags });
const run = (on: (typeof FLAG_NAMES)[number][], forced: ForcedError[], clock_offsets?: Record<string, number>) =>
  inject({ seed: 1, architecture: FLAGS(...on), events: STREAM, forced, ...(clock_offsets ? { clock_offsets } : {}) });
const requestIds = (events: readonly ObservableEvent[], type: ObservableEvent["type"]) => events.flatMap((e) => (e.type === type && "request_id" in e ? [e.request_id] : []));
/** The forced errors of one type; the structural types (feed in the gap, lost rerun, ...) follow from the stream and are asserted in structural.test.ts. */
const only = (out: ReturnType<typeof run>, type: string) => out.materialised.filter((m) => m.type === type);
const ALL_BUT = (flag: (typeof FLAG_NAMES)[number]) => FLAG_NAMES.filter((f) => f !== flag);

describe("Forced label error (sample-id text wrong at the analyzer)", () => {
  const forced: ForcedError[] = [{ type: "label_error", sample_id: "S2", detail: { as_id: "S2?" } }];
  it("Given architecture A and a rate of zero Then the error materialises anyway: S2's analyzer-side events carry 'S2?' and the sample's own events keep 'S2'", () => {
    const out = run([], forced);
    expect(only(out, "label_error")).toEqual([{ type: "label_error", sample_id: "S2", detail: { as_id: "S2?" } }]);
    expect(requestIds(out.events, "result_measured")).toEqual(["S1", "S2?", "S2?", "S3"]);
    expect(out.events.filter((e) => e.type === "sample_drawn").map((e) => e.type === "sample_drawn" && e.sample_id)).toEqual(["S1", "S2", "S3"]);
    expect(out.not_modelled).toEqual([]);
  });
  it("Given system_issued_id on (B and C) Then the error is prevented: nothing materialises and the stream is unchanged", () => {
    for (const on of [["system_issued_id", "ingest_idempotency", "audit_trail"], [...FLAG_NAMES]] as const) {
      const out = run([...on], forced);
      expect(only(out, "label_error")).toEqual([]);
      expect(out.events).toEqual(STREAM);
    }
  });
  it("Given C minus system_issued_id Then the error materialises again (the flag is what prevented it)", () => {
    expect(only(run(ALL_BUT("system_issued_id"), forced), "label_error").map((m) => m.sample_id)).toEqual(["S2"]);
  });
  it("Given no replacement id Then the forced error is refused", () => {
    expect(() => run([], [{ type: "label_error", sample_id: "S2" }])).toThrow(/as_id/);
  });
});

describe("Forced unit re-key (the label carries another unit)", () => {
  const forced: ForcedError[] = [{ type: "unit_rekey", sample_id: "S1", detail: { to_unit: "U2" } }];
  it("Given write_time_keys off Then S1's planned and drawn events name U2 and the batch id of the stream is left as it was", () => {
    const out = run([], forced);
    expect(only(out, "unit_rekey")).toEqual([{ type: "unit_rekey", sample_id: "S1", detail: { from_unit: "U1", to_unit: "U2" } }]);
    expect(out.events.flatMap((e) => (e.type === "sample_planned" || e.type === "sample_drawn" ? [[e.sample_id, e.unit_id, e.batch_id]] : []))).toEqual([
      ["S1", "U2", "B-U1"], ["S1", "U2", "B-U1"], ["S2", "U1", "B-U1"], ["S2", "U1", "B-U1"], ["S3", "U2", "B-U2"], ["S3", "U2", "B-U2"],
    ]);
  });
  it("Given write_time_keys on Then the keys are fixed at write, the re-key is prevented and the stream is unchanged", () => {
    const out = run(["write_time_keys"], forced);
    expect(only(out, "unit_rekey")).toEqual([]);
    expect(out.events).toEqual(STREAM);
  });
});

describe("Forced replay of a result file (a source event: common to every architecture; the flag decides its effect)", () => {
  // Test-only: the replay has no ledger rate, so only forced mode produces it (production reports it as not modelled).
  const forced: ForcedError[] = [{ type: "duplicate_replay", sample_id: "S1" }];
  const PRESETS: [string, (typeof FLAG_NAMES)[number][]][] = [["A", []], ["B", ["system_issued_id", "ingest_idempotency", "audit_trail"]], ["C", [...FLAG_NAMES]]];

  it.each(PRESETS)("Given %s Then S1's result event appears twice in a row in the stream, with the same event id", (_name, on) => {
    const out = run(on, forced);
    expect(requestIds(out.events, "result_measured")).toEqual(["S1", "S1", "S2", "S2", "S3"]);
    const at = out.events.findIndex((e) => e.type === "result_measured");
    expect(out.events[at + 1]).toEqual(out.events[at]);
  });

  it("Given ingest_idempotency off (A) Then the replay is a realised error: it is in the key and the record double counts S1", () => {
    const out = run([], forced);
    expect(only(out, "duplicate_replay")).toEqual([{ type: "duplicate_replay", sample_id: "S1", detail: {} }]);
    expect(record({ events: out.events, sensors: SENSORS }, arch()).result.filter((r) => r.request_id === "S1").map((r) => r.value)).toEqual([5.1, 5.1]);
  });

  it.each(PRESETS.slice(1))("Given ingest_idempotency on (%s) Then the error is prevented (not in the key) and the record holds one S1 row plus a VR-008 information no-op", (_name, on) => {
    const out = run(on, forced);
    expect(only(out, "duplicate_replay")).toEqual([]);
    const ds = record({ events: out.events, sensors: SENSORS }, arch(...on));
    expect(ds.result.filter((r) => r.request_id === "S1").length).toBe(1);
    expect(ds.validation_finding).toEqual([{ rule: "VR-008", target: "source_event:AN-1/S1/1/1/glucose", severity: "info", action: "no-op", status: "resolved" }]);
  });
});

describe("Per-instrument clock offset (A049; +5 h = 18000 s in fixtures)", () => {
  const OFFSET = { "AN-1": 18000 };
  it("Given AN-1 runs 18000 s ahead Then its visit, run, result and QC stamps move by 18000 s and the queue and sample events do not", () => {
    const out = run([], [], OFFSET);
    const at = (type: ObservableEvent["type"], request: string) => out.events.find((e) => e.type === type && "request_id" in e && e.request_id === request)?.t;
    expect([at("visit_started", "S1"), at("run_started", "S1"), at("result_measured", "S1"), at("qc_result", "S1"), at("visit_finished", "S1")]).toEqual([19500, 19500, 20000, 20000, 20000]);
    expect([at("request_queued", "S1"), out.events.find((e) => e.type === "sample_drawn")?.t, out.events.find((e) => e.type === "calibration_recorded")?.t]).toEqual([1400, 1100, 0]);
  });
  it("Given the same offset Then the host receipt time of every result is its true stamp, by source event id", () => {
    expect(run([], [], OFFSET).received_at).toEqual({
      "AN-1/S1/1/1/glucose": 2000, "AN-1/S2/1/1/glucose": 6500, "AN-1/S2/2/1/glucose": 9000, "AN-1/S3/1/1/glucose": 10000,
    });
  });
  it("Given the offset Then each of the three samples measured on AN-1 carries a realised clock error, in every architecture (no flag prevents it)", () => {
    for (const on of [[], ["system_issued_id", "ingest_idempotency", "audit_trail"], [...FLAG_NAMES]] as const) {
      const m = run([...on], [], OFFSET).materialised.filter((x) => x.type === "clock_offset");
      expect(m.map((x) => [x.sample_id, x.detail])).toEqual([["S1", { analyzer: "AN-1", offset_s: 18000 }], ["S2", { analyzer: "AN-1", offset_s: 18000 }], ["S3", { analyzer: "AN-1", offset_s: 18000 }]]);
    }
  });
  it("Given an offset of zero or an analyzer that ran nothing Then nothing materialises and the stream is unchanged", () => {
    for (const offsets of [{ "AN-1": 0 }, { "AN-9": 18000 }] as Record<string, number>[]) {
      const out = run([], [], offsets);
      expect(out.materialised.filter((x) => x.type === "clock_offset")).toEqual([]);
      expect(out.events).toEqual(STREAM);
      expect(out.received_at).toEqual({});
    }
  });
});

describe("The output is plain data", () => {
  it("Given any run Then the materialised errors survive a JSON round trip unchanged, and the input stream is not modified", () => {
    const before = structuredClone(STREAM);
    const out = run([], [{ type: "label_error", sample_id: "S2", detail: { as_id: "S2?" } }, { type: "duplicate_replay", sample_id: "S1" }], { "AN-1": 18000 });
    expect(JSON.parse(JSON.stringify(out.materialised))).toEqual(out.materialised);
    expect(STREAM).toEqual(before);
  });
});
