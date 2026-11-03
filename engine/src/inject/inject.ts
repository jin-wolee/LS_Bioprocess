import type { ObservableEvent } from "../observe.ts";
import { prevented } from "./catalogue.ts";
import { rekey, relabel, replay, skewClocks } from "./edits.ts";
import { drawOpportunities } from "./opportunities.ts";
import { notModelled } from "./rates.ts";
import { structural } from "./structural.ts";
import { ERROR_TYPES } from "./types.ts";
import type { DrawnType, ForcedError, InjectInput, InjectResult, MaterialisedError } from "./types.ts";

// Fair by construction (docs/prompts/20 Step 2): the opportunities do not depend on the architecture (opportunities.ts); an architecture
// materialises one when u < rate(type, architecture, staff), the rate being 0 where the mechanism cannot exist (catalogue.ts); coupling
// is monotone because the draw is compared with the rate and never re-drawn. Forced mode (fixtures) bypasses the rate, not the mechanism.
// A replayed file is the one exception to "prevented means the stream is untouched": it is a source event, common to all architectures.
// The injector never reads truth and never imports the answer key: it returns the materialised errors as plain data.

const ADDED = (type: DrawnType, e: { sample_id: string }, detail: MaterialisedError["detail"]): MaterialisedError => ({ type, sample_id: e.sample_id, detail });

export const inject = (input: InjectInput): InjectResult => {
  const flags = input.architecture.flags;
  const drawn = input.events.flatMap((e) => (e.type === "sample_drawn" ? [e] : []));
  const unitOf = new Map(drawn.map((e) => [e.sample_id, e.unit_id]));
  const chosen: MaterialisedError[] = [];
  // A replayed file is an event of the source: the stream carries it in every architecture and the flag decides its effect (a no-op logged as
  // VR-008 information where ingest_idempotency is on, a double count where it is off). Only the realised one is in the key.
  const replays: string[] = [];

  if (input.forced) {
    for (const f of input.forced as readonly ForcedError[]) {
      if (f.type === "duplicate_replay") replays.push(f.sample_id);
      if (prevented(f.type, flags)) continue;
      if (f.type === "label_error") {
        if (!f.detail?.as_id) throw new Error(`forced label_error on ${f.sample_id} needs detail.as_id`);
        chosen.push(ADDED(f.type, f, { as_id: f.detail.as_id }));
      } else if (f.type === "unit_rekey") {
        if (!f.detail?.to_unit) throw new Error(`forced unit_rekey on ${f.sample_id} needs detail.to_unit`);
        chosen.push(ADDED(f.type, f, { from_unit: unitOf.get(f.sample_id) ?? "", to_unit: f.detail.to_unit }));
      } else chosen.push(ADDED(f.type, f, {}));
    }
  } else if (!prevented("label_error", flags)) {
    // production: only label errors have a ledger rate; the content of a mix-up is the neighbouring tube (the next draw, else the previous one)
    drawn.forEach((e, i) => {
      const rate = input.label_rate_by_operator?.[e.operator_id];
      if (rate === undefined) throw new Error(`no label-error rate for operator ${e.operator_id}`);
      const u = drawOpportunities(input.seed, e.sample_id).find((o) => o.type === "label_error")?.u as number;
      const neighbour = drawn[i + 1]?.sample_id ?? drawn[i - 1]?.sample_id;
      if (u < rate && neighbour !== undefined) chosen.push(ADDED("label_error", e, { as_id: neighbour }));
    });
  }

  let events: ObservableEvent[] = [...input.events];
  for (const m of chosen.filter((c) => c.type === "unit_rekey")) events = rekey(events, m.sample_id, m.detail.to_unit as string);
  for (const m of chosen.filter((c) => c.type === "label_error")) events = relabel(events, m.sample_id, m.detail.as_id as string);
  for (const id of replays) events = replay(events, id);

  const offsets = input.clock_offsets ?? {};
  const clock: MaterialisedError[] = [];
  for (const e of input.events) {
    if (e.type !== "result_measured" || !(offsets[e.analyzer] ?? 0) || clock.some((c) => c.sample_id === e.request_id)) continue;
    clock.push({ type: "clock_offset", sample_id: e.request_id, detail: { analyzer: e.analyzer, offset_s: offsets[e.analyzer] as number } });
  }
  const skewed = skewClocks(events, offsets);

  const materialised = [...chosen, ...clock, ...structural(input.events, flags)].sort((a, b) => ERROR_TYPES.indexOf(a.type) - ERROR_TYPES.indexOf(b.type));
  return { events: skewed.events, received_at: skewed.received_at, materialised, not_modelled: input.forced ? [] : notModelled(input.clock_offsets) };
};
