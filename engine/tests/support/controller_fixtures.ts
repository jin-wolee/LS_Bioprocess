import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { anchorEpoch } from "../../src/calendar.ts";
import type { ControllerProfile } from "../../src/generated/controller_profile.schema";
import { controllerEntry } from "../../src/ingest/controller_entry.ts";
import type { ControllerBelief } from "../../src/ingest/controller_entry.ts";
import type { ControllerParseOutput } from "../../src/ingest/controller_parse.ts";
import { parseControllerFile } from "../../src/ingest/controller_parse.ts";
import { newStore } from "../../src/ingest/store.ts";
import { ROOT, readJson } from "./paths.ts";

// The hand-made controller fixtures (tests/fixtures/raw/<family>/<name>.csv with a sibling <name>.expected.json) and a runner that parses one of them under the belief of a case.
// The expected rows are typed by hand in the JSON from the design (data_model 16.3 to 16.5); nothing is produced by running the emitter or the parser. Instants are seconds of
// the scenario with day 0 the synthetic Monday 2030-01-07, so 09:00:00 is 32400.

export const ANCHOR = "2030-01-07";
export const CONTROLLER_FAMILIES = ["ctrl_neutral", "ctrl_bench"] as const;
export const CONTROLLER_FIXTURES = join(ROOT, "tests", "fixtures", "raw");
export const profileOf = (id: string): ControllerProfile => readJson<ControllerProfile>("scenarios", "profiles", "controller", `${id}.json`);

export interface ControllerCase {
  name: string;
  file_name: string;
  controller: string;
  received_at: number;
  belief?: Omit<ControllerBelief, "controller">;
  flags?: { ingest_idempotency?: boolean };
  /** Fixture files parsed first, into the same store. */
  after?: string[];
  /** Physical lines of the fixture to delete before parsing (a log that starts mid-instance). */
  drop_lines?: number[];
  expect: Record<string, unknown>;
}

export const controllerCases = (family: string, name: string): ControllerCase[] =>
  (JSON.parse(readFileSync(join(CONTROLLER_FIXTURES, family, `${name}.expected.json`), "utf8")) as { cases: ControllerCase[] }).cases;

export const controllerFixtureFiles = (): { family: string; name: string }[] =>
  CONTROLLER_FAMILIES.flatMap((family) => readdirSync(join(CONTROLLER_FIXTURES, family)).filter((f) => f.endsWith(".csv")).map((f) => ({ family, name: f.replace(/\.csv$/, "") })));

export const controllerText = (family: string, name: string): string => readFileSync(join(CONTROLLER_FIXTURES, family, `${name}.csv`), "utf8");

export interface ControllerParsed {
  outputs: ControllerParseOutput[];
  last: ControllerParseOutput;
}

/** Parse the fixture under the case's belief, after the files the case names (same store, raw_file_id RF1, RF2, ...). */
export const runControllerCase = (family: string, name: string, c: ControllerCase): ControllerParsed => {
  const entry = controllerEntry(profileOf(family), { controller: c.controller, ...c.belief });
  const store = newStore();
  const outputs: ControllerParseOutput[] = [];
  for (const base of [...(c.after ?? []), name]) {
    const text = base === name && c.drop_lines ? controllerText(family, base).split("\n").filter((_l, i) => !(c.drop_lines as number[]).includes(i + 1)).join("\n") : controllerText(family, base);
    outputs.push(parseControllerFile(text, { entry, file_name: c.file_name, raw_file_id: `RF${outputs.length + 1}`, received_at: c.received_at, anchor_epoch_s: anchorEpoch(ANCHOR), flags: { ingest_idempotency: c.flags?.ingest_idempotency ?? true }, store }));
  }
  return { outputs, last: outputs[outputs.length - 1] as ControllerParseOutput };
};

/** The canonical records of the three controller targets, flattened to the names the fixtures use. */
export const flatHistorian = (o: ControllerParseOutput): Record<string, unknown>[] =>
  o.historian.map((r) => ({ line: r.envelope.raw_ref.line_no, ...r.payload, ingested_at: r.envelope.received_at, state: r.state, source_event_id: r.envelope.source_event_id }));
export const flatAlarms = (o: ControllerParseOutput): Record<string, unknown>[] =>
  o.alarms.map((r) => ({ line: r.envelope.raw_ref.line_no, ...r.payload, ingested_at: r.envelope.received_at, state: r.state, source_event_id: r.envelope.source_event_id }));
export const flatPhases = (o: ControllerParseOutput): Record<string, unknown>[] =>
  o.phases.map((r) => ({ line: r.envelope.raw_ref.line_no, ...r.payload, ingested_at: r.envelope.received_at, state: r.state, source_event_id: r.envelope.source_event_id }));
