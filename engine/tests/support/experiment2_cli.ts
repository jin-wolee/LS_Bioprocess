// Runner of experiment 2 (prompts/20 Step 4, SC8): node engine/tests/support/experiment2_cli.ts <report.json>
// Runs the seed list of scenarios/experiments/experiment2.json through the closed loop (oracle, A, B, C and the sensitivity variants), builds the report, validates it against
// schemas/closed_loop_report.schema.json and writes it to the path given on the command line. Prints the timing and a compact summary. The report is not committed.
// Run directly by Node (native type stripping), so it imports modules with explicit .ts extensions only.
import "./require_node_flags.ts"; // ADR-0016: exits 2 without the Node flags of the engine, before any engine module loads
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { runClosedLoop } from "../../src/experiments/assembly/closed_loop.ts";
import { buildClosedLoopReport } from "../../src/experiments/assembly/closed_loop_report.ts";
import { canonicalJson } from "../../src/trace.ts";
import { makeEvalAjv, validates } from "./eval_schemas.ts";
import { loadClosedLoop } from "./experiment2.ts";
import { readJson } from "./paths.ts";

const out = process.argv[2];
if (!out) {
  console.error("usage: node engine/tests/support/experiment2_cli.ts <path of the report to write>");
  process.exit(2);
}

const { config, input, head } = loadClosedLoop(readJson("scenarios", "experiments", "experiment2.json"));
const started = performance.now();
const result = runClosedLoop(input);
const ran = performance.now();
const report = buildClosedLoopReport(result, head);
const ajv = makeEvalAjv();
if (!validates(ajv, "closed_loop_report", report)) {
  console.error(`the report does not validate: ${JSON.stringify(ajv.errors)}`);
  process.exit(1);
}
writeFileSync(resolve(out), `${canonicalJson(report, 2)}\n`);
console.log(`${config.seeds.length} seeds x ${report.arms.length} arms: ${((ran - started) / 1000).toFixed(1)} s to run, ${((performance.now() - ran) / 1000).toFixed(2)} s to build and validate the report; written to ${resolve(out)}`);
console.log(`${report.n_seeds} seeds, ${report.n_reactor_pairs} reactor pairs; ${report.result_text}`);
const f = (x: number): string => x.toFixed(5);
for (const metric of ["offset_mean_abs", "excursion_mean_abs", "excursion_max_abs"]) {
  console.log(`\n${metric} (pH): median [p05, p95] across seeds; paired difference against the oracle, mean [95 percent bootstrap interval]`);
  for (const a of report.arms) {
    const m = a.metrics.find((x) => x.metric === metric);
    if (!m) continue;
    const p = m.paired ? `${f(m.paired.mean)} [${f(m.paired.lo)}, ${f(m.paired.hi)}]` : "reference";
    console.log(`  ${a.id.padEnd(20)} ${f(m.median)} [${f(m.p05)}, ${f(m.p95)}]   ${p}`);
  }
}
console.log("\nreadjustment slots (summed over reactors and seeds)");
for (const a of report.arms) console.log(`  ${a.id.padEnd(20)} slots ${a.counts.slots}, readjusted ${a.counts.readjusted}, skipped (known bias) ${a.counts.skipped_known_bias}, no new value ${a.counts.no_new_result}; offline values held ${a.counts.values}, extrapolated beyond the validity of their stability effect ${a.counts.extrapolated}`);
