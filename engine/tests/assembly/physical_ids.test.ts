import { describe, expect, it } from "vitest";
import { physicalIds } from "../../src/experiments/assembly/physical_ids.ts";
import { inject } from "../../src/inject/inject.ts";
import type { ForcedError } from "../../src/inject/types.ts";
import type { ObservableEvent } from "../../src/observe.ts";
import { resultKey } from "../../src/raw/quirks.ts";
import { BASE, byTime, inoculation, sampleWithRun } from "../support/cell_stream.ts";
import { CONFIGS } from "../support/cells.ts";

// S2f F2: the assembly maps each result event of the injected stream to the physical sample it measures (the id the truth-side draws use), as plain data for raw/ and inject/, which
// must not import truth. The stream after the injector is the stream before it with the label of some events changed, the instrument stamps moved and the result events of a replayed
// sample repeated in place (inject/edits.ts), so the two streams line up result by result. Test-only values.

const A = (CONFIGS[0] as (typeof CONFIGS)[number]).config;
// three tubes on one analyzer, measured at 1500, 1600 and 1700 s
const clean = byTime([...BASE, inoculation("U1"), ...sampleWithRun("S1", "U1", 1100, 100, 4.2), ...sampleWithRun("S2", "U1", 1200, 100, 5.1), ...sampleWithRun("S3", "U1", 1300, 100, 6.3)]);
const after = (forced: ForcedError[], clock_offsets: Record<string, number> = {}): ObservableEvent[] => inject({ seed: 9, architecture: { id: A.id, flags: A.flags }, events: clean, forced, clock_offsets }).events;
const key = (e: ObservableEvent): string => (e.type === "result_measured" ? resultKey(e) : "");

describe("S2f F2: the physical sample of each result event", () => {
  it("Given no injected error Then every result event maps to its own label", () => {
    expect(physicalIds(clean, clean)).toEqual({ "AN-1/S1/1/1/glucose/1500": "S1", "AN-1/S2/1/1/glucose/1600": "S2", "AN-1/S3/1/1/glucose/1700": "S3" });
  });
  it("Given S2 is written as S1 Then the second result under the label S1 maps to S2, and S1 keeps its own", () => {
    expect(physicalIds(clean, after([{ type: "label_error", sample_id: "S2", detail: { as_id: "S1" } }]))).toEqual({ "AN-1/S1/1/1/glucose/1500": "S1", "AN-1/S1/1/1/glucose/1600": "S2", "AN-1/S3/1/1/glucose/1700": "S3" });
  });
  it("Given S1 is written as S2 and S2 as S3 (a chain of two label errors) Then each result still maps to the tube that was measured", () => {
    const ids = physicalIds(clean, after([{ type: "label_error", sample_id: "S1", detail: { as_id: "S2" } }, { type: "label_error", sample_id: "S2", detail: { as_id: "S3" } }]));
    expect(Object.values(ids)).toEqual(["S1", "S2", "S3"]);
  });
  it("Given an analyzer clock 5 h ahead Then the stamps move and the map is keyed by the stamp the stream carries", () => {
    expect(physicalIds(clean, after([], { "AN-1": 18000 }))).toEqual({ "AN-1/S1/1/1/glucose/19500": "S1", "AN-1/S2/1/1/glucose/19600": "S2", "AN-1/S3/1/1/glucose/19700": "S3" });
  });
  it("Given a replayed sample (each result event repeated) Then the copy maps to the same sample and the next sample is not shifted", () => {
    const replayed = after([{ type: "duplicate_replay", sample_id: "S2" }]);
    expect(replayed.filter((e) => e.type === "result_measured").length).toBe(4);
    const ids = physicalIds(clean, replayed);
    expect(ids[key(replayed.filter((e) => e.type === "result_measured")[3] as ObservableEvent)]).toBe("S3");
    expect(Object.values(ids)).toEqual(["S1", "S2", "S3"]);
  });
  it("Given a stream that is not the injected form of the first (a result of another analyte, or a missing one) Then it is an error and no id is guessed", () => {
    expect(() => physicalIds(clean, clean.filter((e) => !(e.type === "result_measured" && e.request_id === "S3")))).toThrow(/not the injected form/);
    expect(() => physicalIds(clean, clean.map((e) => (e.type === "result_measured" && e.request_id === "S3" ? { ...e, analyte: "lactate" } : e)))).toThrow(/not the injected form/);
  });
});
