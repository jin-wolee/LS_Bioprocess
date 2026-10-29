import type { ExportField } from "./columns.ts";

export type Cell = string | number | null;

const quote = (text: string): string => (/[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text);

/** RFC 4180 with LF line ends: a null is an empty cell, a cell with a comma, a quote or a line break is quoted with doubled quotes. The header is the field names. */
export const toCsv = (fields: readonly ExportField[], rows: readonly Record<string, Cell>[]): string =>
  [fields.map((x) => x.name).join(","), ...rows.map((r) => fields.map((x) => (r[x.name] === null || r[x.name] === undefined ? "" : quote(String(r[x.name])))).join(","))].map((l) => `${l}\n`).join("");
