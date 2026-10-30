// The reference of the lab's browser check (docs/design/lab_ui.md section 7): node engine/tests/support/lab_reference_cli.ts <reference.json to write> [--summaries=<folder>]
// Recomputes in Node, under the engine's flag (ADR-0016), the strict log hash of the default scenario for seeds 1 to 3 and the digest of the metric cells of seed 1 under A, B and C.
// It REFUSES (exit 1, nothing written) unless the three truth hashes equal the log_hash of tests/golden/default_seed{1,2,3}.summary.json, so a stale or miscompiled build cannot ship a
// wrong reference. It never writes a golden. `npm run build:lab` runs it before Vite; the page fetches the file at start-up.
// Run directly by Node (native type stripping), so it imports modules with explicit .ts extensions only.
import "./require_node_flags.ts"; // ADR-0016: exits 2 without the Node flags of the engine, before any engine module loads
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { CHECK_SEEDS, computeReference, makeDeps } from "../../src/experiments/assembly/lab/check.ts";
import { canonicalJson } from "../../src/trace.ts";
import { labData } from "./lab_data.ts";
import { writeText } from "./lab_files.ts";
import { ROOT } from "./paths.ts";

const out = process.argv[2];
if (!out || out.startsWith("--")) {
  console.error("usage: node engine/tests/support/lab_reference_cli.ts <path of reference.json to write> [--summaries=<folder>]");
  process.exit(2);
}
const goldens = resolve(process.argv.slice(3).find((a) => a.startsWith("--summaries="))?.slice("--summaries=".length) ?? join(ROOT, "tests", "golden"));

const refuse = (why: string): never => {
  console.error(`refused: ${why}`);
  process.exit(1);
};

// The goldens first: a missing or unreadable one is known before the runs start.
const expected = new Map<number, string>();
for (const seed of CHECK_SEEDS) {
  const file = join(goldens, `default_seed${seed}.summary.json`);
  if (!existsSync(file)) refuse(`the golden summary of seed ${seed} is missing: ${file}`);
  const hash = (JSON.parse(readFileSync(file, "utf8")) as { log_hash?: unknown }).log_hash;
  if (typeof hash !== "string") refuse(`the golden summary of seed ${seed} has no log_hash`);
  expected.set(seed, hash as string);
}

const started = performance.now();
const reference = await computeReference(makeDeps(labData(), () => performance.now()), { version: process.version, flags: process.execArgv });
for (const row of reference.truth) {
  if (row.log_hash !== expected.get(row.seed)) {
    refuse(`seed ${row.seed}: the log hash computed here (${row.log_hash}) differs from the golden (${expected.get(row.seed)}); the engine or the runtime changed the bytes, so no reference is written`);
  }
}
writeText(out, `${canonicalJson(reference, 2)}\n`);
console.log(`reference for engine ${reference.engine_version} on node ${reference.node.version}: seeds ${CHECK_SEEDS.join(", ")} equal the goldens; cell digest of seed ${reference.cells.seed} ${reference.cells.digest.slice(0, 12)}; ${((performance.now() - started) / 1000).toFixed(1)} s`);
