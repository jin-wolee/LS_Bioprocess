// Runner of the capture-path contrast (prompts/20 Step 6): node engine/tests/support/contrast_cli.ts <report.json>
// Runs the seed list of scenarios/experiments/capture_contrast.json (SC1 with the raw layer on, A, B and C each on manual_transcription and on adapter_ingest, paired by seed) and
// writes the report to the path given on the command line. Stochastic, reported and never gated; the report is not committed. Run directly by Node (native type stripping),
// so it imports modules with explicit .ts extensions only.
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { runContrast } from "../../src/experiments/assembly/capture_contrast.ts";
import { canonicalJson } from "../../src/trace.ts";
import { loadContrast } from "./contrast.ts";
import { readJson } from "./paths.ts";

const out = process.argv[2];
if (!out) {
  console.error("usage: node engine/tests/support/contrast_cli.ts <path of the report to write>");
  process.exit(2);
}
const { config, input } = loadContrast(readJson("scenarios", "experiments", "capture_contrast.json"));
const started = performance.now();
const report = await runContrast(input, { experiment_id: config.experiment_id });
writeFileSync(resolve(out), `${canonicalJson(report, 2)}\n`);
console.log(`${report.n_seeds} seeds x ${input.presets.length} presets x ${input.blocks.length} schedules x 2 paths: ${((performance.now() - started) / 1000).toFixed(1)} s; written to ${resolve(out)}`);
const SHOWN = ["exact_reconstruction", "misattribution.misattributed", "availability", "attributable"];
for (const block of report.blocks) {
  console.log(`block ${block.export_schedule}: ${block.label} (${block.n_seeds} seeds; ${block.interval})`);
  for (const p of block.presets) {
    console.log(`  ${p.preset}: ingest metrics manual ${p.ingest.manual.status}; adapter reported in ${p.ingest.adapter.seeds_reported} of ${block.n_seeds} seeds, parse failure median ${String(p.ingest.adapter.parse_failure_median)}`);
    for (const r of p.paired.filter((x) => SHOWN.some((s) => x.metric.includes(s)))) console.log(`    ${r.metric}: adapter minus manual, median ${String(r.median)} [${String(r.lo)}, ${String(r.hi)}], ${r.n_defined} of ${r.n_seeds} seeds`);
  }
}
