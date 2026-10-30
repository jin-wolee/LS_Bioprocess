import { inject } from "../../inject/inject.ts";
import type { ForcedError, MaterialisedError } from "../../inject/types.ts";
import type { ObservableEvent } from "../../observe.ts";
import type { Architecture } from "../../record/architecture.ts";
import type { ResultRow } from "../../record/types.ts";
import { resultKey } from "../../raw/quirks.ts";
import { physicalIds } from "./physical_ids.ts";

// 2026-10-30 S3d (lab_ui.md sections 5 and 9): a plant in the closed loop of experiment 2. The injector (forced mode: the errors named, no rate read, no draw) turns the observable stream of
// the lab run into the stream one architecture's recorder sees, and the assembly, which holds both streams, says which lab-run result each recorded pH row stands for. The arm values a row by
// that result, never by the id the row is filed under: a label error files the planted sample's row under its neighbour's id. This file reads no truth; it belongs to the assembly because the
// map it builds is the physical-id map of `physicalIds`.

/** The lab-run result a recorded pH row stands for: the physical sample and the id of its run in the lab run (`SharedResult.run_id`). */
export interface StandsFor {
  sample_id: string;
  run_id: string;
}

export interface PlantedStream {
  /** The stream this architecture's recorder sees. */
  events: ObservableEvent[];
  received_at: Record<string, number>;
  /** The injector's realised errors of this architecture (plain data). */
  materialised: MaterialisedError[];
  /** The result a recorded pH row of this stream stands for. */
  standsFor: (row: ResultRow) => StandsFor;
}

/**
 * A row carries the id it is filed under, its run id (that id, the attempt and the visit), the analyte, the instant and the value the recorder took from the event. The analyzer is not a
 * column, so two results of different samples that were filed under one id at the same second with the same value could not be told apart: the stream is refused then, never guessed.
 */
const keyOf = (run_id: string, analyte: string, t: number, value: number): string => `${run_id}/${analyte}/${t}/${value}`;

export const plantStream = (seed: number, architecture: Pick<Architecture, "id" | "flags">, events: readonly ObservableEvent[], forced: readonly ForcedError[]): PlantedStream => {
  const out = inject({ seed, architecture, events, forced });
  const physical = physicalIds(events, out.events);
  const stands = new Map<string, StandsFor | null>();
  for (const e of out.events) {
    if (e.type !== "result_measured" || e.analyte !== "ph") continue;
    const sample_id = physical[resultKey(e)] as string;
    const key = keyOf(`${e.request_id}/${e.attempt}/${e.visit}`, e.analyte, e.t, e.value);
    const seen = stands.get(key);
    stands.set(key, seen === undefined || seen?.sample_id === sample_id ? { sample_id, run_id: `${sample_id}/${e.attempt}/${e.visit}` } : null);
  }
  const standsFor = (row: ResultRow): StandsFor => {
    const at = stands.get(keyOf(row.run_id, row.analyte, row.measured_at, row.value));
    if (at === undefined) throw new Error(`closed loop: the recorded pH row ${row.result_id} is made from no result event of the injected stream`);
    if (at === null) throw new Error(`closed loop: two results of different samples were filed under ${row.request_id} at the same instant with the same value; the row ${row.result_id} cannot be told from the other`);
    return at;
  };
  return { events: out.events, received_at: out.received_at, materialised: out.materialised, standsFor };
};
