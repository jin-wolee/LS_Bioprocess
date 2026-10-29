import { beforeAll, describe, expect, it } from "vitest";
import { runSeed } from "../../src/experiments/assembly/run_seed.ts";
import type { SeedOutput } from "../../src/experiments/assembly/run_seed.ts";
import { inject } from "../../src/inject/inject.ts";
import { observeEvents } from "../../src/observe.ts";
import { runScenario } from "../../src/run.ts";
import type { ScenarioRun } from "../../src/run.ts";
import { logHash } from "../../src/trace.ts";
import { CONFIGS } from "../support/cells.ts";
import { rawConfigOf, rawInputOf } from "../support/raw_run.ts";
import { SMALL } from "../support/scenarios.ts";
import { eventsOf } from "../support/sc_run.ts";

// Step 6: SC1 and SC6 re-run with raw_layer on, each preset on its default capture path (spec sections 2.4.9 and 5). Structural relations only (spec section 8, anti-gaming rule 8):
// the datasets are produced for A, B, C and the ablations, the truth log_hash is the same across architectures, and the +5 h offset of SC6 sits in the file stamps (on
// manual_transcription, in the stamp typed from the printout). No ordering of architectures is asserted. Ablations of C keep C's default path (spec section 5).

const SMALL_RUN = { seed: 1, settings: SMALL };

describe("SC1 ordinary Tuesday with the raw layer on", () => {
  let run: ScenarioRun;
  let before: string;
  const after: string[] = [];
  const outs: SeedOutput[] = [];
  beforeAll(async () => {
    const config = rawConfigOf("default", { seed: 1 });
    run = runScenario(config);
    before = await logHash(run.events);
    for (const c of CONFIGS) {
      outs.push(runSeed(rawInputOf(run, config, "default-raw", [c.config], 21)));
      after.push(await logHash(run.events));
    }
  }, 240_000);

  it("Given the ordinary-day scenario with the layer on When A, B, C and the eight ablations are recorded each on its default path Then there are eleven datasets", () => {
    expect(outs.map((o) => Object.keys(o.datasets))).toEqual(CONFIGS.map((c) => [c.config.id]));
    expect(outs.every((o) => (Object.values(o.datasets)[0]?.result.length ?? 0) > 1000)).toBe(true);
  });
  it("Given the same truth run Then the truth log_hash is identical after every configuration", () => {
    expect(before).toMatch(/^[0-9a-f]{64}$/);
    expect(after).toEqual(CONFIGS.map(() => before));
  });
  it("Given the default paths Then A's rows are manual_transcription, and the rows of B, C and the ablations of C are adapter_ingest", () => {
    const paths = outs.map((o) => [...new Set((Object.values(o.datasets)[0]?.result ?? []).map((r) => r.capture_path))]);
    expect(paths).toEqual([["manual_transcription"], ...CONFIGS.slice(1).map(() => ["adapter_ingest"])]);
  });
  it("Given every cell Then it counts the same number of requests (the denominator is all analysis requests)", () => {
    expect(new Set(outs.flatMap((o) => o.cells.map((c) => c.n_requests))).size).toBe(1);
  });
  it("Given the controller logs of the default raw-layer scenario (one bay on each family) Then A keeps the columnar series as observable events, and B, C and the first ablations parse the logs into the same historian rows, no ordering asserted", () => {
    const ds = (i: number) => Object.values((outs[i] as SeedOutput).datasets)[0];
    expect(ds(0)?.historian.series.length).toBe(72);
    expect(ds(0)?.historian.late).toEqual([]);
    const rows = (i: number) => JSON.stringify((ds(i)?.historian.late ?? []).map((r) => [r.tag, r.ts, r.value]).sort());
    expect(ds(2)?.historian.late.length ?? 0).toBeGreaterThan(10_000);
    for (const i of [1, 2, 3, 4]) expect(rows(i)).toBe(rows(2)); // a flag that decides what the recorder keeps does not change what the controller wrote
  });
});

describe("SC6 wrong clock with the raw layer on", () => {
  const OFFSET = 18000; // AN-1 runs 5 h ahead (A049; a neutral example, not a claim about any site)
  let run: ScenarioRun;
  let out: SeedOutput;
  beforeAll(() => {
    const config = rawConfigOf("default", SMALL_RUN);
    run = runScenario(config);
    const input = rawInputOf(run, config, "default-raw-clock", CONFIGS.slice(0, 3).map((c) => c.config), 8);
    out = runSeed({ ...input, clock_offsets: { "AN-1": OFFSET } });
  }, 120_000);

  const first = (analyzer: string) => eventsOf(run, "result_measured").find((e) => e.analyzer === analyzer);
  it("Given AN-1 runs 5 h ahead When C's file is parsed Then the offset sits in the stamps: the first AN-1 result is recorded 18000 s after its true measurement", () => {
    const truth = first("AN-1");
    const row = out.datasets["c_context"]?.result.find((r) => r.request_id === truth?.request_id && r.analyte === truth?.analyte && r.version === 1);
    expect(row?.measured_at).toBe((truth?.t ?? 0) + OFFSET);
  });
  it("Given the same offset on manual_transcription (A) Then the stamp typed from the printout carries it as well", () => {
    const truth = first("AN-1");
    const row = out.datasets["a_manual"]?.result.find((r) => r.request_id === truth?.request_id && r.analyte === truth?.analyte);
    expect(row?.measured_at).toBe((truth?.t ?? 0) + OFFSET);
    expect(row?.capture_path).toBe("manual_transcription");
  });
  it("Given AN-2 has no offset Then its results keep the true stamp on both paths", () => {
    const truth = first("AN-2");
    const rows = (id: string) => out.datasets[id]?.result.filter((r) => r.request_id === truth?.request_id && r.analyte === truth?.analyte);
    expect(rows("c_context")?.[0]?.measured_at).toBe(truth?.t);
    expect(rows("a_manual")?.[0]?.measured_at).toBe(truth?.t);
  });
  it("Given the same offset Then the controller stamps do not move: the offset is the analyzer's clock (A049, one analyzer set +5 h), and the controller logs are the same with and without it", () => {
    const config = rawConfigOf("default", SMALL_RUN);
    const plain = runSeed(rawInputOf(runScenario(config), config, "default-raw-noclock", CONFIGS.slice(0, 3).map((c) => c.config), 8));
    for (const id of ["b_lims_lite", "c_context"]) {
      const [with5h, without] = [out, plain].map((o) => o.datasets[id]);
      expect(with5h?.historian.late.length).toBeGreaterThan(0);
      expect(JSON.stringify(with5h?.historian.late)).toBe(JSON.stringify(without?.historian.late));
      expect(JSON.stringify(with5h?.raw?.batch_phase_record)).toBe(JSON.stringify(without?.raw?.batch_phase_record));
      const controllerFiles = (o: typeof with5h) => (o?.raw?.raw_file ?? []).filter((f) => /^(ctrl|bench)_/.test(f.file_name)).map((f) => [f.file_name, f.content_hash, f.received_at]);
      expect(controllerFiles(with5h)).toEqual(controllerFiles(without));
    }
  });
  it("Given a clock error Then the injector's key lists it for every architecture: no capture path and no flag prevents it", () => {
    const key = JSON.parse(out.key_text) as { architectures: Record<string, { errors: { type: string }[] }> };
    expect(Object.values(key.architectures).map((a) => a.errors.some((e) => e.type === "clock_offset"))).toEqual([true, true, true]);
    expect(inject({ seed: 1, architecture: { id: "x", flags: (CONFIGS[2] as (typeof CONFIGS)[number]).config.flags }, events: observeEvents(run.events), clock_offsets: { "AN-1": OFFSET }, forced: [] }).materialised.some((m) => m.type === "clock_offset")).toBe(true);
  });
});
