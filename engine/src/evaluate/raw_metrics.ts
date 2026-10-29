import type { ParseOutput, RawRecordState } from "../ingest/canonical.ts";
import type { KeyRow } from "../raw/key.ts";

// The raw-layer metrics of spec section 2.4.7. Same rules as section 8: reported with the seed count and the spread across seeds, never gated, no composite score. They read the
// raw quirk key (only the evaluator does) and the outcome of the parser per row. They exist for a run whose capture path is adapter_ingest; on manual_transcription there is no
// file to parse and the answer is NOT_APPLICABLE, never zero. A class that did not occur reads "none occurred", never 100 percent. Denominators are written in each function.

export const NOT_APPLICABLE = { status: "not_applicable", reason: "manual_transcription: no file is parsed, so there is no ingest metric" } as const;
export const NONE_OCCURRED = { status: "none_occurred" } as const;

/** The device class of a raw data row: a row of an analyzer export or of a controller log. */
export type DeviceClass = "analyzer" | "controller";

/** One written row with what the parser did to it. `state` is "file_rejected" for a row of a file that was rejected as a whole (every row of it counts as unreadable). */
export interface RowObservation {
  key: KeyRow;
  state: RawRecordState | "file_rejected";
  /** The instant the parser stored for the row (seconds of the scenario), or null when it stored none. */
  parsed_s: number | null;
  device: DeviceClass;
}

export type Share = { status: "reported"; num: number; den: number } | typeof NONE_OCCURRED;

/** The metrics of spec 2.4.7 over a set of rows: all rows (the total) or the rows of one device class. */
export interface RawClassMetrics {
  status: "reported";
  rows: number;
  /** Rows rejected as unreadable (VR-023, a rejected file counts every row) over all raw data rows written, repeated rows and rows of replayed files included. */
  parse_failure: Share;
  /** Over the rows whose stamp text is ambiguous under the format in play: resolved correctly, resolved wrongly (another valid instant), unresolved (no instant stored). */
  ambiguous: { status: "reported"; den: number; correct: number; wrong: number; unresolved: number } | typeof NONE_OCCURRED;
  /** Over all repeated rows written: second and later copies that were no-ops (VR-008), loaded again, or quarantined (VR-008b). */
  duplicates: { status: "reported"; den: number; suppressed: number; loaded_again: number; quarantined: number } | typeof NONE_OCCURRED;
  /** Rows quarantined and rows held by the ingest-stage rules, over all raw data rows received, each counted separately. */
  stage: { quarantined: number; held: number; den: number };
  /** The guard against quarantining everything: clean rows (no realised quirk, no repeat, not ambiguous, readable) that were quarantined or held, over all clean rows. */
  clean: { status: "reported"; den: number; held_or_quarantined: number } | typeof NONE_OCCURRED;
}

/** A device class of which no row was written (a scenario with no controller on a bay, say): not applicable, never zero. */
export const NO_ROWS = { status: "not_applicable", reason: "no raw data row of this device class was written" } as const;

/**
 * The metrics as spec 2.4.7 defines them (the total, over all raw data rows the emitters wrote) and beside them the same metrics per device class, each over the rows of that
 * class only. The controller rows are about 99 percent of the rows of a run, so a total guard alone would let quarantining every analyzer row look harmless; the class guard
 * (clean rows of the class quarantined or held, over the clean rows of the class) does not dilute. The classes partition the rows: a row is in exactly one.
 */
export interface RawMetrics extends RawClassMetrics {
  by_class: Record<DeviceClass, RawClassMetrics | typeof NO_ROWS>;
}

const share = (num: number, den: number): Share => (den === 0 ? NONE_OCCURRED : { status: "reported", num, den });

const classMetrics = (rows: readonly RowObservation[]): RawClassMetrics => {
  const failed = rows.filter((r) => r.state === "rejected" || r.state === "file_rejected").length;
  const ambiguous = rows.filter((r) => r.key.ambiguous);
  const truncated = (k: KeyRow): number => Math.floor(k.intended_s / k.resolution_s) * k.resolution_s;
  const correct = ambiguous.filter((r) => r.parsed_s !== null && r.parsed_s === truncated(r.key)).length;
  const wrong = ambiguous.filter((r) => r.parsed_s !== null && r.parsed_s !== truncated(r.key)).length;
  const repeats = rows.filter((r) => r.key.repeat);
  const clean = rows.filter((r) => r.key.quirks.length === 0 && !r.key.repeat && !r.key.ambiguous && !r.key.unreadable);
  return {
    status: "reported", rows: rows.length, parse_failure: share(failed, rows.length),
    ambiguous: ambiguous.length === 0 ? NONE_OCCURRED : { status: "reported", den: ambiguous.length, correct, wrong, unresolved: ambiguous.length - correct - wrong },
    duplicates: repeats.length === 0 ? NONE_OCCURRED : {
      status: "reported", den: repeats.length, suppressed: repeats.filter((r) => r.state === "no_op").length,
      loaded_again: repeats.filter((r) => r.state === "loaded" || r.state === "held").length, quarantined: repeats.filter((r) => r.state === "quarantined").length,
    },
    stage: { quarantined: rows.filter((r) => r.state === "quarantined").length, held: rows.filter((r) => r.state === "held").length, den: rows.length },
    clean: clean.length === 0 ? NONE_OCCURRED : { status: "reported", den: clean.length, held_or_quarantined: clean.filter((r) => r.state === "held" || r.state === "quarantined").length },
  };
};

export const rawMetrics = (rows: readonly RowObservation[]): RawMetrics => ({
  ...classMetrics(rows),
  by_class: Object.fromEntries((["analyzer", "controller"] as const).map((c) => {
    const mine = rows.filter((r) => r.device === c);
    return [c, mine.length === 0 ? NO_ROWS : classMetrics(mine)];
  })) as RawMetrics["by_class"],
});

/** A written controller row as the key sees it: no quirk, no repeat and an unambiguous stamp. Controller rows are clean by construction: a production run realises no controller quirk. */
const CLEAN_ROW: KeyRow = { line: 0, sample_id: "-", intended_s: 0, resolution_s: 1, ambiguous: false, repeat: false, quirks: [], unreadable: false };

/**
 * The observations of the controller files (spec 2.4.7: all raw data rows the emitters wrote, controller rows included): one per data row, with what the parser did to it, and a
 * rejected file counting every row it holds. The rows of a controller log carry no quirk, so they enter the clean-row guard as clean rows.
 */
export const controllerObservations = (outputs: readonly Pick<ParseOutput, "raw_file" | "raw_records">[]): RowObservation[] =>
  outputs.flatMap((o) =>
    o.raw_file.state === "rejected"
      ? Array.from({ length: o.raw_file.row_count }, (): RowObservation => ({ key: CLEAN_ROW, state: "file_rejected", parsed_s: null, device: "controller" }))
      : o.raw_records.map((r): RowObservation => ({ key: CLEAN_ROW, state: r.state, parsed_s: null, device: "controller" })),
  );

/** The observations of a run: the written rows of each file (the raw quirk key) paired with the parse output of the same file, in the order the files arrived. */
export const observationsOf = (files: readonly { file_name: string; rows: readonly KeyRow[] }[], outputs: readonly ParseOutput[]): RowObservation[] => {
  if (files.length !== outputs.length) throw new Error(`raw metrics: ${files.length} files in the key, ${outputs.length} parse outputs`);
  return files.flatMap((f, i) => {
    const out = outputs[i] as ParseOutput;
    if (out.raw_file.file_name !== f.file_name) throw new Error(`raw metrics: file ${i} is ${f.file_name} in the key and ${out.raw_file.file_name} in the parse output`);
    return f.rows.map((key): RowObservation => {
      if (out.raw_file.state === "rejected") return { key, state: "file_rejected", parsed_s: null, device: "analyzer" };
      const rec = out.raw_records.find((r) => r.line_no === key.line);
      const at = out.records.find((r) => r.envelope.raw_ref.line_no === key.line)?.payload.measured_at ?? null;
      return { key, state: rec?.state ?? "rejected", parsed_s: at, device: "analyzer" };
    });
  });
};
