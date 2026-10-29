import type { Dialect } from "../../generated/dialect.schema";
import { BANNER } from "../../raw/types.ts";
import type { DateOrder, Separator } from "../../raw/types.ts";

// The adapter entry (data_model section 16.1, `adapter`): a dialect plus what the parser BELIEVES about one device (spec section 2.4.1, rule 2). The device's real settings are
// scenario data used by the emitter; a mismatch between the two is an injected error, not a parser fault. The entry is master data, immutable once a file was parsed with it (K21).

type Column = Dialect["columns"][number];

export interface Expected {
  unit_text: string;
  ucum: string;
  dimension: string;
  physical: "non_negative" | "percent" | "ph_scale";
}

export interface AdapterEntry {
  adapter_id: string;
  adapter_version: number;
  dialect_id: string;
  device_class: "analyzer";
  /** The instrument (the source system of everything loaded). */
  instrument: string;
  date_order: DateOrder | "unknown";
  date_separator: Separator;
  clock_style: "24h" | "12h" | "unknown";
  /** The zone the adapter applies, seconds ahead of UTC; null when the entry has none, which leaves every stamp unresolved (VR-024). */
  source_zone_s: number | null;
  stamp_means: "start" | "end";
  time_resolution_s: number;
  /** The nominal run time of the visit (A023, A025, A028): the other end of the run is derived from it (data_model section 16.3). */
  run_s: number;
  separator: string;
  units_in_header: boolean;
  columns: Column[];
  unit_map: Record<string, { ucum: string; dimension: string }>;
  /** Per analyte: the unit and dimension the method expects (VR-005) and the definitional bound of its value (VR-006). */
  expect: Record<string, Expected>;
  /** The method's list of required analytes (VR-026 and the required columns of the template). */
  required_analytes: string[];
  range_words: { high: string; low: string } | null;
  modeled_on: string[];
  banner: string;
}

/** What the entry believes about the device; every field defaults to what the dialect declares. */
export interface Belief {
  instrument: string;
  required_analytes: readonly string[];
  run_s?: number;
  adapter_version?: number;
  date_order?: AdapterEntry["date_order"];
  date_separator?: Separator;
  clock_style?: AdapterEntry["clock_style"];
  source_zone_s?: number | null;
}

export const adapterEntry = (dialect: Dialect, belief: Belief): AdapterEntry => {
  const expect: Record<string, Expected> = {};
  for (const c of dialect.columns) {
    if (c.kind !== "value" || !c.analyte || !c.unit_text) continue;
    const u = dialect.units[c.unit_text];
    if (!u) throw new Error(`dialect ${dialect.dialect_id}: the unit text ${c.unit_text} of ${c.analyte} is not in its unit map`);
    expect[c.analyte] = { unit_text: c.unit_text, ucum: u.ucum, dimension: u.dimension, physical: (c.physical ?? "non_negative") as Expected["physical"] };
  }
  return {
    adapter_id: `AD-${dialect.dialect_id}-${belief.instrument}`, adapter_version: belief.adapter_version ?? 1, dialect_id: dialect.dialect_id, device_class: "analyzer",
    instrument: belief.instrument, date_order: belief.date_order ?? dialect.stamp.order, date_separator: belief.date_separator ?? dialect.stamp.separator,
    clock_style: belief.clock_style ?? dialect.stamp.clock, source_zone_s: belief.source_zone_s === undefined ? 0 : belief.source_zone_s,
    stamp_means: dialect.stamp.means, time_resolution_s: dialect.params.resolution_s?.value ?? 1, run_s: belief.run_s ?? 0,
    separator: dialect.file.separator, units_in_header: dialect.file.units === "in_header", columns: dialect.columns.map((c) => ({ ...c })),
    unit_map: Object.fromEntries(Object.entries(dialect.units).map(([text, u]) => [text, { ucum: u.ucum, dimension: u.dimension }])),
    expect, required_analytes: [...belief.required_analytes],
    range_words: dialect.range_note ? { high: dialect.range_note.high_word, low: dialect.range_note.low_word } : null,
    modeled_on: [...dialect.modeled_on], banner: BANNER,
  };
};
