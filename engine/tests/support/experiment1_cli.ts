// Runner of experiment 1 (prompts/20 Step 4): node engine/tests/support/experiment1_cli.ts <report.json>
// Runs the seed list of scenarios/experiments/experiment1.json through every architecture, validates the report against schemas/experiment_report.schema.json
// and writes it to the path given on the command line. Prints the timing and a compact summary. The report is not committed (it is not under version control).
// Run directly by Node (native type stripping), so it imports modules with explicit .ts extensions only.
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { runOpenLoop } from "../../src/experiments/assembly/open_loop.ts";
import { buildReport } from "../../src/experiments/assembly/report.ts";
import { canonicalJson } from "../../src/trace.ts";
import { loadExperiment } from "./experiment1.ts";
import { makeEvalAjv, validates } from "./eval_schemas.ts";
import { readJson } from "./paths.ts";
import { detectionLines, summaryLines } from "./report_summary.ts";

const out = process.argv[2];
if (!out) {
  console.error("usage: node engine/tests/support/experiment1_cli.ts <path of the report to write>");
  process.exit(2);
}

const { config, input, head } = loadExperiment(readJson("scenarios", "experiments", "experiment1.json"));
const started = performance.now();
const result = await runOpenLoop(input);
const ran = performance.now();
const report = buildReport(result, head);
const ajv = makeEvalAjv();
if (!validates(ajv, "experiment_report", report)) {
  console.error(`the report does not validate: ${JSON.stringify(ajv.errors)}`);
  process.exit(1);
}
writeFileSync(resolve(out), `${canonicalJson(report, 2)}\n`);
console.log(`${config.seeds.length} seeds x ${input.architectures.length} architectures: ${((ran - started) / 1000).toFixed(1)} s to run, ${((performance.now() - ran) / 1000).toFixed(2)} s to build and validate the report; written to ${resolve(out)}`);
console.log(summaryLines(report).join("\n"));
for (const id of ["a_manual", "b_lims_lite", "c_context"]) console.log(detectionLines(report, id).join("\n"));
