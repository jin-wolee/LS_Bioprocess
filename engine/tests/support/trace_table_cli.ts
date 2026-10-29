// Prints the generated table of docs/design/single_sample_trace.md, or with --write replaces the block between the markers of the page (prompts/20 Step 10).
// The page is generated from tests/fixtures/trace/single_sample_trace.json and never edited by hand in the block; a test regenerates the block and fails on drift.
// Run directly by Node (native type stripping), so it imports modules with explicit .ts extensions only.
import "./require_node_flags.ts"; // ADR-0016: exits 2 without the Node flags of the engine, before any engine module loads
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./paths.ts";
import type { SingleSampleTrace } from "./trace_sample.ts";
import { traceTable, withTable } from "./trace_table.ts";

const trace = JSON.parse(readFileSync(join(ROOT, "tests", "fixtures", "trace", "single_sample_trace.json"), "utf8")) as SingleSampleTrace;
if (process.argv[2] === "--write") {
  const page = join(ROOT, "docs", "design", "single_sample_trace.md");
  writeFileSync(page, withTable(readFileSync(page, "utf8"), trace));
  console.log(`replaced the generated block of ${page}`);
} else console.log(traceTable(trace));
