import type { Dialect } from "../generated/dialect.schema";

// Types of the raw device layer (spec section 2.4; data_model section 16). Plain data in, plain data out: nothing here reads truth, the answer key or a file.

export type { Dialect };

/** The first line of every emitted file and every fixture (ADR-0014 rule R3). */
export const BANNER = "synthetic, modeled on public documentation; not a real instrument file";

export type CapturePath = "manual_transcription" | "adapter_ingest";
export type DateOrder = "year_first" | "day_first" | "month_first";
export type Separator = "-" | "/" | ".";

/** What a device really does (scenario data): the emitter renders with it. The adapter entry (ingest/adapters/entry.ts) is what the parser believes; a mismatch is an injected error. */
export interface DeviceSettings {
  instrument: string;
  order: DateOrder;
  separator: Separator;
  clock: "24h" | "12h";
  day_part_marker: boolean;
  /** Seconds the local wall clock runs ahead of UTC (the zone the device is configured with; the file does not carry it, RQ1). */
  zone_offset_s: number;
  /** RQ7: write the optional units row. */
  units_row: boolean;
  /** RQ7: the unit text the device writes per analyte, where it differs from the dialect's default. */
  unit_texts?: Readonly<Record<string, string>>;
  /** RQ8: the roles written, in order; default the dialect's columns. */
  template?: readonly string[];
  /** RQ8: header texts of columns no adapter knows, written after the template (cells are blank). */
  extra_columns?: readonly string[];
  /** RQ4: append mode, every export repeats all earlier rows of the instrument. */
  append?: boolean;
  /** RQ6: an analytical-range breach is a blank value plus a note. */
  range_marking?: boolean;
}

/** The device settings a dialect declares for itself (the defaults of a scenario). */
export const deviceDefaults = (dialect: Dialect, instrument: string): DeviceSettings => ({
  instrument, order: dialect.stamp.order, separator: dialect.stamp.separator, clock: dialect.stamp.clock, day_part_marker: dialect.stamp.day_part_marker, zone_offset_s: 0,
  units_row: false,
});

/** The run bookkeeping a file cannot carry: which request, attempt, visit and instant a line renders. The assembly keeps it beside the file; the parser never sees it. */
export interface Source {
  request_id: string;
  attempt: number;
  visit: number;
  /** The instant of the analysis on the instrument clock (the result event). An analyzer runs one analysis at a time, so with the analyzer it tells two analyses apart that a label error gave the same label, attempt and visit (S2f F1). */
  t: number;
}

/** One line of a file before it is written: one analysis (or injection) of a sample. */
export interface AnalysisRow {
  instrument: string;
  /** The sample-id text as the operator typed it at the analyzer. A label error can make it the text of another tube. */
  sample_id: string;
  /** The physical sample the row measures (S2f F2): what the quirk draws are keyed by, whatever the label text says. Plain data from the assembly (raw/quirks.ts). */
  physical_id: string;
  /** The instant of the measurement in seconds of the scenario (the result event). */
  t_s: number;
  /** The instant the row stamp shows, on the instrument clock: t_s, or t_s minus the run time where the stamp is the start (stamp.means). */
  stamp_s: number;
  /** The original sample time; equals stamp_s except in a reanalysis row (RQ5). */
  sample_time_s: number;
  dilution: number | null;
  values: { analyte: string; value: number }[];
  injection_id?: string;
  result_id?: string;
  src: Source;
}
