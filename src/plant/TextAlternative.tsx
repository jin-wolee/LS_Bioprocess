import { useMemo } from "preact/hooks";
import { Label, T } from "../ui/T.tsx";
import type { ScenePlan } from "../protocol.ts";
import { BoardTable } from "./BoardList.tsx";
import { LiveLog } from "./LiveLog.tsx";
import type { Playback } from "./playback.ts";
import { sceneAt } from "./scene_at.ts";
import { useSlowClock } from "./usePlayback.ts";
import { clockOf, hallRowsAt, onDuty } from "./view.ts";

// The text alternative of the scene (docs/design/plant_ui.md section 9): a description of the layout; "the plant as a table" at the clock instant (the reactors with their status, the analyzers with
// their queue and lamp, the record halls with their cards shown and knowable), which follows the clock about once a second of wall time while it plays and at once when it is paused or sought; and a polite live region
// with the log of events. It is built from the plan alone, so it is the whole plant when WebGL is missing (then the clock stays at the plan's start). Every number is a label.

export function TextAlternative({ plan, playback }: { plan: ScenePlan; playback: Playback }) {
  const shown = useSlowClock(playback, 1);
  const at = Math.floor(shown.t);
  const state = useMemo(() => sceneAt(plan, at), [plan, at]);
  const clock = clockOf(at);
  // elements are made fresh for each place a text uses them: a vnode is drawn once
  const clockPart = () => <T k="plant.clock.reading" parts={{ day: <Label>{clock.day}</Label>, time: <Label>{clock.time}</Label> }} />;
  const staff = onDuty(plan, at);
  const counts = () => ({ bays: <Label>{plan.layout.bays.length}</Label>, reactors: <Label>{plan.units.length}</Label>, analyzers: <Label>{plan.analyzers.length}</Label>, halls: <Label>{plan.records.length}</Label> });
  return (
    <section id="plant-text" class="plant-text" aria-labelledby="plant-text-heading">
      <T as="h2" k="plant.text.heading" id="plant-text-heading" />
      <T as="p" k="plant.text.layout" parts={counts()} />
      <T as="h3" k="plant.log.heading" />
      <LiveLog plan={plan} playback={playback} ready={() => <T k="plant.text.live" parts={{ ...counts(), clock: clockPart() }} />} />
      <T as="h3" k="plant.text.at" parts={{ clock: clockPart() }} />
      {staff.length === 0 ? <T as="p" k="plant.text.staff.none" /> : <T as="p" k="plant.text.staff" parts={{ staff: <Label>{staff.join(", ")}</Label> }} />}

      <div class="plant-table-wrap">
        <table class="plant-table" data-plant-table="reactors">
          <T as="caption" k="plant.table.reactors" />
          <thead>
            <tr>
              <T as="th" k="plant.col.reactor" />
              <T as="th" k="plant.col.bay" />
              <T as="th" k="plant.col.batch" />
              <T as="th" k="plant.col.status" />
            </tr>
          </thead>
          <tbody>
            {plan.units.map((u, i) => (
              <tr key={u.id} data-object-row={`reactor:${u.id}`}>
                <td>
                  <Label>{u.id}</Label>
                </td>
                <td>
                  <Label>{u.bay}</Label>
                </td>
                <td>{u.batch === null ? <T k="plant.batch.none" /> : <Label>{u.batch}</Label>}</td>
                <T as="td" k={`plant.status.${(state.vessels[i] as { lamp: "idle" | "running" | "harvested" | "stopped" }).lamp}`} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div class="plant-table-wrap">
        <table class="plant-table" data-plant-table="analyzers">
          <T as="caption" k="plant.table.analyzers" />
          <thead>
            <tr>
              <T as="th" k="plant.col.analyzer" />
              <T as="th" k="plant.col.profile" />
              <T as="th" k="plant.col.group" />
              <T as="th" k="plant.col.queue" />
              <T as="th" k="plant.col.lamp" />
            </tr>
          </thead>
          <tbody>
            {plan.analyzers.map((a, i) => (
              <tr key={a.id} data-object-row={`analyzer:${a.id}`}>
                <td>
                  <Label>{a.id}</Label>
                </td>
                <td>
                  <Label>{a.profile}</Label>
                </td>
                <td>
                  <Label>{a.group}</Label>
                </td>
                <td>
                  <Label>{(state.analyzers[i] as { queue: number }).queue}</Label>
                </td>
                <T as="td" k={`plant.lamp.${(state.analyzers[i] as { lamp: "idle" | "setup" | "run" | "qc" | "maintenance" | "closed" }).lamp}`} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div class="plant-table-wrap">
        <table class="plant-table" data-plant-table="halls">
          <T as="caption" k="plant.table.halls" />
          <thead>
            <tr>
              <T as="th" k="plant.col.hall" />
              <T as="th" k="plant.col.flags" />
              <T as="th" k="plant.col.cards" />
              <T as="th" k="plant.col.knowable" />
            </tr>
          </thead>
          <tbody>
            {hallRowsAt(plan, at).map((h) => (
              <tr key={h.architecture} data-object-row={`hall:${h.architecture}`}>
                <td>
                  <Label>{h.architecture}</Label>
                </td>
                <td>
                  <Label>{h.flags}</Label>
                </td>
                <td>
                  <Label>{h.cards}</Label>
                </td>
                <td>
                  <Label>{h.knowable}</Label>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <BoardTable plan={plan} at={at} />
    </section>
  );
}
