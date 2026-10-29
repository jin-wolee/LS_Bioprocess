import type { ObservableEvent } from "../observe.ts";
import type { Architecture } from "../record/architecture.ts";
import { prevented } from "./catalogue.ts";
import type { MaterialisedError } from "./types.ts";

// Error types that follow from the stream and the flags, with no random draw (spec section 5 matrix, column "Invisible when" read as
// "materialised"). Each is realised on a drawn sample where its mechanism exists in the architecture.

/**
 * - feed_in_gap: a feed on the sample's unit after the draw and up to the first measurement ((sampled_at, measured_at]): the join by the
 *   measured time pairs post-feed context. A feed at the draw instant is before the draw.
 * - lost_rerun: the sample has a second attempt and the earlier version is overwritten.
 * - unattributable_record: no audit trail stores who drew the sample.
 * - planned_vs_actual: the plan's time is stored and the actual draw time is not (preset B).
 */
export const structural = (events: readonly ObservableEvent[], flags: Architecture["flags"]): MaterialisedError[] => {
  const planned = new Map<string, number>();
  const firstMeasured = new Map<string, number>();
  const attempts = new Map<string, number>();
  const feeds = new Map<string, number[]>();
  for (const e of events) {
    if (e.type === "sample_planned") planned.set(e.sample_id, e.t);
    else if (e.type === "result_measured") {
      if (!firstMeasured.has(e.request_id)) firstMeasured.set(e.request_id, e.t);
      attempts.set(e.request_id, Math.max(attempts.get(e.request_id) ?? 1, e.attempt));
    } else if (e.type === "process_event" && e.kind === "feed") feeds.set(e.unit_id, [...(feeds.get(e.unit_id) ?? []), e.t]);
  }
  const drawn = events.flatMap((e) => (e.type === "sample_drawn" ? [e] : []));
  const out: MaterialisedError[] = [];
  const each = (type: MaterialisedError["type"], detailOf: (e: (typeof drawn)[number]) => MaterialisedError["detail"] | null): void => {
    if (prevented(type, flags)) return;
    for (const e of drawn) {
      const detail = detailOf(e);
      if (detail !== null) out.push({ type, sample_id: e.sample_id, detail });
    }
  };
  each("feed_in_gap", (e) => {
    const measured = firstMeasured.get(e.sample_id);
    const feed = measured === undefined ? undefined : (feeds.get(e.unit_id) ?? []).find((t) => t > e.t && t <= measured);
    return feed === undefined ? null : { feed_at: feed };
  });
  each("lost_rerun", (e) => ((attempts.get(e.sample_id) ?? 1) >= 2 ? { attempts: attempts.get(e.sample_id) as number } : null));
  each("unattributable_record", () => ({}));
  each("planned_vs_actual", (e) => (planned.has(e.sample_id) ? { planned_at: planned.get(e.sample_id) as number, sampled_at: e.t } : null));
  return out;
};
