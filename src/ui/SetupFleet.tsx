import type { ComponentChildren } from "preact";
import type { FleetProblem } from "../protocol.ts";
import { fleetNotes } from "./fleet_view.ts";
import type { FleetNote } from "./fleet_view.ts";
import { Label, T } from "./T.tsx";

// The message under the analyzer list of Setup (U2; lab_ui.md section 3): which analyzers clash, on which analytes, and what to do about it, in plain words, from the problems the engine's own check
// found. The container is always in the page and says nothing while the list is fine, so a screen reader announces the message when it appears (a polite live region, not an alert: it changes with every
// pick and must not interrupt). The analyzer numbers are positions in the list and are labels, like the heading "Analyzer 2" above them; the analytes are identifiers. The words are not colour alone: a
// heading in words, and a bar at the left edge (ADR-0011).

/** Identifiers in a row: "vcd, viability and ph". A dictionary word joins the last two, so no word of a language is typed here. */
function Items({ items }: { items: readonly string[] }) {
  return (
    <>
      {items.map((item, i) => (
        <span key={item}>
          {i > 0 && (i === items.length - 1 ? <> <T k="setup.fleet.and" /> </> : ", ")}
          <Label>{item}</Label>
        </span>
      ))}
    </>
  );
}

function Note({ note }: { note: FleetNote }) {
  if (note.kind === "clash") return <T k="setup.fleet.clash" parts={{ a: <Label>{note.a}</Label>, b: <Label>{note.b}</Label>, analytes: <Items items={note.analytes} /> }} />;
  if (note.kind === "group") return <T k="setup.fleet.group" parts={{ a: <Label>{note.a}</Label>, b: <Label>{note.b}</Label>, group: <Label>{note.group}</Label> }} />;
  return <T k="setup.fleet.unmeasured" parts={{ analytes: <Items items={note.analytes} /> }} />;
}

export function FleetProblems({ problems }: { problems: readonly FleetProblem[] }) {
  const notes = fleetNotes(problems);
  const analyzers = (n: FleetNote): ComponentChildren => (n.kind === "unmeasured" ? "" : `${n.a} ${n.b}`);
  return (
    <div id="fleet-problems" role="status" aria-live="polite" data-fleet-problems={notes.length}>
      {notes.length > 0 && (
        <div class="problem" data-fleet-block>
          <T as="strong" k="setup.fleet.heading" />
          <ul>
            {notes.map((note, i) => (
              <li key={i} data-fleet-note={note.kind} data-fleet-analyzers={analyzers(note)}>
                <Note note={note} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
