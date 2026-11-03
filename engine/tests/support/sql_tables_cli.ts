// Writes the canonical tables of one dataset as CSV files for the acceptance tests of the author's SQL (docs/prompts/20 Step 12; tests/user_track/test_queries.py):
//   node engine/tests/support/sql_tables_cli.ts <output directory> scenario   the default scenario at the small size (six reactors, eight days), seed 1, architecture C
//   node engine/tests/support/sql_tables_cli.ts <output directory> sc4        the noise-free fixture of SC4 (a bias of +0.5 on AN-2 only), architecture C
// One <table>.csv per table (header = column names, a null is an empty cell, times as 'YYYY-MM-DD hh:mm:ss'), plus facts.json with the numbers the test needs for its own expectations.
// Run directly by Node (native type stripping), so it imports modules with explicit .ts extensions only.
import "./require_node_flags.ts"; // ADR-0016: exits 2 without the Node flags of the engine, before any engine module loads
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { toCsv } from "../../src/export/csv.ts";
import { observeEvents } from "../../src/observe.ts";
import { record } from "../../src/record/recorder.ts";
import { assemble } from "./sc_run.ts";
import { BASE, byTime, calibration, inoculation, sampleWithRun } from "./cell_stream.ts";
import { CONFIGS } from "./cells.ts";
import { runOf, SMALL } from "./scenarios.ts";
import { canonicalTables, iso } from "./sql_tables.ts";
import type { Table } from "./sql_tables.ts";

const [dir, which] = [process.argv[2], process.argv[3]];
if (!dir || (which !== "scenario" && which !== "sc4")) {
  console.error("usage: node engine/tests/support/sql_tables_cli.ts <output directory> scenario|sc4");
  process.exit(2);
}
const C = (CONFIGS.find((c) => c.name === "C") as (typeof CONFIGS)[number]).config;

let tables: Record<string, Table>;
let facts: Record<string, unknown>;
if (which === "scenario") {
  const run = runOf("default", { seed: 1, settings: SMALL });
  const out = assemble(run, "default", [C], SMALL.horizon_days as number);
  const ds = out.datasets[C.id];
  if (!ds) throw new Error("no dataset for C");
  tables = canonicalTables(ds, observeEvents(run.events));
  facts = { architecture: C.id, anchor: iso(0), horizon_s: (SMALL.horizon_days as number) * 86400 };
} else {
  // SC4 between analyzers (engine/tests/sc04.test.ts, BETWEEN): bay 1 on AN-1, bay 2 on AN-2, AN-2 reads +0.5; the control pair B1 (AN-1, 4.0) and B2 (AN-2, 4.5) shares CTL-1.
  const events = byTime([
    ...BASE, calibration("AN-2"), inoculation("U1"), inoculation("U2"),
    ...sampleWithRun("S1", "U1", 1000, 500, 4.0, { analyzer: "AN-1" }), ...sampleWithRun("S2", "U1", 2000, 500, 6.0, { analyzer: "AN-1" }),
    ...sampleWithRun("S3", "U2", 3000, 500, 4.5, { analyzer: "AN-2" }), ...sampleWithRun("S4", "U2", 4000, 500, 5.5, { analyzer: "AN-2" }),
    ...sampleWithRun("B1", "U1", 5000, 500, 4.0, { analyzer: "AN-1" }), ...sampleWithRun("B2", "U1", 5001, 500, 4.5, { analyzer: "AN-2" }),
  ]);
  const ds = record({ events, sensors: [], plan: { controls: { B1: "CTL-1", B2: "CTL-1" } } }, C);
  tables = canonicalTables(ds, events);
  facts = { architecture: C.id, anchor: iso(0), injected_bias: 0.5, true_values: { S1: 4.0, S2: 6.0, S3: 4.0, S4: 5.0 } };
}
mkdirSync(resolve(dir), { recursive: true });
for (const [name, rows] of Object.entries(tables)) {
  const cols = Object.keys(rows[0] ?? {});
  writeFileSync(join(resolve(dir), `${name}.csv`), toCsv(cols.map((c) => ({ name: c, type: "string" as const, required: false })), rows));
}
writeFileSync(join(resolve(dir), "facts.json"), `${JSON.stringify({ ...facts, columns: Object.fromEntries(Object.entries(tables).map(([n, r]) => [n, Object.keys(r[0] ?? {})])) }, null, 2)}\n`);
console.log(`wrote ${Object.keys(tables).length} tables to ${resolve(dir)}`);
