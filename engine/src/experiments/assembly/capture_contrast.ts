import { NOT_APPLICABLE } from "../../evaluate/raw_metrics.ts";
import { denominatorsOf, flatten } from "../../evaluate/aggregate.ts";
import type { EvaluationSettings } from "../../evaluate/config.ts";
import { quantile } from "../../evaluate/stats.ts";
import type { Metrics } from "../../generated/metrics.schema";
import type { Params, Profile } from "../../profiles.ts";
import type { Dialect } from "../../raw/types.ts";
import type { Architecture } from "../../record/architecture.ts";
import { runScenario } from "../../run.ts";
import type { ScenarioConfig } from "../../scenario.ts";
import { ENGINE_VERSION, logHash } from "../../trace.ts";
import { checkSeeds } from "./config.ts";
import { rosterOf, seedInputFromRun } from "./from_run.ts";
import { entryConfigFor, rawSetupFor } from "./raw_setup.ts";
import { runSeed } from "./run_seed.ts";

// The capture-path contrast (spec section 5, "Automatic linkage alone"; prompts/20 Step 6): one scenario with the raw layer on and one seed list, each preset run on each path
// with the truth run, the flags and the labelling method unchanged, paired by seed (common random numbers: the same truth run and the same keyed draws). Per spec section 8
// metric it reports the median and the spread across seeds of the paired difference (adapter_ingest minus manual_transcription) with the seed count and the denominators. The
// ingest metrics of spec section 2.4.7 exist on one side only: manual_transcription reads "not applicable" and no difference is ever formed with it. Stochastic and never
// gated: nothing here asserts a sign, a size or an ordering of the two paths.
//
// The export schedule (A216) decides when a file reaches the host, and the manual path has no entry delay (spec 2.4.8), so a contrast that lets the schedule differ changes two settings
// at once. The report therefore has blocks, each with its schedule named in the config before any run. The first block, per_run, holds the timing fixed (each result reaches the
// host at the instant it is produced on both paths), so only the path changes: that is linkage alone. A later block, window_end, is a timing sensitivity and is labelled as one.

const DAY = 86400;
const PATHS = ["manual_transcription", "adapter_ingest"] as const;
type Path = (typeof PATHS)[number];
export type Schedule = "window_end" | "per_run";

export interface ContrastBlockConfig {
  label: string;
  export_schedule: Schedule;
}

export interface ContrastConfig {
  experiment_id: string;
  /** The scenario file name without extension; the runner switches its raw layer on with the settings below. */
  scenario: string;
  presets: string[];
  seeds: number[];
  calendar_anchor: string;
  device_zone_h: { value: number; unit: string; ref: string };
  /** The blocks of the report, in order; the first is the headline (per_run: only the path changes). */
  blocks: ContrastBlockConfig[];
}

const KEYS = ["schema_version", "experiment_id", "description", "scenario", "presets", "seeds", "calendar_anchor", "device_zone_h", "blocks"];

export const parseContrastConfig = (raw: unknown, minSeeds: number): ContrastConfig => {
  const doc = raw as Record<string, unknown> | null;
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) throw new Error("contrast config: the document must be an object");
  for (const k of Object.keys(doc)) if (!KEYS.includes(k)) throw new Error(`contrast config: unknown key ${k}`);
  if (doc.schema_version !== "1") throw new Error('contrast config: schema_version must be "1"');
  const text = (v: unknown, what: string): string => (typeof v === "string" && v !== "" ? v : ((): never => { throw new Error(`contrast config: ${what} must be a non-empty string`); })());
  if (!Array.isArray(doc.presets) || doc.presets.length === 0) throw new Error("contrast config: presets must be a non-empty list");
  if (!Array.isArray(doc.blocks) || doc.blocks.length === 0) throw new Error("contrast config: blocks must be a non-empty list (each names its export schedule)");
  const blocks = doc.blocks.map((b: Record<string, unknown>): ContrastBlockConfig => {
    if (b.export_schedule !== "window_end" && b.export_schedule !== "per_run") throw new Error(`contrast config: a block's export_schedule must be window_end or per_run, got ${String(b.export_schedule)}`);
    return { label: text(b.label, "a block label"), export_schedule: b.export_schedule };
  });
  if (blocks[0]?.export_schedule !== "per_run") throw new Error("contrast config: the first block is the headline and holds the schedule at per_run, so that only the path changes");
  if (new Set(blocks.map((b) => b.export_schedule)).size !== blocks.length) throw new Error("contrast config: a schedule is named by one block only");
  return {
    experiment_id: text(doc.experiment_id, "experiment_id"), scenario: text(doc.scenario, "scenario"), presets: doc.presets.map((p) => text(p, "a preset")),
    seeds: checkSeeds(doc.seeds, minSeeds), calendar_anchor: text(doc.calendar_anchor, "calendar_anchor"), device_zone_h: doc.device_zone_h as ContrastConfig["device_zone_h"], blocks,
  };
};

export interface ContrastInput {
  /** The scenario with the raw layer on and no capture_path override. */
  scenario: ScenarioConfig;
  seeds: readonly number[];
  presets: readonly Architecture[];
  blocks: readonly ContrastBlockConfig[];
  analyzer: Profile;
  dialects: Readonly<Record<string, Dialect>>;
  staff: Params;
  evaluation: EvaluationSettings;
  review: Parameters<typeof seedInputFromRun>[1]["review"];
}

export interface PairedRow {
  metric: string;
  n_seeds: number;
  /** Seeds for which the metric is defined on both sides. */
  n_defined: number;
  median: number | null;
  lo: number | null;
  hi: number | null;
}

export interface ContrastPreset {
  preset: string;
  /** adapter_ingest minus manual_transcription, per seed, then the median and the 5th to 95th percentile across seeds. */
  paired: PairedRow[];
  /** The denominator of each share: its wording and its count (median over seeds) on each side. */
  denominators: { metric: string; text: string; manual: number | null; adapter: number | null }[];
  /** The ingest metrics: shown on the adapter side only; the manual side reads "not applicable" and no difference exists. */
  ingest: { manual: typeof NOT_APPLICABLE; adapter: { seeds_reported: number; parse_failure_median: number | null; duplicates_none_occurred_seeds: number; ambiguous_none_occurred_seeds: number; quarantined_median: number | null; held_median: number | null } };
}

export interface ContrastBlock {
  label: string;
  export_schedule: Schedule;
  /** Each block carries its own seed count and spread. */
  n_seeds: number;
  interval: string;
  presets: ContrastPreset[];
}

export interface ContrastReport {
  experiment_id: string;
  scenario_id: string;
  engine_version: string;
  seeds: number[];
  n_seeds: number;
  min_seeds: number;
  meets_min_seeds: boolean;
  /** The truth log_hash per seed, identical in both cells of every pair of every block (a difference stops the run). */
  truth_log_hashes: Record<string, string>;
  blocks: ContrastBlock[];
}

const median = (xs: readonly number[]): number | null => quantile(xs, 0.5);
const INTERVAL = "spread across seeds: the 5th to the 95th percentile, nearest rank; not a confidence interval";

interface Ingest {
  reported: number;
  failure: number[];
  dupNone: number;
  ambNone: number;
  quarantined: number[];
  held: number[];
}

export const runContrast = async (input: ContrastInput, head: { experiment_id: string }): Promise<ContrastReport> => {
  const raw = input.scenario.raw;
  if (!raw) throw new Error("capture contrast: the scenario has the raw layer off");
  const hashes: Record<string, string> = {};
  const cell = (b: number, p: string): string => `${b}|${p}`;
  const cells = new Map<string, Record<Path, Metrics>[]>();
  const ingest = new Map<string, Ingest>();
  for (const [b] of input.blocks.entries()) {
    for (const p of input.presets) {
      cells.set(cell(b, p.id), []);
      ingest.set(cell(b, p.id), { reported: 0, failure: [], dupNone: 0, ambNone: 0, quarantined: [], held: [] });
    }
  }
  for (const seed of input.seeds) {
    const run = runScenario({ ...input.scenario, seed });
    const before = await logHash(run.events);
    hashes[String(seed)] = before;
    for (const [b, block] of input.blocks.entries()) {
      for (const preset of input.presets) {
        const pair = {} as Record<Path, Metrics>;
        const draws: Record<string, string> = {};
        for (const path of PATHS) {
          const out = runSeed(seedInputFromRun(run, {
            scenario_id: input.scenario.scenario_id, staff: input.staff, evaluation: input.evaluation, architectures: [preset], days: input.scenario.process.horizon_s / DAY, review: input.review,
            raw: rawSetupFor({ ...raw, capture_path: path, export_schedule: block.export_schedule }, input.analyzer, input.dialects, rosterOf(input.scenario.sampling)), entry_rules: entryConfigFor(input.analyzer, input.dialects),
          }));
          pair[path] = out.cells[0] as Metrics;
          const r = out.raw?.[preset.id];
          draws[path] = JSON.stringify((JSON.parse(r?.key_text ?? "{}") as { opportunities?: unknown }).opportunities);
          if (path === "adapter_ingest" && r?.metrics && r.metrics.status === "reported") {
            const m = r.metrics;
            const acc = ingest.get(cell(b, preset.id)) as Ingest;
            acc.reported += 1;
            if (m.parse_failure.status === "reported") acc.failure.push(m.parse_failure.num / m.parse_failure.den);
            if (m.duplicates.status === "none_occurred") acc.dupNone += 1;
            if (m.ambiguous.status === "none_occurred") acc.ambNone += 1;
            acc.quarantined.push(m.stage.quarantined);
            acc.held.push(m.stage.held);
          }
        }
        if (draws.manual_transcription !== draws.adapter_ingest) throw new Error(`capture contrast: the opportunity draws of seed ${seed}, block ${b}, preset ${preset.id} differ between the paths`);
        cells.get(cell(b, preset.id))?.push(pair);
      }
    }
    if ((await logHash(run.events)) !== before) throw new Error(`capture contrast: the truth log of seed ${seed} changed while the paths were recorded`);
  }
  return {
    experiment_id: head.experiment_id, scenario_id: input.scenario.scenario_id, engine_version: ENGINE_VERSION, seeds: [...input.seeds], n_seeds: input.seeds.length,
    min_seeds: input.evaluation.min_seeds, meets_min_seeds: input.seeds.length >= input.evaluation.min_seeds, truth_log_hashes: hashes,
    blocks: input.blocks.map((block, b): ContrastBlock => ({
      label: block.label, export_schedule: block.export_schedule, n_seeds: input.seeds.length, interval: INTERVAL,
      presets: input.presets.map((p): ContrastPreset => {
        const pairs = cells.get(cell(b, p.id)) as Record<Path, Metrics>[];
        const diffs = new Map<string, number[]>();
        for (const pair of pairs) {
          const a = new Map(flatten(pair.adapter_ingest.metrics));
          for (const [metric, m] of flatten(pair.manual_transcription.metrics)) {
            const v = a.get(metric);
            if (m !== null && v !== undefined && v !== null) diffs.set(metric, [...(diffs.get(metric) ?? []), v - m]);
          }
        }
        const den = (side: Path) => denominatorsOf(pairs.map((x) => x[side]));
        const manual = den("manual_transcription");
        const adapter = den("adapter_ingest");
        const i = ingest.get(cell(b, p.id)) as Ingest;
        return {
          preset: p.id,
          paired: [...diffs].map(([metric, xs]) => ({ metric, n_seeds: pairs.length, n_defined: xs.length, median: median(xs), lo: quantile(xs, 0.05), hi: quantile(xs, 0.95) })),
          denominators: [...manual].map(([metric, d]) => ({ metric, text: d.text, manual: median(d.counts), adapter: median(adapter.get(metric)?.counts ?? []) })),
          ingest: { manual: NOT_APPLICABLE, adapter: { seeds_reported: i.reported, parse_failure_median: median(i.failure), duplicates_none_occurred_seeds: i.dupNone, ambiguous_none_occurred_seeds: i.ambNone, quarantined_median: median(i.quarantined), held_median: median(i.held) } },
        };
      }),
    })),
  };
};
