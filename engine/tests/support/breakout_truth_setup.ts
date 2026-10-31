import { breakoutMetrics } from "../../src/evaluate/breakout_metrics.ts";
import type { BreakoutMetrics } from "../../src/evaluate/breakout_metrics.ts";
import type { Truth } from "../../src/evaluate/truth.ts";
import { truthFrom } from "../../src/evaluate/truth.ts";
import { keyFile } from "../../src/experiments/assembly/key_file.ts";
import type { Event } from "../../src/generated/event.schema";
import type { ObservableEvent } from "../../src/observe.ts";
import type { InvestigationConfig } from "../../src/record/investigate/investigate.ts";
import type { BreakoutInput } from "../../src/record/types.ts";
import { H } from "./breakout_streams.ts";
import { truthEvents } from "./eval_fixture.ts";
import { CFG, run } from "./investigate_setup.ts";
import type { Name } from "./investigate_setup.ts";

// The truth side of the hand-built break-out fixtures (spec 11.8.4, break-out batch 6): the observable stream of FX12a, FX12e or FX12m plus the hidden `contamination_onset` events that the engine
// would log, and the topology master data. Test-only values, typed from the fixture texts: the onset hours and the origin come from the "Hand-derived truth" rows of 11.8.4.

export interface Onset {
  unit: string;
  hours: number;
  kind: "seed_lot" | "medium_lot" | "shared_equipment" | "unit_equipment" | "sampling";
  origin: string;
}

/** The truth of a hand-built stream: every event with its hidden fields, the onsets, and the topology. */
export const truthOf = (events: readonly ObservableEvent[], master: BreakoutInput, onsets: readonly Onset[], type = "bacterial"): Truth => {
  const hidden: Event[] = onsets.map((o) => ({ type: "contamination_onset", t: H(o.hours), unit_id: o.unit, batch_id: `B-${o.unit}`, contamination_type: type, origin_kind: o.kind, origin_id: o.origin }));
  const log = [...truthEvents(events), ...hidden].map((e, i) => ({ e, i })).sort((a, b) => a.e.t - b.e.t || a.i - b.i).map((x) => x.e);
  return { ...truthFrom(log, { visits: {}, deadlines: {}, operators: [], analyzers: ["AN-1"] }), breakout: master };
};

/** An answer key with no realised error, for the architecture of the cell. */
export const emptyKey = (architecture: string): string => keyFile({ engine_version: "0.1.0", scenario_id: "fx", seed: 7 }, { [architecture]: { materialised: [], not_modelled: [] } });

/** The break-out metrics of a hand-built stream recorded and investigated under one of the five configurations. */
export const metricsOf = (events: readonly ObservableEvent[], master: BreakoutInput, onsets: readonly Onset[], n: Name, cfg: InvestigationConfig = CFG): BreakoutMetrics =>
  breakoutMetrics({ truth: truthOf(events, master, onsets), investigation: run(events, master, n, cfg), key_text: emptyKey(n), architecture: n });
