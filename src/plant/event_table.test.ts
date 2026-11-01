import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// P4 (docs/design/plant_ui.md section 4.3): the table from event type to what the reader sees is total. This reads the table from the design note and the event types from
// schemas/event.schema.json, in the pattern of tests/test_explainer_flags.py: a type of the schema with no row, a row with an empty floor cell, and a "Not drawn" with no reason all fail, and so
// does a process_event kind (the schema's enum) that no row names. The note is the single source of truth for what is drawn; scene_at.ts is tested against it row by row in scene_at.test.ts.

const NOTE = readFileSync(new URL("../../docs/design/plant_ui.md", import.meta.url), "utf8");
const SCHEMA = JSON.parse(readFileSync(new URL("../../schemas/event.schema.json", import.meta.url), "utf8")) as {
  $defs: Record<string, { properties?: { type?: { const?: string }; kind?: { enum: string[] } } }>;
};

const section = (text: string, from: string, to: string): string => {
  const start = text.indexOf(from);
  const end = text.indexOf(to, start + from.length);
  if (start < 0 || end < 0) throw new Error(`the note has no section between "${from}" and "${to}"`);
  return text.slice(start, end);
};

interface Row {
  event: string;
  floor: string;
  hall: string;
}

/** The rows of the table of section 4.3: three cells each, the header and the rule line left out. */
const rowsOf = (note: string): Row[] =>
  section(note, "### 4.3", "\n## 5.")
    .split("\n")
    .filter((line) => line.startsWith("| ") && !line.startsWith("| Event") && !line.startsWith("|---"))
    .map((line) => {
      const cells = line.split("|").slice(1, -1).map((c) => c.trim());
      if (cells.length !== 3) throw new Error(`a row of the table has ${cells.length} cells, not 3: ${line.slice(0, 80)}`);
      return { event: cells[0] as string, floor: cells[1] as string, hall: cells[2] as string };
    })
    // the last row lists what the recorders write, which is not an event of the engine's log and has no floor side
    .filter((row) => !row.event.startsWith("Record outputs"));

const typesOfSchema = (): string[] => Object.values(SCHEMA.$defs).flatMap((d) => (d.properties?.type?.const ? [d.properties.type.const] : []));
/** The names in backticks in the first cell of a row. */
const named = (row: Row): string[] => [...row.event.matchAll(/`([a-z_]+)`/g)].map((m) => m[1] as string);

describe("The table from event type to screen is total (section 4.3)", () => {
  const rows = rowsOf(NOTE);

  it("Given the schema Then it has 28 event types, which the test reads (a type added to the schema must add a row)", () => {
    expect(typesOfSchema()).toHaveLength(28);
    expect(new Set(typesOfSchema()).size).toBe(28);
  });

  it("Given every type of schemas/event.schema.json Then the first column of the table names it", () => {
    const named_ = new Set(rows.flatMap(named));
    const missing = typesOfSchema().filter((t) => !named_.has(t));
    expect(missing, `types with no row in section 4.3: ${missing.join(", ")}`).toEqual([]);
  });

  it("Given every kind of process_event in the schema Then a row names process_event with that kind", () => {
    const kinds = SCHEMA.$defs.process_event?.properties?.kind?.enum ?? [];
    expect(kinds).toHaveLength(7);
    for (const kind of kinds) {
      const row = rows.find((r) => named(r).includes("process_event") && named(r).includes(kind));
      expect(row, `no row for process_event ${kind}`).toBeDefined();
    }
  });

  it("Given every row Then its floor cell says what is drawn, or begins 'Not drawn' with a reason of some words", () => {
    for (const row of rows) {
      expect(row.floor, `empty floor cell: ${row.event}`).not.toBe("");
      if (row.floor.startsWith("Not drawn")) {
        const reason = row.floor.replace(/^Not drawn( before P\d)?:?/, "").trim();
        expect(reason.split(/\s+/).length, `no reason for the row ${row.event}`).toBeGreaterThanOrEqual(4);
      }
    }
  });

  it("Given every row Then its record-hall cell is filled", () => {
    for (const row of rows) expect(row.hall, `empty hall cell: ${row.event}`).not.toBe("");
  });

  it("Given the rows Then the types the floor draws are the ones the batch builds: every other type says why not, and the later batches are named", () => {
    const notDrawn = rows.filter((r) => r.floor.startsWith("Not drawn")).flatMap((r) => named(r).filter((n) => typesOfSchema().includes(n)));
    // the types that wait for later batches or are not things on a floor; process_event is drawn through its other kinds
    expect(notDrawn.sort()).toEqual(["aliquot_created", "confirm_result", "confirm_sample_drawn", "contamination_onset", "log_header", "process_event", "sample_planned", "sensor_tick"]);
  });
});

describe("The reader of the table (a test of the test)", () => {
  it("Given a note with a row dropped Then the type of that row is no longer named", () => {
    const without = NOTE.split("\n").filter((l) => !l.startsWith("| `qc_result`")).join("\n");
    expect(without).not.toBe(NOTE);
    expect(new Set(rowsOf(without).flatMap(named)).has("qc_result")).toBe(false);
    expect(new Set(rowsOf(NOTE).flatMap(named)).has("qc_result")).toBe(true);
  });
});
