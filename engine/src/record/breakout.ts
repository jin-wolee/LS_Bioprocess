import type { ObservableEvent } from "../observe.ts";
import type { FlagName } from "./architecture.ts";
import { storesIngestedAt } from "./results.ts";
import { transit } from "./transitions.ts";
import type { Transition } from "./transitions.ts";
import type { BreakoutInput, DeviationRow, EquipmentRow, LineageEdgeRow, MaterialLotRow, QualityHoldRow, ResultRow, RunRow } from "./types.ts";

// The recorder side of the break-out events (data_model 15.6; spec 11.8.2 rules S7 and S9; break-out batch 3). It exists only for a scenario with a `breakout` block, which the recorder knows by the
// master data it is handed (`RecorderInput.breakout`). Two flags decide what is stored: `material_lot_links` (lots, the edges consumed_in and seeded_from, batch.seed_lot_id and the lot column of the
// process_event) and `equipment_links` (equipment, the edge used_in and the equipment column). Everything else is stored by every architecture: the deviation, the confirming sample, request, runs and
// results (with the columns each flag adds, as for a routine sample) and the process_event rows of the stop, the medium addition and the equipment use.

type Flags = Record<FlagName, boolean>;
type Ev<T extends ObservableEvent["type"]> = Extract<ObservableEvent, { type: T }>;

/** The free-text name of the instrument class that runs a confirming test (data_model 15.1: class `external_lab`; there is no instrument link for it). */
export const EXTERNAL_LAB = "external_lab";
/**
 * The actor the record names when `audit_trail` is on. The stream carries no person for a deviation, so the record holds the role of data_model section 6 that causes the step (the reviewer opens
 * and closes the written record) and not a made-up identity.
 */
const DEVIATION_ACTOR = "reviewer";

/**
 * The lineage edges of the break-out extension, written as the events arrive, in stream order (`E1`, `E2`, ...): `seeded_from` and `consumed_in` under `material_lot_links`, `used_in` under
 * `equipment_links`. A lot used again by the same batch has no second edge: `consumed_in` is one edge per lot and batch, to the first use (data_model 15.1). `consumed` is the set of lots that some
 * event consumed, which decides the state of a lot row.
 */
export const createLinks = (flags: Flags) => {
  const edges: LineageEdgeRow[] = [];
  const consumed = new Set<string>();
  const firstUse = new Set<string>();
  const add = (relation: LineageEdgeRow["relation"], from_kind: LineageEdgeRow["from_kind"], from_id: string, to_kind: LineageEdgeRow["to_kind"], to_id: string, t: number): void => {
    edges.push({ edge_id: `E${edges.length + 1}`, from_kind, from_id, to_kind, to_id, relation, occurred_at: t, available_at: flags.available_at ? t : null });
  };
  return {
    edges,
    consumed,
    seeded: (lot_id: string, batch_id: string, t: number): void => {
      consumed.add(lot_id);
      add("seeded_from", "material_lot", lot_id, "batch", batch_id, t);
    },
    medium: (lot_id: string, batch_id: string, event_id: string, t: number): void => {
      consumed.add(lot_id);
      if (!firstUse.has(`${lot_id}|${batch_id}`)) {
        firstUse.add(`${lot_id}|${batch_id}`);
        add("consumed_in", "material_lot", lot_id, "process_event", event_id, t);
      }
    },
    equipment: (equipment_id: string, event_id: string, t: number): void => add("used_in", "equipment", equipment_id, "process_event", event_id, t),
  };
};

export type Links = ReturnType<typeof createLinks>;

/** The deviation row of a `deviation_opened` event: state `opened`, the initial state of its machine. */
export const deviationRow = (e: Ev<"deviation_opened">, flags: Flags): DeviationRow => ({
  deviation_id: e.deviation_id, batch_id: e.batch_id, opened_at: e.t, opened_by: flags.audit_trail ? DEVIATION_ACTOR : null, trigger: e.trigger, estimated_onset: null, assumed_lag: null,
  state: "opened", closed_at: null, closed_by: null, available_at: flags.available_at ? e.t : null,
});

/** The runs of a confirming sample: one per test, attempt 1, the visit being the position of the test; it starts at the draw (no transport) and ends when its result arrives. */
export const confirmingRuns = (e: Ev<"confirm_sample_drawn">): RunRow[] =>
  e.tests.map((_, k) => ({
    run_id: `${e.sample_id}/1/${k + 1}`, request_id: e.sample_id, attempt: 1, visit: k + 1, analyzer_name: EXTERNAL_LAB, instrument_id: null, instrument_state_id: null, started_at: e.t, ended_at: null, qc_outcome: null,
  }));

/** The result of a confirming test: the test is the analyte, the value is null and the outcome is the finding (K18). Stamped as a routine result is, by the flags that stamp. */
export const confirmingResult = (e: Ev<"confirm_result">, run_id: string, flags: Flags, n: number): ResultRow => ({
  result_id: `CR${n}`, request_id: e.sample_id, analyte: e.test, version: 1, run_id, value: null, measured_at: e.t, available_at: flags.available_at ? e.t : null, supersedes: null,
  ingested_at: storesIngestedAt(flags) ? e.t : null, reviewed_at: null, state: null, outcome: e.outcome,
});

/**
 * The tables of the extension. A lot row is stored under `material_lot_links` for every lot of the topology, an equipment row under `equipment_links` for every item; their states come from the
 * machines of data_model 15.2 through `transit`: a lot is registered as available, and is in use once an event consumed it. An item is in service. The holds are placed by the investigation of
 * batch 4, so the table is empty here.
 */
export const breakoutTables = (master: BreakoutInput, flags: Flags, links: Links, deviation: DeviationRow[], log?: Transition[]): {
  material_lot: MaterialLotRow[]; equipment: EquipmentRow[]; lineage_edge: LineageEdgeRow[]; deviation: DeviationRow[]; quality_hold: QualityHoldRow[];
} => ({
  material_lot: flags.material_lot_links
    ? master.lots.map((l): MaterialLotRow => {
      const available = transit("material_lot", "prepared", "available", "administrator", log);
      const state = links.consumed.has(l.lot_id) ? transit("material_lot", available, "in_use", "rule", log) : available;
      return { lot_id: l.lot_id, kind: l.kind, cell_line_id: null, prepared_at: l.prepared_at, quantity: null, parent_lot_id: null, state: state as MaterialLotRow["state"] };
    })
    : [],
  equipment: flags.equipment_links ? master.equipment.map((e): EquipmentRow => ({ equipment_id: e.equipment_id, name: e.name, state: "in_service" })) : [],
  lineage_edge: links.edges,
  deviation,
  quality_hold: [],
});
