import { beforeAll, describe, expect, it } from "vitest";
import { anchorEpoch } from "../../src/calendar.ts";
import { physicalIds } from "../../src/experiments/assembly/physical_ids.ts";
import { rawPath } from "../../src/experiments/assembly/raw_path.ts";
import type { RawPathOutput, RawSetup } from "../../src/experiments/assembly/raw_path.ts";
import { runSeed } from "../../src/experiments/assembly/run_seed.ts";
import { inject } from "../../src/inject/inject.ts";
import { record } from "../../src/record/recorder.ts";
import type { CapturePath } from "../../src/raw/types.ts";
import { runScenario } from "../../src/run.ts";
import { BASE, VALID_QUALIFICATIONS, byTime, inoculation, sampleWithRun } from "../support/cell_stream.ts";
import { CONFIGS } from "../support/cells.ts";
import { DIALECTS, rawConfigOf, rawInputOf } from "../support/raw_run.ts";

// S2f F1: one analyzer row per physical analysis (spec 2.4.2; data_model section 7, S2e1 table, "Files"). A label error can give two analyses on one analyzer the same label, the
// same attempt and the same visit. They are two analyses of two tubes, so the file has two rows (each with its own stamp) and both capture paths hand the recorder two results.
// Test-only values; every time is an integer second of the synthetic Monday 2030-01-07 (1500 s is 00:25:00).

const A = (CONFIGS[0] as (typeof CONFIGS)[number]).config;

// Two tubes of one unit on one analyzer: S1 measured at 1500 s and S2 at 1600 s (drawn 1100 and 1200, run starting 100 s after the draw, taking 300 s). The operator wrote the label
// S1 on both: a forced label error on S2 (what the injector does in architecture A).
const clean = byTime([...BASE, inoculation("U1"), ...sampleWithRun("S1", "U1", 1100, 100, 4.2), ...sampleWithRun("S2", "U1", 1200, 100, 5.1)]);
const injected = inject({ seed: 9, architecture: { id: A.id, flags: A.flags }, events: clean, forced: [{ type: "label_error", sample_id: "S2", detail: { as_id: "S1" } }] });

const setup: RawSetup = {
  dialects: DIALECTS, anchor_epoch_s: anchorEpoch("2030-01-07"), zone_offset_s: 0, default_dilution: 1, export_at: () => 5000, visits: [{ dialect: "allinone_csv", analytes: ["glucose"], run_s: 270 }],
};
const through = (path: CapturePath): { out: RawPathOutput; results: { request_id: string; value: number; measured_at: number }[] } => {
  const out = rawPath({ setup, seed: 9, architecture: A, path, events: injected.events, received_at: injected.received_at, physical: physicalIds(clean, injected.events) });
  const ds = record({ events: out.events, sensors: [], received_at: out.received_at, qualifications: VALID_QUALIFICATIONS, capture: out.capture }, A);
  return { out, results: ds.result.map((r) => ({ request_id: r.request_id, value: r.value, measured_at: r.measured_at })) };
};

describe("S2f F1: two analyses with one label on one analyzer (hand-built, forced label error)", () => {
  let adapter: ReturnType<typeof through>;
  let manual: ReturnType<typeof through>;
  beforeAll(() => { adapter = through("adapter_ingest"); manual = through("manual_transcription"); });

  it("Given S2 is written as S1 on the same analyzer, attempt and visit Then the stream carries two analyses under the label S1 at 1500 s and 1600 s", () => {
    expect(injected.events.filter((e) => e.type === "result_measured").map((e) => [e.request_id, e.t])).toEqual([["S1", 1500], ["S1", 1600]]);
  });
  it("When the export is written Then the file has two data rows, each with its own stamp (00:25:00 and 00:26:40), and the key lists both", () => {
    const file = adapter.out.files[0];
    const lines = file?.text.split("\n").slice(2, 4) ?? [];
    expect(lines.map((l) => l.split(",").slice(0, 3))).toEqual([["S1", "2030-01-07 00:25:00", "2030-01-07 00:25:00"], ["S1", "2030-01-07 00:26:40", "2030-01-07 00:26:40"]]);
    expect(file?.key_rows.map((k) => [k.line, k.sample_id, k.intended_s])).toEqual([[3, "S1", 1500], [4, "S1", 1600]]);
    expect(file?.manifest.map((m) => m.line)).toEqual([3, 4]);
  });
  it("When the file is parsed Then both rows load, each at the instant of its own analysis", () => {
    expect(adapter.out.outputs[0]?.records.map((r) => (r.payload as { measured_at: number | null }).measured_at)).toEqual([1500, 1600]);
  });
  it("Then the stream the recorder gets on the adapter path is the stream of the manual path, event for event and in the same order: each parsed analysis is back at its own place", () => {
    expect(adapter.out.events).toEqual(manual.out.events);
  });
  it("Then the recorder gets two results on each path (A has no idempotency flag, so both are rows), at their own instants", () => {
    expect(manual.results.map((r) => [r.request_id, r.value, r.measured_at])).toEqual([["S1", 4.2, 1500], ["S1", 5.1, 1600]]);
    expect(adapter.results.map((r) => [r.request_id, r.value, r.measured_at])).toEqual([["S1", 4.2, 1500], ["S1", 5.1, 1600]]);
  });
});

// SC1 (the default scenario with the layer on), preset A, per_run is not set: the default window_end. Seeds 3 and 5003 gave 2388 and 2280 results on manual_transcription and 2382 and 2274
// on adapter_ingest before the fix (the orchestrator's reproduction); the counts of the manual side are the reference because the typed row follows the stream one for one.
describe("S2f F1: SC1 preset A, the result count is the same on both capture paths", () => {
  const counts: Record<number, Record<CapturePath, number>> = {};
  beforeAll(() => {
    for (const seed of [3, 5003]) {
      const config = rawConfigOf("default", { seed });
      const input = rawInputOf(runScenario(config), config, `default-raw-${seed}`, [A], 21);
      counts[seed] = {
        manual_transcription: Object.values(runSeed({ ...input, raw: { ...(input.raw as RawSetup), capture_path: "manual_transcription" } }).datasets)[0]?.result.length ?? 0,
        adapter_ingest: Object.values(runSeed({ ...input, raw: { ...(input.raw as RawSetup), capture_path: "adapter_ingest" } }).datasets)[0]?.result.length ?? 0,
      };
    }
  }, 240_000);

  it.each([[3, 2388], [5003, 2280]])("Given seed %i When A is recorded on each path Then both give %i results", (seed, expected) => {
    expect(counts[seed]).toEqual({ manual_transcription: expected, adapter_ingest: expected });
  });
});
