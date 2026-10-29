import type { DataPackage } from "./package.ts";

// The in-house structural validator of a data package (no new dependency): required keys, every resource path exists, the CSV header equals the schema field names, the cells parse
// as their field types. It returns the errors as text; an empty list is a valid package. It checks structure, not the Frictionless specification as a whole.

const REQUIRED_KEYS = ["profile", "name", "licenses", "resources", "seed", "engine_version", "schema_version", "data_dictionary", "architecture", "context_as_of", "context_as_of_basis"] as const;

/** Splits RFC 4180 text (LF or CRLF) into rows of cells; a quoted cell may hold commas, doubled quotes and line breaks. */
const parse = (text: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i] as string;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
};

const parses = (type: string, cell: string): boolean => (type === "integer" ? /^-?\d+$/.test(cell) : type === "number" ? cell.trim() !== "" && Number.isFinite(Number(cell)) : true);

export const checkPackage = (pkg: DataPackage, files: Readonly<Record<string, string>>): string[] => {
  const errors: string[] = [];
  for (const k of REQUIRED_KEYS) if (!(k in pkg)) errors.push(`missing key ${k}`);
  if (!Array.isArray(pkg.resources) || pkg.resources.length === 0) return [...errors, "resources must be a non-empty list"];
  for (const res of pkg.resources) {
    const text = files[res.path];
    if (text === undefined) {
      errors.push(`resource ${res.name}: path ${res.path} does not exist`);
      continue;
    }
    const [header = [], ...rows] = parse(text);
    const fields = res.schema.fields;
    if (header.join(",") !== fields.map((x) => x.name).join(",")) errors.push(`resource ${res.name}: header ${header.join(",")} differs from the schema field names ${fields.map((x) => x.name).join(",")}`);
    rows.forEach((cells, i) => {
      if (cells.length !== fields.length) {
        errors.push(`resource ${res.name}: row ${i + 1}: ${cells.length} cells, expected ${fields.length}`);
        return;
      }
      fields.forEach((x, j) => {
        const cell = cells[j] as string;
        if (cell === "") {
          if (x.constraints.required) errors.push(`resource ${res.name}: row ${i + 1}, column ${x.name}: required cell is empty`);
        } else if (!parses(x.type, cell)) errors.push(`resource ${res.name}: row ${i + 1}, column ${x.name}: "${cell}" is not an ${x.type}`);
      });
    });
  }
  return errors;
};
