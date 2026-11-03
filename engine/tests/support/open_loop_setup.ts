import { evaluationSettings } from "../../src/evaluate/config.ts";
import type { OpenLoopInput } from "../../src/experiments/assembly/open_loop.ts";
import { loadProfile } from "../../src/profiles.ts";
import { ABLATIONS, parseArchitecture } from "../../src/record/architecture.ts";
import type { Architecture } from "../../src/record/architecture.ts";
import { readJson } from "./paths.ts";
import { SMALL, configOf, lookup } from "./scenarios.ts";

// The inputs of the open-loop tests: the default scenario at a small size, the experienced staff profile, and the thirteen architectures of experiment 1
// (A, B, C and the ten ablations of C, in the order of the flag table). Seeds are test-only values.

const preset = (name: string): Architecture => parseArchitecture(readJson("data", "scenarios", "architectures", `${name}.json`));

export const PRESETS: Architecture[] = ["a_manual", "b_lims_lite", "c_context"].map(preset);
export const ALL_ARCHS: Architecture[] = [...PRESETS, ...ABLATIONS(PRESETS[2] as Architecture).map((x) => x.config)];
export const ALL_IDS = [
  "a_manual", "b_lims_lite", "c_context", "c_context_minus_system_issued_id", "c_context_minus_two_clocks", "c_context_minus_available_at",
  "c_context_minus_instrument_state_snapshot", "c_context_minus_append_only_versions", "c_context_minus_write_time_keys", "c_context_minus_ingest_idempotency",
  "c_context_minus_audit_trail", "c_context_minus_material_lot_links", "c_context_minus_equipment_links",
];

export const STAFF = loadProfile(lookup("staff", "experienced"), "staff").params;

export const openLoopInput = (seeds: readonly number[], over: Partial<OpenLoopInput> = {}): OpenLoopInput => ({
  scenario: configOf("default", { settings: SMALL }),
  seeds,
  staff: STAFF,
  evaluation: evaluationSettings(readJson("data", "scenarios", "evaluation", "default.json")),
  architectures: ALL_ARCHS,
  ...over,
});
