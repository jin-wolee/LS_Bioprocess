import type { RawTables } from "../../ingest/canonical.ts";
import { controllerEntry } from "../../ingest/controller_entry.ts";
import type { ControllerBelief, ControllerEntry } from "../../ingest/controller_entry.ts";
import { parseControllerFile } from "../../ingest/controller_parse.ts";
import type { ControllerParseOutput } from "../../ingest/controller_parse.ts";
import { newStore } from "../../ingest/store.ts";
import type { ObservableEvent, ObservableSensorSeries } from "../../observe.ts";
import { emitController } from "../../raw/controller_emit.ts";
import { logRuleOf, logTags } from "../../raw/controller_log.ts";
import { phaseTransitions } from "../../raw/controller_phases.ts";
import { tagSeries } from "../../raw/controller_series.ts";
import type { SetPoints } from "../../raw/controller_series.ts";
import type { AlarmTransition, ControllerFile, ControllerProfile, PhaseTransition } from "../../raw/controller_types.ts";
import type { CapturePath } from "../../raw/types.ts";
import type { HistorianRow, ValidationFindingRow } from "../../record/types.ts";

// The controller side of the capture step (spec section 5, "Capture path", rule 3; docs/prompts/20 Step 7). Controller logs are machine files, so a person cannot copy them: on
// manual_transcription nothing is emitted and nothing is parsed, and the historian values reach the recorder as observable events, as with the layer off. On adapter_ingest each
// bay's controller writes the logs of its profile from observable data only (the process values, the set points of the scenario and the shift, the process events), the adapter
// parses them, and the dataset gets historian values, alarm events and batch phase records. The assembly may read the layout of the bays; the emitter and the parser receive plain
// data, and no recorder or arm sees the files.

export interface ControllerSetup {
  /** The controller profiles by id (parsed data). */
  profiles: Readonly<Record<string, ControllerProfile>>;
  /** The profile id of each bay, bay 1 first (scenario setting bay_controllers). */
  bays: readonly string[];
  /** A217: one file per record type per day, or each row as written. */
  cut: "daily" | "per_row";
  set_points: SetPoints;
  /** The bay (from 1) of each unit: the layout of the plant, which the assembly reads from the run. */
  unit_bay?: Readonly<Record<string, number>>;
  /** Hand-given (test-only) transitions: a production run has none, because no acknowledge or return-to-normal time has a ledger entry (spec 2.4.8). Named by unit. */
  forced?: { alarms?: readonly AlarmTransition[]; phases?: readonly PhaseTransition[] };
  /** What each adapter believes about its controller, by controller id; a mismatch with the device is an injected error. */
  beliefs?: Readonly<Record<string, Omit<ControllerBelief, "controller">>>;
}

export interface ControllerPathInput {
  setup: ControllerSetup;
  anchor_epoch_s: number;
  zone_offset_s: number;
  path: CapturePath;
  flags: { ingest_idempotency: boolean };
  /** The observable events: only the inoculation and process events are read. */
  events: readonly ObservableEvent[];
  sensors: readonly ObservableSensorSeries[];
}

export interface ControllerPathOutput {
  files: ControllerFile[];
  outputs: ControllerParseOutput[];
  historian: HistorianRow[];
  findings: ValidationFindingRow[];
  /** The controller rows of the raw tables: the adapters, files, lines, dead letters, alarm events and batch phase records. */
  tables: RawTables;
  /** Classes with no ledger entry that a production run reports as not modelled (spec 2.4.8). */
  not_modelled: string[];
}

export const controllerPath = (input: ControllerPathInput): ControllerPathOutput | null => {
  if (input.path === "manual_transcription") return null;
  const { setup } = input;
  const bayOf = (unit: string): number => {
    const bay = setup.unit_bay?.[unit];
    if (bay === undefined) throw new Error(`controller path: the layout gives no bay for the unit ${unit}`);
    return bay;
  };
  const files: ControllerFile[] = [];
  const phases = [...phaseTransitions(input.events), ...(setup.forced?.phases ?? [])];
  setup.bays.forEach((profileId, i) => {
    const profile = setup.profiles[profileId];
    if (!profile) throw new Error(`controller path: bay ${i + 1} names the controller profile ${profileId}, which was not supplied`);
    const mine = (unit: string): boolean => bayOf(unit) === i + 1;
    const rule = logRuleOf(profile);
    files.push(...emitController({
      profile, controller: `CTRL-${i + 1}`, anchor_epoch_s: input.anchor_epoch_s, zone_offset_s: input.zone_offset_s, cut: setup.cut,
      tags: logTags(tagSeries(input.sensors.filter((s) => mine(s.unit_id)), input.events, setup.set_points), rule),
      alarms: (setup.forced?.alarms ?? []).filter((a) => mine(a.unit)), phases: phases.filter((p) => mine(p.unit)),
    }));
  });
  files.sort((a, b) => a.received_at - b.received_at);

  // one store for the architecture, files in the order they arrived (as on the analyzer side)
  const store = newStore();
  const entries = new Map<string, ControllerEntry>();
  const outputs: ControllerParseOutput[] = [];
  files.forEach((f, i) => {
    let entry = entries.get(f.controller);
    if (!entry) {
      entry = controllerEntry(setup.profiles[f.profile_id] as ControllerProfile, { controller: f.controller, ...setup.beliefs?.[f.controller] });
      entries.set(f.controller, entry);
    }
    outputs.push(parseControllerFile(f.text, { entry, file_name: f.file_name, raw_file_id: `CF${i + 1}`, received_at: f.received_at, anchor_epoch_s: input.anchor_epoch_s, flags: input.flags, store }));
  });

  const historian: HistorianRow[] = outputs.flatMap((o) => o.historian.map((r): HistorianRow => ({ tag: r.payload.tag, ts: r.payload.ts, value: r.payload.value, quality: r.payload.quality, ingested_at: r.envelope.received_at, raw_ref: r.envelope.raw_ref })));
  const tables: RawTables = {
    adapter: [...entries.values()].map((e) => ({
      adapter_id: e.adapter_id, adapter_version: e.adapter_version, dialect_id: e.profile_id, device_class: e.device_class, instrument_id: e.controller, date_order: "year_first", date_separator: "-", clock_style: "24h",
      source_zone_s: e.source_zone_s, stamp_means: "instant", time_resolution_s: 1, modeled_on: e.modeled_on, banner: e.banner,
    })),
    raw_file: outputs.map((o) => o.raw_file), raw_record: outputs.flatMap((o) => o.raw_records), parse_error: outputs.flatMap((o) => o.parse_errors),
    alarm_event: outputs.flatMap((o) => o.alarms.map((r) => ({
      alarm_event_id: `${r.envelope.raw_ref.raw_file_id}:${r.envelope.raw_ref.line_no}`, ...r.payload, ingested_at: r.envelope.received_at, raw_ref: r.envelope.raw_ref,
    }))),
    batch_phase_record: outputs.flatMap((o) => o.phases.map((r) => ({
      phase_record_id: `${r.envelope.raw_ref.raw_file_id}:${r.envelope.raw_ref.line_no}`, ...r.payload, ingested_at: r.envelope.received_at, raw_ref: r.envelope.raw_ref,
    }))),
  };
  const findings = outputs.flatMap((o) => o.findings).map((f): ValidationFindingRow => ({ rule: f.rule, target: f.target, severity: f.severity, action: f.action, status: f.status }));
  // OUT (the generic controller rule), the L1 signals beyond A100 and the acknowledge and return-to-normal times have no ledger entry (spec 2.4.8): a production run does not model them
  const not_modelled = ["ctrl_out", "ctrl_extra_signals", ...(setup.forced?.alarms === undefined ? ["ctrl_alarm_log"] : [])];
  return { files, outputs, historian, findings, tables, not_modelled };
};

/** The raw tables of the analyzer side and the controller side together: the controller rows follow the analyzer rows. */
export const mergeTables = (a: RawTables, b: RawTables): RawTables => ({
  adapter: [...a.adapter, ...b.adapter], raw_file: [...a.raw_file, ...b.raw_file], raw_record: [...a.raw_record, ...b.raw_record], parse_error: [...a.parse_error, ...b.parse_error],
  alarm_event: [...a.alarm_event, ...b.alarm_event], batch_phase_record: [...a.batch_phase_record, ...b.batch_phase_record],
});

