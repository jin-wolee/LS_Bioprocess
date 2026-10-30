import { beforeAll, describe, expect, it } from "vitest";
import type { Event } from "../../src/generated/event.schema";
import { TRUTH_ONLY_TYPES, observe, observeEvents } from "../../src/observe.ts";
import { parseArchitecture } from "../../src/record/architecture.ts";
import { record } from "../../src/record/recorder.ts";
import type { ScenarioRun } from "../../src/run.ts";
import { canonicalJson, canonicalJsonl } from "../../src/trace.ts";
import { readJson } from "../support/paths.ts";
import { docOf, fx12a, runOfDoc } from "./support.ts";

// Spec 11.8.2 rule S6: `contamination_onset` exists only in the truth log. `observe()` drops its type, and changing it (or any other hidden field) leaves the observable stream and the
// recorder output byte-identical (section 3, rule 1).

const preset = (name: string) => parseArchitecture(readJson("scenarios", "architectures", `${name}.json`));
const recorded = (run: ScenarioRun, events: readonly Event[], arch: string): string =>
  canonicalJson({ ...record({ events: observeEvents(events), sensors: run.observableSensors }, preset(arch)), historian: null }); // the series are the engine's own arrays in both

describe("Truth-only event: contamination_onset", () => {
  let run: ScenarioRun;
  beforeAll(() => {
    run = runOfDoc(docOf(fx12a()));
  });

  it("Given the truth log of FX12a When it is observed Then contamination_onset is gone and every observable break-out event is still there", () => {
    expect(run.events.some((e) => e.type === "contamination_onset")).toBe(true);
    expect(run.observable.some((e) => e.type === "contamination_onset")).toBe(false);
    const types = new Set(run.observable.map((e) => e.type));
    for (const t of ["signal_observed", "deviation_opened", "confirm_sample_drawn", "confirm_result"]) expect(types.has(t), t).toBe(true);
    expect(run.observable.length).toBe(run.events.length - 1);
  });

  it("Given the schema marks the event hidden as a whole When TRUTH_ONLY_TYPES is read Then it is exactly the event definitions annotated x-visibility hidden at their own level", () => {
    const defs = readJson<{ $defs: Record<string, { "x-visibility"?: string; properties?: { type?: { const?: string } } }> }>("schemas", "event.schema.json").$defs;
    const annotated = Object.values(defs).filter((d) => d["x-visibility"] === "hidden").map((d) => d.properties?.type?.const).sort();
    expect(annotated).toEqual(["contamination_onset"]);
    expect([...TRUTH_ONLY_TYPES].sort()).toEqual(annotated);
  });

  it("Given every contamination_onset is rewritten (other unit, other instant, other origin) When the log is observed and recorded under A and C Then the observable stream and the recorded datasets are byte-identical", () => {
    const changed: Event[] = run.events.map((e) =>
      e.type === "contamination_onset" ? { ...e, unit_id: "U03", batch_id: "B-U03", t: e.t + 7, origin_kind: "sampling", origin_id: "U03-D01-1", contamination_type: "other" } as Event : e);
    expect(changed).not.toEqual(run.events);
    expect(canonicalJsonl(observe(changed))).toBe(canonicalJsonl(run.observable));
    for (const arch of ["a_manual", "c_context"]) expect(recorded(run, changed, arch), arch).toBe(recorded(run, run.events, arch));
  });

  it("Given the true state of every drawn sample is rewritten (the other hidden fields) When the log is recorded Then the dataset is byte-identical too", () => {
    const changed: Event[] = run.events.map((e) => (e.type === "sample_drawn" ? { ...e, true_state: Object.fromEntries(Object.keys(e.true_state).map((k) => [k, -1])) } as Event : e));
    expect(changed).not.toEqual(run.events);
    expect(recorded(run, changed, "c_context")).toBe(recorded(run, run.events, "c_context"));
  });

  it("Given an observable field of the break-out is rewritten (the signal instant) When the log is recorded Then the observable stream does change (the test can see a change)", () => {
    const changed: Event[] = run.events.map((e) => (e.type === "signal_observed" ? { ...e, t: e.t + 60 } as Event : e));
    expect(canonicalJsonl(observe(changed))).not.toBe(canonicalJsonl(run.observable));
  });

  it("Given a recorder meets the new observable events When it records Then it ignores what it has no row for and records the process events of the script in every architecture", () => {
    const ds = record({ events: observeEvents(run.events), sensors: run.observableSensors }, preset("a_manual"));
    expect(ds.process_event.filter((r) => r.kind === "unit_stopped").map((r) => [r.unit_id, r.occurred_at])).toEqual([["U01", 68_400]]);
    expect(ds.process_event.filter((r) => r.kind === "medium_addition").length).toBe(4);
  });
});
