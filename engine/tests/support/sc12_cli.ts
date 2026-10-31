// Runner of SC12, the break-out experiment (spec 11.5 and 11.8): node --no-maglev-escape-analysis engine/tests/support/sc12_cli.ts <report.json>
// Runs the seed list of scenarios/experiments/sc12.json through every case and the thirteen architectures, builds the report, validates it against schemas/breakout_report.schema.json and writes it
// to the path given on the command line. Prints the timing, the inputs of each case and a compact table. The report is not committed (it is not under version control), and nothing here ranks or
// judges: SC12 is reported and never gated. Run directly by Node (native type stripping), so it imports modules with explicit .ts extensions only.
import "./require_node_flags.ts"; // ADR-0016: exits 2 without the Node flags of the engine, before any engine module loads
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { runBreakout } from "../../src/experiments/assembly/breakout.ts";
import { buildBreakoutReport } from "../../src/experiments/assembly/breakout_report.ts";
import type { BreakoutReport } from "../../src/generated/breakout_report.schema";
import { canonicalJson } from "../../src/trace.ts";
import { makeEvalAjv, validates } from "./eval_schemas.ts";
import { readJson } from "./paths.ts";
import { loadSc12 } from "./sc12.ts";

const out = process.argv[2];
if (!out) {
  console.error("usage: node --no-maglev-escape-analysis engine/tests/support/sc12_cli.ts <path of the report to write>");
  process.exit(2);
}

const { config, input, head } = loadSc12(readJson("scenarios", "experiments", "sc12.json"));
const started = performance.now();
const result = await runBreakout(input);
const ran = performance.now();
const report = buildBreakoutReport(result, head);
const ajv = makeEvalAjv();
if (!validates(ajv, "breakout_report", report)) {
  console.error(`the report does not validate: ${JSON.stringify(ajv.errors)}`);
  process.exit(1);
}
writeFileSync(resolve(out), `${canonicalJson(report, 2)}\n`);
console.log(`${config.seeds.length} seeds x ${config.cases.length} cases x ${input.architectures.length} architectures: ${((ran - started) / 1000).toFixed(1)} s to run, ${((performance.now() - ran) / 1000).toFixed(2)} s to build and validate the report; written to ${resolve(out)}`);
console.log(`review: timing ${report.review.timing}, rejected also: ${report.review.reject_also.join(", ") || "none"}`);
console.log(report.mycoplasma_note);

type Row = BreakoutReport["cases"][number]["architectures"][number]["rows"][number];
const fmt = (r: Row | undefined): string => {
  if (!r) return "-";
  if (r.status === "none_occurred") return "undefined";
  const n = (x: number | null) => (x === null ? "-" : Number.isInteger(x) ? String(x) : x.toFixed(2));
  return `${n(r.median)} [${n(r.lo)}, ${n(r.hi)}]${r.n_defined < r.n_seeds ? ` (${r.n_defined}/${r.n_seeds})` : ""}`;
};
const COLUMNS: [string, string][] = [
  ["d1 recall", "identification.direction_1.recall"], ["d1 prec", "identification.direction_1.precision"], ["d1 FA", "identification.direction_1.false_alarm"],
  ["d3 recall", "identification.direction_3.recall"], ["d3 prec", "identification.direction_3.precision"], ["d3 FA", "identification.direction_3.false_alarm"],
  ["released before", "released_before_containment"], ["retro-flag", "retro_flag_completeness"], ["batch contained", "containment.batch.contained"],
];
for (const c of report.cases) {
  console.log(`\n${c.case_id} (${c.scenario_id}; ${c.event.type} through ${c.event.origin_kind} ${c.event.origin_id}): median [5th, 95th percentile] across ${report.n_seeds} seeds`);
  console.log(`  inputs: ${c.inputs.map((i) => `${i.name} ${i.value} ${i.unit} (${i.ref})`).join("; ")}`);
  console.log(`  ${"architecture".padEnd(42)} | ${COLUMNS.map(([l]) => l).join(" | ")}`);
  for (const a of c.architectures) console.log(`  ${a.id.padEnd(42)} | ${COLUMNS.map(([, m]) => fmt(a.rows.find((r) => r.metric === m))).join(" | ")}`);
}
