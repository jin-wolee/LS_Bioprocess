import type { ObservableEvent } from "../../observe.ts";
import { resultKey } from "../../raw/quirks.ts";
import type { PhysicalIds } from "../../raw/quirks.ts";

// The physical sample of each result event of the injected stream (S2f F2). The experiment assembly holds the stream before the injector (the label of every event is its physical
// sample) and the stream after it. The injector changes the label of some events, moves the stamps of an instrument with a wrong clock and repeats the result events of a replayed
// sample in place (inject/edits.ts), and nothing else on the result events, so the two streams line up result by result and the physical sample is the label of the matching event
// before. The raw and inject layers take the map as plain data and never import truth.

type Measured = Extract<ObservableEvent, { type: "result_measured" }>;

const resultsOf = (events: readonly ObservableEvent[]): Measured[] => events.filter((e): e is Measured => e.type === "result_measured");

export const physicalIds = (before: readonly ObservableEvent[], after: readonly ObservableEvent[]): PhysicalIds => {
  const pre = resultsOf(before);
  const ids: Record<string, string> = {};
  let at = -1;
  let last: Measured | undefined;
  for (const e of resultsOf(after)) {
    // a replayed sample repeats each of its result events right after the event: the copy is the same analysis (no two analyses of one stream are equal in every field)
    if (last === undefined || JSON.stringify(last) !== JSON.stringify(e)) at += 1;
    const src = pre[at];
    if (!src || src.analyzer !== e.analyzer || src.attempt !== e.attempt || src.visit !== e.visit || src.analyte !== e.analyte) {
      throw new Error(`physical ids: the result ${resultKey(e)} has no counterpart in the stream before the injector; the second stream is not the injected form of the first`);
    }
    ids[resultKey(e)] = src.request_id;
    last = e;
  }
  if (at !== pre.length - 1) throw new Error(`physical ids: ${pre.length} result events before the injector and ${at + 1} after it (without replayed copies); the second stream is not the injected form of the first`);
  return ids;
};
