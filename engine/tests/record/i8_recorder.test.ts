import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Event } from "../../src/generated/event.schema";
import { observeEvents, observeSensors } from "../../src/observe.ts";
import type { ObservableEvent } from "../../src/observe.ts";
import { FLAG_NAMES } from "../../src/record/architecture.ts";
import { record } from "../../src/record/recorder.ts";
import type { RecordedDataset, RecorderInput } from "../../src/record/types.ts";
import type { ScenarioRun } from "../../src/run.ts";
import { canonicalJson } from "../../src/trace.ts";
import { readJson } from "../support/paths.ts";
import { SMALL, runOf } from "../support/scenarios.ts";
import type { Json } from "../support/schemas.ts";
import { arch } from "../support/record_fixture.ts";

// I8 against the real recorder (S2a): perturbing hidden fields, the sensor truth included, leaves the recorder output byte-identical.
// The hidden fields are read from the `x-visibility: hidden` annotations of data/schemas/event.schema.json, not from observe.ts.

const hiddenTable = (): Map<string, string[]> => {
  const defs = (readJson<Json>("data", "schemas", "event.schema.json").$defs ?? {}) as Record<string, Json>;
  const table = new Map<string, string[]>();
  for (const def of Object.values(defs)) {
    const props = def.properties as Record<string, Json> | undefined;
    const type = (props?.type as Json | undefined)?.const;
    if (!props || typeof type !== "string") continue;
    const hidden = Object.entries(props).filter(([, p]) => p["x-visibility"] === "hidden").map(([k]) => k);
    if (hidden.length > 0) table.set(type, hidden);
  }
  return table;
};

const perturb = (v: unknown): unknown =>
  typeof v === "number" ? v + 1.5 : typeof v === "boolean" ? !v : typeof v === "string" ? `${v}!` : v && typeof v === "object" ? { perturbed: true } : v;

/** A fingerprint of the whole recorded dataset: the tables as canonical JSON, the sensor columns as the bytes of their values. */
const fingerprint = (ds: RecordedDataset): string => {
  const h = createHash("sha256");
  h.update(canonicalJson({ ...ds, historian: { late: ds.historian.late, series: ds.historian.series.map((s) => Object.fromEntries(Object.entries(s).filter(([k]) => k !== "pv"))) } })); // every key but the values, so an extra key (a truth array) shows
  for (const s of ds.historian.series) {
    const pv = s.pv as Float64Array;
    h.update(Buffer.from(pv.buffer, pv.byteOffset, pv.byteLength));
  }
  return h.digest("hex");
};

const inputOf = (run: ScenarioRun): RecorderInput => ({ events: observeEvents(run.events), sensors: run.observableSensors });
const PRESETS = [arch(), arch("system_issued_id", "ingest_idempotency", "audit_trail"), arch(...FLAG_NAMES)];

describe("I8 on the recorder: hidden fields never reach a recorded row", () => {
  const seeds = [1, 2, 3];
  const runs = seeds.map((seed) => runOf("default", { settings: SMALL, seed }));
  const hidden = hiddenTable();

  const perturbedTruth = (run: ScenarioRun): Event[] =>
    run.events.map((e) => {
      const copy: Record<string, unknown> = { ...e };
      for (const f of hidden.get(e.type) ?? []) copy[f] = perturb(copy[f]);
      return copy as unknown as Event;
    });

  it("Given the runs of three seeds Then the perturbation changes the truth events (it is not vacuous) and the recorder input has no hidden field", () => {
    for (const run of runs) {
      const changed = perturbedTruth(run).filter((e, i) => JSON.stringify(e) !== JSON.stringify(run.events[i]));
      expect(changed.length).toBeGreaterThan(100);
      const seen = new Set<string>();
      for (const e of inputOf(run).events) for (const f of hidden.get(e.type) ?? []) if (f in e) seen.add(`${e.type}.${f}`);
      expect([...seen]).toEqual([]);
    }
  });

  it.each(PRESETS.map((p) => [p.id, p] as const))("Given hidden event fields perturbed When recorded under %s Then the dataset is byte-identical (through observe)", (_id, cfg) => {
    runs.forEach((run) => {
      const base = fingerprint(record(inputOf(run), cfg));
      const view = observeEvents(perturbedTruth(run));
      expect(fingerprint(record({ events: view, sensors: run.observableSensors }, cfg))).toBe(base);
    });
  });

  it.each(PRESETS.map((p) => [p.id, p] as const))("Given the hidden fields still present on the events handed over When recorded under %s Then the recorder ignores them (it reads none)", (_id, cfg) => {
    runs.forEach((run) => {
      const base = fingerprint(record(inputOf(run), cfg));
      const raw = perturbedTruth(run) as unknown as ObservableEvent[]; // not observed: true_value, noise, true_state and the rest are still there
      expect(fingerprint(record({ events: raw, sensors: run.observableSensors }, cfg))).toBe(base);
    });
  });

  it.each(PRESETS.map((p) => [p.id, p] as const))("Given the sensor truth perturbed When recorded under %s Then the dataset is byte-identical, also with the truth array left on the series", (_id, cfg) => {
    runs.forEach((run) => {
      const base = fingerprint(record(inputOf(run), cfg));
      const shifted = run.sensors.map((s) => ({ ...s, truth: s.truth.map((v) => v + 1.5) }));
      expect(shifted.some((s, i) => s.truth[0] !== run.sensors[i]?.truth[0])).toBe(true);
      expect(fingerprint(record({ events: observeEvents(run.events), sensors: observeSensors(shifted) }, cfg))).toBe(base);
      expect(fingerprint(record({ events: observeEvents(run.events), sensors: shifted as never }, cfg))).toBe(base);
    });
  });

  it("Given a visible field changed (the measured value, the process value) Then the dataset changes: the check can fail", () => {
    const run = runs[0] as ScenarioRun;
    const cfg = arch(...FLAG_NAMES);
    const base = fingerprint(record(inputOf(run), cfg));
    const events = observeEvents(run.events).map((e) => (e.type === "result_measured" ? { ...e, value: e.value + 1 } : e));
    expect(fingerprint(record({ events, sensors: run.observableSensors }, cfg))).not.toBe(base);
    const sensors = run.observableSensors.map((s) => ({ ...s, pv: Float64Array.from(s.pv as Float64Array, (v) => v + 1) }));
    expect(fingerprint(record({ events: observeEvents(run.events), sensors }, cfg))).not.toBe(base);
  });

  it("Given the same input twice Then the dataset is byte-identical, and the recorder does not write into its input", () => {
    const run = runs[1] as ScenarioRun;
    const input = inputOf(run);
    const before = canonicalJson(input.events) + fingerprint({ ...record(input, arch()), historian: { series: input.sensors, late: [] } });
    const a = fingerprint(record(input, arch(...FLAG_NAMES)));
    expect(fingerprint(record(input, arch(...FLAG_NAMES)))).toBe(a);
    expect(canonicalJson(input.events) + fingerprint({ ...record(input, arch()), historian: { series: input.sensors, late: [] } })).toBe(before);
  });

  it("Given a recorded run Then the dataset has rows in every table the flags fill (the fingerprint covers something)", () => {
    const ds = record(inputOf(runs[0] as ScenarioRun), arch(...FLAG_NAMES));
    for (const t of ["sample", "run", "instrument_state", "result", "batch", "process_event"] as const) expect(ds[t].length, t).toBeGreaterThan(0);
    expect(ds.historian.series.length).toBeGreaterThan(0);
  });
});
