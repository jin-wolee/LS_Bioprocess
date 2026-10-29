import type { ObservableEvent } from "../../src/observe.ts";

// Observable streams for the injector tests (S2b). Test-only values.

/**
 * `n` samples S1..Sn, drawn 10 s apart from 1000 s, on units U1..U3 in turn, by the operators in turn. Only the draw-side events: the
 * tests of the opportunity draws and of the coupling need the samples, not their runs.
 */
export const bulk = (n: number, operators: readonly string[] = ["OP-1"]): ObservableEvent[] =>
  Array.from({ length: n }, (_, i) => {
    const id = `S${i + 1}`;
    const unit_id = `U${(i % 3) + 1}`;
    const batch_id = `B-${unit_id}`;
    const t = 1000 + i * 10;
    return [
      { type: "sample_planned", t: t - 100, sample_id: id, unit_id, batch_id },
      { type: "sample_drawn", t, sample_id: id, unit_id, batch_id, operator_id: operators[i % operators.length] as string, volume_ul: 200 },
      { type: "label_bound", t, sample_id: id, method: "handwritten" },
      { type: "sample_received", t: t + 300, sample_id: id },
    ] satisfies ObservableEvent[];
  }).flat();
