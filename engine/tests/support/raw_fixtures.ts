import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { anchorEpoch } from "../../src/calendar.ts";
import type { Dialect } from "../../src/generated/dialect.schema";
import { adapterEntry } from "../../src/ingest/adapters/entry.ts";
import type { AdapterEntry, Belief } from "../../src/ingest/adapters/entry.ts";
import type { ParseOutput } from "../../src/ingest/canonical.ts";
import { parseFile } from "../../src/ingest/parse.ts";
import { newStore } from "../../src/ingest/store.ts";
import type { IngestStore } from "../../src/ingest/store.ts";
import { ROOT, readJson } from "./paths.ts";

// The hand-made raw fixtures (tests/fixtures/raw/<dialect>/<name>.csv with a sibling <name>.expected.json) and a runner that parses one of them under the belief of a case.
// The expected records are typed by hand in the JSON from the dialect description; nothing is produced by running the emitter or the parser. Instants are seconds of the
// scenario with day 0 the synthetic Monday 2030-01-07, so 09:10:00 is 33000.

export const ANCHOR = "2030-01-07";
export const FIXTURES = join(ROOT, "tests", "fixtures", "raw");
export const dialectOf = (id: string): Dialect => readJson<Dialect>("scenarios", "profiles", "dialect", `${id}.json`);

export interface FixtureCase {
  name: string;
  instrument: string;
  required_analytes: string[];
  run_s?: number;
  received_at: number;
  belief?: Partial<Omit<Belief, "instrument" | "required_analytes">>;
  unit_map_extra?: Record<string, { ucum: string; dimension: string }>;
  flags?: { ingest_idempotency?: boolean; append_only_versions?: boolean };
  after?: string[];
  expect: Record<string, unknown>;
}

export const casesOf = (dialect: string, name: string): FixtureCase[] =>
  (JSON.parse(readFileSync(join(FIXTURES, dialect, `${name}.expected.json`), "utf8")) as { cases: FixtureCase[] }).cases;

/** The analyzer dialects; the controller families have their own fixtures and runner (controller_fixtures.ts). */
const ANALYZER_DIALECTS = ["allinone_csv", "counter_csv", "cds_table"];

export const fixtureFiles = (): { dialect: string; name: string }[] =>
  readdirSync(FIXTURES).filter((dialect) => ANALYZER_DIALECTS.includes(dialect)).flatMap((dialect) => readdirSync(join(FIXTURES, dialect)).filter((f) => f.endsWith(".csv")).map((f) => ({ dialect, name: f.replace(/\.csv$/, "") })));

export const textOf = (dialect: string, name: string): string => readFileSync(join(FIXTURES, dialect, `${name}.csv`), "utf8");

export interface Parsed {
  entry: AdapterEntry;
  store: IngestStore;
  /** The outputs in the order parsed: the `after` files first, then the fixture. */
  outputs: ParseOutput[];
  last: ParseOutput;
}

/** Parse the fixture under the case's belief, after the files the case names (same store, raw_file_id RF1, RF2, ...). */
export const runCase = (dialect: string, name: string, c: FixtureCase): Parsed => {
  const entry = adapterEntry(dialectOf(dialect), { instrument: c.instrument, required_analytes: c.required_analytes, run_s: c.run_s ?? 0, ...c.belief });
  Object.assign(entry.unit_map, c.unit_map_extra ?? {});
  const store = newStore();
  const outputs: ParseOutput[] = [];
  for (const base of [...(c.after ?? []), name]) {
    outputs.push(parseFile(textOf(dialect, base), {
      entry, file_name: `${base}.csv`, raw_file_id: `RF${outputs.length + 1}`, received_at: c.received_at, anchor_epoch_s: anchorEpoch(ANCHOR),
      flags: { ingest_idempotency: true, append_only_versions: true, ...c.flags }, store,
    }));
  }
  return { entry, store, outputs, last: outputs[outputs.length - 1] as ParseOutput };
};

/** A canonical record flattened to the names the fixtures use. */
export const flat = (r: ParseOutput["records"][number]): Record<string, unknown> => ({
  line: r.envelope.raw_ref.line_no, ...r.payload, state: r.state, source_event_id: r.envelope.source_event_id, idempotency_key: r.envelope.idempotency_key, event_time: r.envelope.event_time,
});
