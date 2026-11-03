import { useEffect, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import type { ScenePlan } from "../protocol.ts";
import { Label, T } from "../ui/T.tsx";
import { logBetween } from "./events.ts";
import type { LogItem } from "./events.ts";
import type { Playback } from "./playback.ts";
import { useSlowClock } from "./usePlayback.ts";
import { clockOf } from "./view.ts";

// The live region of the text alternative (docs/design/plant_ui.md section 9): while the run plays it says the newest event of the last two seconds of the clock's wall time, one line, at most
// every two seconds, and a step to an event says that event. A switch turns the reading off (the last line stays). Before the first event it says what the text alternative says first: the plan
// is ready. Every id is a label, every word is in the dictionary in both languages.

const OUTCOMES = ["qc_passed", "qc_failed", "over_range", "over_range_unresolved"] as const;
const outcomeOf = (outcome: string | undefined): (typeof OUTCOMES)[number] | "none" => OUTCOMES.find((o) => o === outcome) ?? "none";

const lineOf = (item: LogItem): ComponentChildren => {
  const clock = clockOf(item.t);
  const parts: Record<string, ComponentChildren> = {
    clock: <T k="plant.clock.reading" parts={{ day: <Label>{clock.day}</Label>, time: <Label>{clock.time}</Label> }} />,
    ...(item.unit !== undefined && { unit: <Label>{item.unit}</Label> }),
    ...(item.sample !== undefined && { sample: <Label>{item.sample}</Label> }),
    ...(item.operator !== undefined && { operator: <Label>{item.operator}</Label> }),
    ...(item.analyzer !== undefined && { analyzer: <Label>{item.analyzer}</Label> }),
    ...(item.key === "finished" && { outcome: <T k={`plant.log.outcome.${outcomeOf(item.outcome)}`} /> }),
    // a break-out case (P7c): the lot or the item, and what the lab reported for a test
    ...(item.item !== undefined && { item: <Label>{item.item}</Label> }),
    ...(item.key === "confirmed" && { test: <Label>{item.test ?? ""}</Label>, outcome: <T k={item.outcome === "detected" ? "plant.confirm.detected" : "plant.confirm.not_detected"} /> }),
  };
  // a draw with no operator in the log (it cannot happen for a drawn tube) reads as an unnamed one
  if (item.key === "drawn" && item.operator === undefined) parts.operator = <T k="plant.batch.none" />;
  return <T k={`plant.log.${item.key}`} parts={parts} />;
};

export function LiveLog({ plan, playback, ready }: { plan: ScenePlan; playback: Playback; ready: () => ComponentChildren }) {
  const clock = useSlowClock(playback, 2);
  const [on, setOn] = useState(true);
  const [shown, setShown] = useState<LogItem | null>(null);
  useEffect(() => {
    if (!on) return;
    const items = logBetween(plan, clock.t - (clock.playing ? 2 * clock.speed : 60), clock.t);
    const newest = items[items.length - 1];
    if (newest) setShown(newest);
  }, [clock, on, plan]);
  return (
    <>
      <p id="plant-live" role="status" aria-live="polite" data-plant-live={shown ? "event" : "ready"}>
        {shown ? lineOf(shown) : ready()}
      </p>
      <label class="plant-log-switch">
        <input type="checkbox" checked={on} onChange={(e) => setOn((e.currentTarget as HTMLInputElement).checked)} data-plant-log-switch /> <T k="plant.log.read" />
      </label>
    </>
  );
}
