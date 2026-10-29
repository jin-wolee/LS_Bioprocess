import { beforeAll, describe, expect, it } from "vitest";
import { runContrast, parseContrastConfig } from "../../src/experiments/assembly/capture_contrast.ts";
import type { ContrastReport } from "../../src/experiments/assembly/capture_contrast.ts";
import { runScenario } from "../../src/run.ts";
import { logHash } from "../../src/trace.ts";
import { loadContrast } from "../support/contrast.ts";
import { readJson } from "../support/paths.ts";
import { SMALL } from "../support/scenarios.ts";

// Step 6: the capture-path contrast runner (spec section 5, "Automatic linkage alone"). Structural tests only: no test asserts a sign, a size or an ordering of the two paths, nor
// an interval that includes or excludes zero (spec section 8, anti-gaming rule 8). The runs here use the small scenario and four seeds; the real run is the runner of
// engine/tests/support/contrast_cli.ts over the 30 seeds of the config. S2e1 rework W2: the report has blocks, each naming its export schedule (A216) in the config before any run;
// the first block, per_run, holds the timing fixed so that only the path changes, and the window_end block is a labelled timing sensitivity.

const doc = readJson("scenarios", "experiments", "capture_contrast.json") as { seeds: number[]; blocks: unknown[]; bay_controllers: string[] };

describe("the contrast config", () => {
  it("Given the config file Then its seed list has at least the 20 seeds of A103, is written in the file, and holds neutral integers: no repeat, none date-shaped", () => {
    const { config } = loadContrast(doc);
    expect(config.seeds.length).toBeGreaterThanOrEqual(20);
    expect(new Set(config.seeds).size).toBe(config.seeds.length);
    expect(config.seeds.every((s) => Number.isInteger(s) && !/^(19|20)\d{6}$/.test(String(s)))).toBe(true);
    expect(config.presets).toEqual(["a_manual", "b_lims_lite", "c_context"]);
  });
  it("Given a list of 19 seeds, a repeated seed or a date-shaped seed Then the config is refused", () => {
    const seeds = doc.seeds;
    expect(() => parseContrastConfig({ ...doc, seeds: seeds.slice(0, 19) }, 20)).toThrow(/20 seeds/);
    expect(() => parseContrastConfig({ ...doc, seeds: [...seeds.slice(0, 29), seeds[0]] }, 20)).toThrow(/repeated/);
    expect(() => parseContrastConfig({ ...doc, seeds: [...seeds.slice(0, 29), 20260101] }, 20)).toThrow(/date-shaped/);
  });
  it("Given the config file Then it names the schedule of each block before any run: per_run first (linkage alone), window_end second (a labelled timing sensitivity)", () => {
    const { config } = loadContrast(doc);
    expect(config.blocks.map((b) => b.export_schedule)).toEqual(["per_run", "window_end"]);
    expect(config.blocks[0]?.label).toMatch(/^linkage alone/);
    expect(config.blocks[1]?.label).toBe("timing sensitivity: export at window end (A216) and controller logs cut daily (A217) against an entry delay that is not modelled; not linkage alone");
  });
  it("Given the config file Then it names the controller cut of each block too (A217): per_row in the linkage-alone block, daily in the timing-sensitivity block, and one controller family per bay", () => {
    const { config } = loadContrast(doc);
    expect(config.blocks.map((b) => [b.export_schedule, b.controller_log_cut])).toEqual([["per_run", "per_row"], ["window_end", "daily"]]);
    expect(config.bay_controllers).toEqual(["ctrl_neutral", "ctrl_bench"]);
  });
  it("Given a block with no controller cut, a cut that does not exist, a headline block that cuts daily, or no bay controllers Then the config is refused", () => {
    const [a, b] = doc.blocks as { label: string; export_schedule: string; controller_log_cut?: string }[];
    const noCut: Record<string, unknown> = { ...a };
    delete noCut.controller_log_cut;
    expect(() => parseContrastConfig({ ...doc, blocks: [noCut, b] }, 20)).toThrow(/controller_log_cut/);
    expect(() => parseContrastConfig({ ...doc, blocks: [{ ...a, controller_log_cut: "weekly" }, b] }, 20)).toThrow(/daily or per_row/);
    expect(() => parseContrastConfig({ ...doc, blocks: [{ ...a, controller_log_cut: "daily" }, b] }, 20)).toThrow(/controller cut at per_row/);
    expect(() => parseContrastConfig({ ...doc, bay_controllers: [] }, 20)).toThrow(/bay_controllers/);
    expect(() => parseContrastConfig({ ...doc, bay_controllers: undefined }, 20)).toThrow(/bay_controllers/);
  });
  it("Given blocks that are missing, led by window_end, repeating a schedule or naming a schedule that does not exist Then the config is refused", () => {
    const [a, b] = doc.blocks as { label: string; export_schedule: string }[];
    expect(() => parseContrastConfig({ ...doc, blocks: undefined }, 20)).toThrow(/blocks/);
    expect(() => parseContrastConfig({ ...doc, blocks: [b, a] }, 20)).toThrow(/headline/);
    expect(() => parseContrastConfig({ ...doc, blocks: [a, a] }, 20)).toThrow(/one block only/);
    expect(() => parseContrastConfig({ ...doc, blocks: [{ ...a, export_schedule: "weekly" }] }, 20)).toThrow(/window_end or per_run/);
  });
});

describe("the contrast runner", () => {
  const SEEDS = [5003, 5107, 5233, 5347];
  let report: ContrastReport;
  let hashes: string[];
  beforeAll(async () => {
    const { config, input } = loadContrast(doc, { settings: SMALL }, SEEDS);
    report = await runContrast(input, { experiment_id: config.experiment_id });
    hashes = await Promise.all(SEEDS.map(async (seed) => logHash(runScenario({ ...input.scenario, seed }).events)));
  }, 240_000);

  it("Given a seed list When the contrast runs Then the same seeds are used for every block, preset and path, and the report carries the seed count and the minimum", () => {
    expect(report.seeds).toEqual(SEEDS);
    expect([report.n_seeds, report.min_seeds, report.meets_min_seeds]).toEqual([4, 20, false]);
    expect(report.blocks.map((b) => b.presets.map((p) => p.preset))).toEqual([["a_manual", "b_lims_lite", "c_context"], ["a_manual", "b_lims_lite", "c_context"]]);
  });
  it("Given two blocks Then each carries its schedule and its label from the config, its own seed count and its spread, and every paired row says how many seeds define it", () => {
    expect(report.blocks.map((b) => [b.export_schedule, b.controller_log_cut, b.n_seeds])).toEqual([["per_run", "per_row", 4], ["window_end", "daily", 4]]);
    for (const b of report.blocks) {
      expect(b.interval).toMatch(/not a confidence interval/);
      expect(b.label.length).toBeGreaterThan(10);
      for (const p of b.presets) expect(p.paired.every((r) => r.n_seeds === 4 && r.n_defined <= 4)).toBe(true);
    }
  });
  it("Given the truth run of each seed Then its log_hash is recorded once and equals an independent run: both cells of every pair, in both blocks, share it", () => {
    expect(SEEDS.map((s) => (report.truth_log_hashes as Record<string, string>)[String(s)])).toEqual(hashes);
  });
  it("Given the ingest metrics Then they are shown on the adapter side only in every block: the manual side reads not applicable, and none of the paired rows is an ingest metric", () => {
    for (const b of report.blocks) {
      for (const p of b.presets) {
        expect(p.ingest.manual.status).toBe("not_applicable");
        expect(p.ingest.adapter.seeds_reported).toBe(4);
        expect(p.paired.some((r) => /parse_failure|duplicates|ambiguous/.test(r.metric))).toBe(false);
      }
    }
  });
  it("Given the ingest metrics Then the adapter side also carries them per device class (S2e2 rework W1): each class over its own rows, the controller class far larger than the analyzer class, the clean-row guard per class, and the manual side stays not applicable", () => {
    for (const b of report.blocks) {
      for (const p of b.presets) {
        const { adapter, manual } = p.ingest;
        expect(manual.status).toBe("not_applicable");
        for (const cls of ["analyzer", "controller"] as const) {
          const c = adapter.by_class[cls];
          if (c.status !== "reported") throw new Error(`${p.preset}: the ${cls} class has no rows`);
          expect([c.seeds_reported, typeof c.rows_median, typeof c.clean_share_median]).toEqual([4, "number", "number"]);
        }
        const [a, c] = [adapter.by_class.analyzer, adapter.by_class.controller];
        if (a.status !== "reported" || c.status !== "reported") throw new Error("both classes have rows");
        expect(c.rows_median as number).toBeGreaterThan(a.rows_median as number);
        expect(adapter.rows_median).toBeGreaterThan(c.rows_median as number); // the total is over both classes
      }
    }
  });
  it("Given a paired row Then it is a difference with a spread and a count, and every share has its denominator on both sides", () => {
    for (const b of report.blocks) {
      const c = b.presets[2];
      expect(c?.paired.length).toBeGreaterThan(10);
      expect(c?.paired.every((r) => r.median === null || (r.lo !== null && r.hi !== null && r.lo <= r.median && r.median <= r.hi))).toBe(true);
      expect(c?.denominators.length).toBeGreaterThan(5);
      expect(c?.denominators.every((d) => d.text.length > 0 && d.manual !== null && d.adapter !== null)).toBe(true);
    }
  });
  it("Given the per_run block Then the paths differ in nothing but the path: the same requests are counted on both sides (the denominators are equal)", () => {
    for (const p of report.blocks[0]?.presets ?? []) expect(p.denominators.every((d) => d.manual === d.adapter)).toBe(true);
  });
  it("Given a report Then it is plain data, and two runs of the same input give the same text", async () => {
    const { config, input } = loadContrast(doc, { settings: SMALL }, SEEDS.slice(0, 2));
    const a = await runContrast(input, { experiment_id: config.experiment_id });
    const b = await runContrast(input, { experiment_id: config.experiment_id });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
