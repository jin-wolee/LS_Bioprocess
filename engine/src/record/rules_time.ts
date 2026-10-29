import { storesIngestedAt } from "./results.ts";
import { TWO_CLOCKS, bySampleId } from "./rule_types.ts";
import type { Rule } from "./rule_types.ts";
import type { RecordedDataset } from "./types.ts";

// The time rules: VR-002, VR-003, VR-004 and VR-010 (data_model sections 5 and 8; spec section 5, "Detection rules and the flags they need").

const INGESTED = (ds: RecordedDataset): string | null => (storesIngestedAt(ds.architecture.flags) ? null : "ingested_at is not stored (no system writes the rows: every flag is off)");
const needing = (check: (ds: RecordedDataset) => string | null, setting: (c: { late_tolerance_s?: number; clock_tolerance_s?: number; hold_limit_s?: number }) => number | undefined, what: string): Rule["unmet"] =>
  (ds, cfg) => check(ds) ?? (setting(cfg) === undefined ? `${what} is not configured` : null);

export const TIME_RULES: Rule[] = [
  {
    id: "VR-002", severity: "error", action: "quarantine",
    unmet: TWO_CLOCKS,
    check: (ds) => {
      const samples = bySampleId(ds);
      return ds.result.filter((r) => {
        const at = samples.get(r.request_id)?.sampled_at;
        return at !== null && at !== undefined && at > r.measured_at;
      }).map((r) => `result:${r.result_id}`);
    },
  },
  {
    id: "VR-003", severity: "warning", action: "hold",
    unmet: needing(INGESTED, (c) => c.late_tolerance_s, "the VR-003 tolerance"),
    check: (ds, cfg) => ds.result.filter((r) => r.ingested_at !== null && r.measured_at - r.ingested_at > (cfg.late_tolerance_s as number)).map((r) => `result:${r.result_id}`),
  },
  {
    id: "VR-004", severity: "error", action: "hold",
    unmet: needing(INGESTED, (c) => c.clock_tolerance_s, "the VR-004 tolerance"),
    check: (ds, cfg) => ds.result.filter((r) => r.ingested_at !== null && Math.abs(r.measured_at - r.ingested_at) > (cfg.clock_tolerance_s as number)).map((r) => `result:${r.result_id}`),
  },
  {
    id: "VR-010", severity: "warning", action: "hold",
    unmet: needing(TWO_CLOCKS, (c) => c.hold_limit_s, "the hold-time limit"),
    check: (ds, cfg) => {
      const samples = bySampleId(ds);
      const runs = new Map(ds.run.map((x) => [x.run_id, x]));
      return ds.result.filter((r) => {
        const at = samples.get(r.request_id)?.sampled_at;
        const run = runs.get(r.run_id);
        return at !== null && at !== undefined && run !== undefined && run.started_at - at > (cfg.hold_limit_s as number); // hold_time = run_started_at - sampled_at
      }).map((r) => `result:${r.result_id}`);
    },
  },
];
