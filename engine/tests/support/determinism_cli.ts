// Child-process entry of the two-process determinism test: node engine/tests/support/determinism_cli.ts experiment1|experiment2
// Runs the experiment of data/scenarios/experiments/ on the first two seeds of its seed list (the lists are validated at their full length first, then cut, so the A103 minimum
// stays a rule of the real runs; the report of experiment 2 is built with the minimum set to 2 here only) and prints the report as canonical JSON. Nothing is written; the test compares the text of two processes.
// Run directly by Node (native type stripping), so it imports modules with explicit .ts extensions only.
import "./require_node_flags.ts"; // ADR-0016: exits 2 without the Node flags of the engine, before any engine module loads
import { runClosedLoop } from "../../src/experiments/assembly/closed_loop.ts";
import { buildClosedLoopReport } from "../../src/experiments/assembly/closed_loop_report.ts";
import { runOpenLoop } from "../../src/experiments/assembly/open_loop.ts";
import { buildReport } from "../../src/experiments/assembly/report.ts";
import { canonicalJson } from "../../src/trace.ts";
import { loadExperiment } from "./experiment1.ts";
import { loadClosedLoop } from "./experiment2.ts";
import { readJson } from "./paths.ts";

const which = process.argv[2];
if (which === "experiment1") {
  const { input, head } = loadExperiment(readJson("data", "scenarios", "experiments", "experiment1.json"));
  console.log(canonicalJson(buildReport(await runOpenLoop({ ...input, seeds: input.seeds.slice(0, 2) }), head)));
} else if (which === "experiment2") {
  const { input, head } = loadClosedLoop(readJson("data", "scenarios", "experiments", "experiment2.json"));
  // the report builder of experiment 2 refuses fewer seeds than the minimum (A103); here only, the minimum is set to the two seeds that are run
  console.log(canonicalJson(buildClosedLoopReport(runClosedLoop({ ...input, seeds: input.seeds.slice(0, 2) }), { ...head, min_seeds: 2 })));
} else {
  console.error("usage: node engine/tests/support/determinism_cli.ts experiment1|experiment2");
  process.exit(2);
}
