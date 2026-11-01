import { Label, T } from "../ui/T.tsx";
import type { ScenePlan } from "../protocol.ts";
import { analyzerRowsAt, clockOf, hallRowsAt, onDuty, statusOf } from "./view.ts";

// The text alternative of the scene (docs/design/plant_ui.md section 9), at the plan's start: a description of the layout; "the plant as a table" at the clock instant (the reactors with their status,
// the analyzers with their queue and lamp, the record halls with their cards); and a polite live region that says the plan is ready. It is built from the plan alone, so it is the whole plant when
// WebGL is missing. The log of events in the live region comes with the clock of P4. Every number is a label.

export function TextAlternative({ plan, at }: { plan: ScenePlan; at: number }) {
  const clock = clockOf(at);
  // elements are made fresh for each place a text uses them: a vnode is drawn once
  const clockPart = () => <T k="plant.clock.reading" parts={{ day: <Label>{clock.day}</Label>, time: <Label>{clock.time}</Label> }} />;
  const staff = onDuty(plan, at);
  const counts = () => ({ bays: <Label>{plan.layout.bays.length}</Label>, reactors: <Label>{plan.units.length}</Label>, analyzers: <Label>{plan.analyzers.length}</Label>, halls: <Label>{plan.records.length}</Label> });
  return (
    <section id="plant-text" class="plant-text" aria-labelledby="plant-text-heading">
      <T as="h2" k="plant.text.heading" id="plant-text-heading" />
      <T as="p" k="plant.text.layout" parts={counts()} />
      <p id="plant-live" role="status" aria-live="polite" data-plant-live>
        <T k="plant.text.live" parts={{ ...counts(), clock: clockPart() }} />
      </p>
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
            {plan.units.map((u) => (
              <tr key={u.id} data-object-row={`reactor:${u.id}`}>
                <td>
                  <Label>{u.id}</Label>
                </td>
                <td>
                  <Label>{u.bay}</Label>
                </td>
                <td>{u.batch === null ? <T k="plant.batch.none" /> : <Label>{u.batch}</Label>}</td>
                <T as="td" k={`plant.status.${statusOf(u, at)}`} />
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
            {analyzerRowsAt(plan, at).map((a) => (
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
                  <Label>{a.queue}</Label>
                </td>
                <T as="td" k={`plant.lamp.${a.lamp}`} />
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
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
