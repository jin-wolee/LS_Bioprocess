import type { ReadyInfo } from "./state.ts";

// A small `ready` payload for the unit tests of the page (src/**/*.test.ts): two bioreactor profiles, two analyzer profiles, the presets A, B, C and two ablations of C, thirty seeds.
// Typed by hand, so a test of the page does not depend on the engine; the real payload is tested in engine/tests/lab/ready_full.test.ts.

export const FLAGS = ["system_issued_id", "two_clocks", "available_at", "instrument_state_snapshot", "append_only_versions", "write_time_keys", "ingest_idempotency", "audit_trail"];

const flags = (on: readonly string[]): Record<string, boolean> => Object.fromEntries(FLAGS.map((f) => [f, on.includes(f)]));
const preset = (id: string, on: readonly string[], ablated: string | null = null) => ({
  id,
  role: ablated ? ("ablation" as const) : ("preset" as const),
  ablated_flag: ablated,
  flags: flags(on),
  labelling: "handwritten",
  capture_path: "manual_transcription",
});

export const READY: ReadyInfo = {
  engine_version: "9.9.9",
  schema_version: "1",
  flags: FLAGS,
  min_seeds: 20,
  seed_list: Array.from({ length: 30 }, (_, i) => 1000 + i * 7),
  scenarios: [
    {
      id: "default",
      description: "the default",
      settings: [
        { name: "reactor_count", value: 24, unit: "reactors", ref: "A001" },
        { name: "bay_size", value: 12, unit: "reactors", ref: "A001" },
        { name: "analyzer_count", value: 2, unit: "analyzers", ref: "A022" },
      ],
      profiles: { bioreactor: "bench_manual", analyzer: "allinone_atline", staff: "experienced" },
    },
    {
      id: "small",
      description: "a small one",
      settings: [
        { name: "reactor_count", value: 6, unit: "reactors", ref: "A001" },
        { name: "bay_size", value: 6, unit: "reactors", ref: "A001" },
        { name: "analyzer_count", value: 1, unit: "analyzers", ref: "A022" },
      ],
      profiles: { bioreactor: "pilot", analyzer: "hplc", staff: "experienced" },
    },
  ],
  profiles: [
    { kind: "bioreactor", id: "bench_manual", bundle: "A067", description: "bench" },
    { kind: "bioreactor", id: "pilot", bundle: "A068", description: "pilot" },
    { kind: "analyzer", id: "allinone_atline", bundle: "A069", description: "aio", stages: [{ group: "AIO", analytes: ["vcd", "glucose"] }] },
    { kind: "analyzer", id: "hplc", bundle: "A071", description: "hplc", stages: [{ group: "HPLC", analytes: ["titer"] }] },
    { kind: "staff", id: "experienced", bundle: "A072", description: "staff" },
  ],
  presets: [
    preset("a_manual", []),
    preset("b_lims_lite", ["system_issued_id", "ingest_idempotency", "audit_trail"]),
    preset("c_context", FLAGS),
    preset("c_context_minus_system_issued_id", FLAGS.filter((f) => f !== "system_issued_id"), "system_issued_id"),
    preset("c_context_minus_audit_trail", FLAGS.filter((f) => f !== "audit_trail"), "audit_trail"),
  ],
  evaluation: [
    { name: "staffed_window_h", value: 10, unit: "h", ref: "A098" },
    { name: "min_seeds", value: 20, unit: "seeds", ref: "A103" },
  ],
  challenge_variants: ["sample", "decision"],
  decision_seed_list: Array.from({ length: 30 }, (_, i) => 5000 + i * 11),
  challenge_records: [
    { id: "a_manual", sample: true, decision: true },
    { id: "b_lims_lite", sample: true, decision: false },
    { id: "c_context", sample: false, decision: false },
    { id: "c_context_minus_system_issued_id", sample: true, decision: true },
    { id: "c_context_minus_audit_trail", sample: false, decision: false },
  ],
  breakout: null,
};
