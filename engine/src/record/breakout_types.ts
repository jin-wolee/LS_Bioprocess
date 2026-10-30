// The rows of the break-out extension (data_model sections 15.1 and 15.6; spec 11.8): the tables the recorder adds when the scenario has a `breakout` block. They are listed in
// `RecordedDataset` as optional members: absent, not empty, without a block. Nothing here is a truth field.

/** The lots and equipment items of the topology, with what the event stream does not carry (their kind, their preparation time, their name). The hidden `contaminated_at` is not part of it. */
export interface BreakoutInput {
  lots: readonly { lot_id: string; kind: "seed" | "medium"; prepared_at: number }[];
  equipment: readonly { equipment_id: string; name: string }[];
}

/** Break-out, the retro-flag (data_model 15.3; batch 4): the hold that covers a result version. Set on version n+1 only, so every other row and every run without a break-out block has no such column. */
export interface RetroFlagColumn {
  hold_id?: string | null;
}

/** Break-out, the retro-flag (data_model 15.3 item 3): the audit event of a flag names the hold and, with `audit_trail`, carries the person and the reason of the hold. Absent on the audit event of a rerun. */
export interface RetroFlagAudit {
  hold_id?: string;
  placed_by?: string | null;
  reason?: string | null;
}

export type LotState = "prepared" | "available" | "in_use" | "consumed" | "discarded" | "on_hold" | "quarantined";
export type EquipmentState = "in_service" | "on_hold" | "quarantined";
export type DeviationState = "opened" | "contained" | "concluded" | "closed";
export type HoldState = "placed" | "under_test" | "released" | "quarantined" | "rejected" | "closed";

/** Break-out, material_lot_links only (data_model 15.6): one prepared lot of seed or medium. `quantity` and `cell_line_id` are null in S3 (no ledger entry; the cell line waits for S4), `parent_lot_id` is stored and not walked. */
export interface MaterialLotRow {
  lot_id: string;
  kind: "seed" | "medium";
  cell_line_id: string | null;
  prepared_at: number;
  quantity: number | null;
  parent_lot_id: string | null;
  state: LotState;
}

/** Break-out, equipment_links only (data_model 15.1, 15.6): one shared item of equipment that more than one unit uses. */
export interface EquipmentRow {
  equipment_id: string;
  name: string;
  state: EquipmentState;
}

/** Break-out (data_model 15.6): an edge named from its two ends by kind and id. `available_at` is stored only with its flag. */
export interface LineageEdgeRow {
  edge_id: string;
  from_kind: "material_lot" | "equipment";
  from_id: string;
  to_kind: "batch" | "process_event";
  to_id: string;
  relation: "consumed_in" | "seeded_from" | "used_in";
  occurred_at: number;
  available_at: number | null;
}

/** Break-out (data_model 15.1, 15.6): one written record of an unplanned event; `batch_id` is the signalling batch. The estimated onset, the assumed lag and the closing are the investigation's (batch 4), so they are null from the recorder. */
export interface DeviationRow {
  deviation_id: string;
  batch_id: string;
  opened_at: number;
  /** audit_trail only: the role that opened it. */
  opened_by: string | null;
  trigger: "signal" | "test_result";
  estimated_onset: number | null;
  assumed_lag: number | null;
  state: DeviationState;
  closed_at: number | null;
  closed_by: string | null;
  available_at: number | null;
}

/** Break-out (data_model 15.1, 15.6): one hold or quarantine on one item. The investigation of batch 4 places them; the recorder writes none, so the table is empty from it. */
export interface QualityHoldRow {
  hold_id: string;
  deviation_id: string;
  target_kind: "batch" | "material_lot" | "equipment" | "result";
  target_id: string;
  kind: "hold" | "quarantine";
  state: HoldState;
  placed_at: number;
  placed_by: string | null;
  reason: string | null;
  released_at: number | null;
  released_by: string | null;
  outcome: "released" | "rejected" | null;
  available_at: number | null;
}

