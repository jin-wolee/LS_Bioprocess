import { adapterEntry } from "../../ingest/adapters/entry.ts";
import type { AdapterEntry, Belief } from "../../ingest/adapters/entry.ts";
import { bridge } from "../../ingest/adapters/to_events.ts";
import type { Manifest, ParseOutput, RawTables } from "../../ingest/canonical.ts";
import { parseFile } from "../../ingest/parse.ts";
import { newStore } from "../../ingest/store.ts";
import { entryOpportunities, transcribe } from "../../inject/entry.ts";
import type { AppliedEntryError, EntryError } from "../../inject/entry.ts";
import type { ObservableEvent } from "../../observe.ts";
import { emitExport } from "../../raw/emit.ts";
import type { RawPlan } from "../../raw/emit.ts";
import type { RawOpportunity } from "../../raw/quirks.ts";
import { analysisRows } from "../../raw/rows.ts";
import { deviceDefaults } from "../../raw/types.ts";
import type { EmittedFile } from "../../raw/key.ts";
import type { AnalysisRow, CapturePath, DeviceSettings, Dialect } from "../../raw/types.ts";
import type { Architecture } from "../../record/architecture.ts";
import type { CaptureInput } from "../../record/types.ts";
import type { ControllerSetup } from "./raw_controller.ts";

// The capture step between the observable stream and the recorder, for one architecture on one capture path (spec section 5, "Capture path"). The files are emitted from the
// same rows and the same draws on both paths (the printout and the file are what the person and the adapter read). On adapter_ingest the files are parsed and the result rows
// of the recorder come from the parse; on manual_transcription nothing parses and the typed entries do. The assembly may read the manifest (which line renders which run); the
// parser may not, and no recorder or arm sees the raw quirk key this step returns.

export interface RawSetup {
  dialects: Readonly<Record<string, Dialect>>;
  /** Epoch seconds (UTC) of scenario second 0 (calendar.ts). */
  anchor_epoch_s: number;
  /** The zone the instruments are configured with (A161). */
  zone_offset_s: number;
  /** The route of the analyzer profile: the dialect that writes each visit, its analytes, and its nominal run time (A023, A025, A028). */
  visits: readonly { dialect: string; analytes: readonly string[]; run_s: number }[];
  /** The default dilution ratio of the method (A090); null when it has none. */
  default_dilution: number | null;
  /** The host clock at which the data of a measurement at t is exported (seconds of the scenario): the end of the staffed window by default (A216, the window is A098; spec section 2.4.2). The assembly hands it the host instant of the row. */
  export_at: (t: number) => number;
  /** The scenario's override of the capture path of every preset. */
  capture_path?: CapturePath;
  /** The controller side (S2e2): absent when the scenario names no bay controllers, which leaves the layer analyzer-side only. */
  controller?: ControllerSetup;
  /** What a device really does, by instrument; what the adapter believes, by instrument. A mismatch is an injected error. */
  devices?: Readonly<Record<string, Partial<DeviceSettings>>>;
  beliefs?: Readonly<Record<string, Partial<Omit<Belief, "instrument" | "required_analytes">>>>;
  plan?: Omit<RawPlan, "seed">;
  /** Entry errors (manual_transcription): named in forced mode, or a test-only rate. Absent in production: no ledger rate, reported as not modelled. */
  entry?: { forced?: readonly EntryError[]; rate?: number };
}

export interface RawKeyContent {
  files: { file_name: string; instrument: string; dialect_id: string; replay_of: string | null; rows: EmittedFile["key_rows"] }[];
  entry_errors: AppliedEntryError[];
  opportunities: RawOpportunity[];
  not_modelled: string[];
}

export interface RawPathInput {
  setup: RawSetup;
  seed: number;
  architecture: Pick<Architecture, "id" | "flags">;
  path: CapturePath;
  /** The stream after the error injector: what the instruments and the people see. */
  events: readonly ObservableEvent[];
  /** The injector's host receipt time of a result whose instrument stamp was moved (a clock error); the manual path keeps it as the entry time. */
  received_at: Readonly<Record<string, number>>;
}

export interface RawPathOutput {
  path: CapturePath;
  events: ObservableEvent[];
  received_at: Record<string, number>;
  capture: CaptureInput;
  files: EmittedFile[];
  outputs: ParseOutput[];
  tables: RawTables | null;
  key: RawKeyContent;
}

const unique = <T>(xs: readonly T[]): T[] => [...new Set(xs)];

export const rawPath = (input: RawPathInput): RawPathOutput => {
  const { setup, seed, events } = input;
  const dialectIds = unique(setup.visits.map((v) => v.dialect));
  const files: EmittedFile[] = [];
  const opportunities: RawOpportunity[] = [];
  for (const id of dialectIds) {
    const dialect = setup.dialects[id];
    if (!dialect) throw new Error(`raw path: the route names the dialect ${id}, which was not supplied`);
    const rows = analysisRows(events, { dialect, visit_dialects: setup.visits.map((v) => v.dialect), visit_analytes: setup.visits.map((v) => v.analytes), visit_run_s: setup.visits.map((v) => v.run_s), default_dilution: setup.default_dilution });
    // an instrument whose clock is wrong stamps its rows in its own time; the export schedule runs on the host clock, which the injector hands over for such a result
    const host = (r: AnalysisRow): number => input.received_at[`${r.instrument}/${r.src.request_id}/${r.src.attempt}/${r.src.visit}/${r.values[0]?.analyte}`] ?? r.t_s;
    for (const instrument of unique(rows.map((r) => r.instrument))) {
      const mine = rows.filter((r) => r.instrument === instrument);
      const device: DeviceSettings = { ...deviceDefaults(dialect, instrument), zone_offset_s: setup.zone_offset_s, ...setup.devices?.[instrument] };
      let previous: AnalysisRow[] = [];
      for (const at of unique(mine.map((r) => setup.export_at(host(r)))).sort((a, b) => a - b)) {
        const now = mine.filter((r) => setup.export_at(host(r)) === at);
        const e = emitExport({ dialect, device, anchor_epoch_s: setup.anchor_epoch_s, rows: now, previous, export_at: at, plan: { seed, ...setup.plan } });
        files.push(...e.files);
        opportunities.push(...e.opportunities);
        previous = [...previous, ...now];
      }
    }
  }
  files.sort((a, b) => a.received_at - b.received_at);

  const forced = setup.plan?.forced !== undefined || setup.entry?.forced !== undefined;
  const notModelled = forced ? [] : [
    ...(setup.plan?.rates?.overlap === undefined ? ["raw_rq4_overlap"] : []), ...(setup.plan?.rates?.replay === undefined ? ["raw_rq4_replay"] : []),
    ...(input.path === "manual_transcription" && setup.entry?.rate === undefined ? ["entry_value", "entry_unit", "entry_dilution"] : []),
  ];
  const key: RawKeyContent = {
    files: files.map((f) => ({ file_name: f.file_name, instrument: f.instrument, dialect_id: f.dialect_id, replay_of: f.replay_of, rows: f.key_rows })),
    entry_errors: [], opportunities: [...opportunities, ...entryOpportunities(seed, events)], not_modelled: notModelled,
  };

  if (input.path === "manual_transcription") {
    const columns = dialectIds.flatMap((id) => (setup.dialects[id] as Dialect).columns);
    const typed = transcribe({
      seed, events, unit_text: Object.fromEntries(columns.filter((c) => c.kind === "value").map((c) => [c.analyte as string, c.unit_text as string])),
      ucum_of: Object.fromEntries(dialectIds.flatMap((id) => Object.entries((setup.dialects[id] as Dialect).units).map(([text, u]) => [text, u.ucum]))), default_dilution: setup.default_dilution,
      ...(setup.entry?.rate !== undefined && { rate: setup.entry.rate }), ...(setup.entry?.forced && { forced: setup.entry.forced }),
    });
    key.entry_errors = typed.applied;
    return { path: input.path, events: typed.events, received_at: { ...input.received_at }, capture: { path: input.path, provenance: typed.provenance }, files, outputs: [], tables: null, key };
  }

  // adapter_ingest: one store for the architecture, files in the order they arrived
  const store = newStore();
  const entries = new Map<string, AdapterEntry>();
  const outputs: ParseOutput[] = [];
  const manifests = new Map<string, Manifest>();
  files.forEach((f, i) => {
    const id = `${f.dialect_id}|${f.instrument}`;
    if (!entries.has(id)) {
      const dialect = setup.dialects[f.dialect_id] as Dialect;
      const mine = setup.visits.filter((v) => v.dialect === f.dialect_id);
      const analytes = unique(mine.flatMap((v) => v.analytes)).filter((a) => dialect.columns.some((c) => c.analyte === a));
      entries.set(id, adapterEntry(dialect, { instrument: f.instrument, required_analytes: analytes, run_s: mine[0]?.run_s ?? 0, ...setup.beliefs?.[f.instrument] }));
    }
    const raw_file_id = `RF${i + 1}`;
    manifests.set(raw_file_id, f.manifest);
    outputs.push(parseFile(f.text, {
      entry: entries.get(id) as AdapterEntry, file_name: f.file_name, raw_file_id, received_at: f.received_at, anchor_epoch_s: setup.anchor_epoch_s,
      flags: { ingest_idempotency: input.architecture.flags.ingest_idempotency, append_only_versions: input.architecture.flags.append_only_versions }, store,
    }));
  });
  const bridged = bridge(events, outputs, manifests);
  const tables: RawTables = {
    adapter: [...entries.values()].map((e) => ({ adapter_id: e.adapter_id, adapter_version: e.adapter_version, dialect_id: e.dialect_id, device_class: e.device_class, instrument_id: e.instrument, date_order: e.date_order, date_separator: e.date_separator, clock_style: e.clock_style, source_zone_s: e.source_zone_s, stamp_means: e.stamp_means, time_resolution_s: e.time_resolution_s, modeled_on: e.modeled_on, banner: e.banner })),
    raw_file: outputs.map((o) => o.raw_file), raw_record: outputs.flatMap((o) => o.raw_records), parse_error: outputs.flatMap((o) => o.parse_errors), alarm_event: [], batch_phase_record: [],
  };
  return { path: input.path, events: bridged.events, received_at: bridged.received_at, capture: bridged.capture, files, outputs, tables, key };
};
