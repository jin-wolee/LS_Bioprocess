// The recorded command that creates the single-sample trace fixture (prompts/20 Step 10): node engine/tests/support/trace_cli.ts
// It runs SC3 (seed 1) through A, B and C with the production assembly, picks the sample by the rule of trace_sample.ts, writes tests/fixtures/trace/single_sample_trace.json and
// registers its checksum in tests/fixtures/trace/CHECKSUMS.txt. It refuses to run when the fixture exists: the fixture is read-only after this command and is never regenerated.
// Run directly by Node (native type stripping), so it imports modules with explicit .ts extensions only.
import "./require_node_flags.ts"; // ADR-0016: exits 2 without the Node flags of the engine, before any engine module loads
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runSeed } from "../../src/experiments/assembly/run_seed.ts";
import { canonicalJson } from "../../src/trace.ts";
import { CONFIGS } from "./cells.ts";
import { ROOT } from "./paths.ts";
import { inputOf } from "./sc_run.ts";
import { runOf } from "./scenarios.ts";
import { SCENARIO, buildTrace } from "./trace_sample.ts";

const dir = join(ROOT, "tests", "fixtures", "trace");
const file = join(dir, "single_sample_trace.json");
if (existsSync(file)) {
  console.error(`${file} exists: the trace fixture is created once and read-only afterwards; a change needs the author's approval recorded in docs/progress.md`);
  process.exit(1);
}
const run = runOf(SCENARIO.id, { seed: SCENARIO.seed });
const [a, b, c] = CONFIGS.slice(0, 3).map((x) => x.config);
const out = runSeed(inputOf(run, SCENARIO.id, [a, b, c] as NonNullable<typeof a>[], SCENARIO.days));
const text = `${canonicalJson(buildTrace(run, out.datasets, out.key_text), 2)}\n`;
mkdirSync(dir, { recursive: true });
writeFileSync(file, text);
writeFileSync(join(dir, "CHECKSUMS.txt"), `${createHash("sha256").update(text).digest("hex")}  single_sample_trace.json\n`);
console.log(`wrote ${file}`);
