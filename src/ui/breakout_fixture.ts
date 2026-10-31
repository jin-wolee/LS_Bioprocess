import type { BreakoutArchitecture, BreakoutResult, BreakoutRow } from "../protocol.ts";
import { FLAGS as BASE_FLAGS, READY } from "./fixture.ts";
import type { ReadyInfo } from "./state.ts";

// A small `ready` payload with the Break-out data, and a hand-typed result, for the unit tests of the Break-out screen (src/ui/breakout_*.test.ts). Typed by hand, so a test of the page does not
// depend on the engine; the real result is tested in engine/tests/lab/breakout.test.ts.

export const FLAGS = [...BASE_FLAGS, "material_lot_links", "equipment_links"];

const flags = (on: readonly string[]): Record<string, boolean> => Object.fromEntries(FLAGS.map((f) => [f, on.includes(f)]));
const preset = (id: string, on: readonly string[], ablated: string | null = null) => ({
  id, role: ablated ? ("ablation" as const) : ("preset" as const), ablated_flag: ablated, flags: flags(on), labelling: "handwritten", capture_path: "manual_transcription",
});

export const BREAKOUT_READY: ReadyInfo = {
  ...READY,
  flags: FLAGS,
  presets: [
    preset("a_manual", []),
    preset("b_lims_lite", ["system_issued_id", "ingest_idempotency", "audit_trail", "equipment_links"]),
    preset("c_context", FLAGS),
    preset("c_context_minus_audit_trail", FLAGS.filter((f) => f !== "audit_trail"), "audit_trail"),
    preset("c_context_minus_material_lot_links", FLAGS.filter((f) => f !== "material_lot_links"), "material_lot_links"),
    preset("c_context_minus_equipment_links", FLAGS.filter((f) => f !== "equipment_links"), "equipment_links"),
  ],
  breakout: {
    cases: [
      { id: "sc12_medium_lot", event_type: "bacterial", origin_kind: "medium_lot" },
      { id: "sc12_mycoplasma", event_type: "mycoplasma", origin_kind: "medium_lot" },
    ],
    seed_list: [9013, 9127, 9239],
    needs: { lots: "material_lot_links", equipment: "equipment_links" },
  },
};

export const ROW_PATHS = [
  ...["batch", "material_lot", "equipment", "result"].flatMap((k) => [`containment.${k}.contained`, `containment.${k}.median_s`, `containment.${k}.p90_s`]),
  ...[1, 3].flatMap((d) => ["recall", "precision", "false_alarm"].map((m) => `identification.direction_${d}.${m}`)),
  "released_before_containment",
  "retro_flag_completeness",
];

const row = (metric: string, over: Partial<BreakoutRow> = {}): BreakoutRow => ({ metric, status: "reported", value: 1, num: 2, den: 2, denominator: "items of T", reason: null, ...over });
const unreachable = (metric: string): BreakoutRow => row(metric, { status: "not_reachable", value: null, num: null, den: null, reason: "not reachable from this record: neither link flag is on" });

export const architecture = (id: string, direction3: boolean): BreakoutArchitecture => ({
  architecture: id,
  reach: { direction3, lots: direction3, equipment: direction3 },
  walk: {
    estimated_onset: 3600 * 52,
    decision_at: 3600 * 78,
    direction_1: [{ kind: "batch", id: "B-U01", path: "the signalling batch" }, { kind: "result", id: "R1", path: "a result of the batch" }],
    direction_3: direction3 ? [{ kind: "material_lot", id: "ML-3", path: "consumed_in" }] : null,
  },
  events: [{ type: "hold_placed", t: 3600 * 78, hold_id: "H1", target_kind: "batch", target_id: "B-U01" }],
  rows: ROW_PATHS.map((p) => (!direction3 && p.startsWith("identification.direction_3.") ? unreachable(p) : row(p))),
  not_evaluable: [],
});

export const RESULT: BreakoutResult = {
  kind: "simulation_result",
  case: "sc12_medium_lot",
  scenario: "sc12_medium_lot",
  seed: 9013,
  engine_version: "9.9.9",
  architectures: ["a_manual", "c_context"],
  truth_log_hash: "abc",
  event: { type: "bacterial", profile: "bacterial", origin_kind: "medium_lot", origin_id: "ML-3", horizon_days: 21, horizon_ref: "A189", contaminated_at: { value: 48, unit: "h", ref: "A157" } },
  inputs: [
    { name: "signal_to_response", ref: "A176", value: 2, unit: "h", source: "scenario_input", what: "d1: from the first signal to the scripted response" },
    { name: "assumed_lag", ref: "A139", value: 12, unit: "h", source: "decision_setting", what: "the walk-back estimates the onset as the first signal minus this" },
  ],
  topology: { ref: "A177", lots: [{ lot_id: "ML-3", kind: "medium", units: ["U01", "U05"], prepared_at_h: 0, uses: [{ unit_id: "U01", at_h: 52 }, { unit_id: "U05", at_h: 62 }] }], equipment: [] },
  observed: [
    { type: "signal_observed", t: 3600 * 76, unit_id: "U01", signal: "DO", limit: "low" },
    { type: "confirm_result", t: 3600 * 200, sample_id: "U01-CONF", test: "bioburden", outcome: "detected" },
  ],
  needs: { lots: "material_lot_links", equipment: "equipment_links" },
  c29: null,
  per_architecture: [architecture("a_manual", false), architecture("c_context", true)],
};
