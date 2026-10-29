import type { Rule } from "./rule_types.ts";

// The QC rule: VR-012 (data_model section 8; section 7, "Review step and VR-012"). Added in the S2 review step; it was parked since S2b.

export const QC_RULES: Rule[] = [
  {
    // The results of a run whose recorded QC outcome failed are held, and at review rejected. The rerun is another run with its own results and outcome, so it stands on its own.
    // `over_range` is a measurement outside the method's range, answered by a diluted rerun in the S1 engine, not a QC failure (VR-006 and VR-013 stay parked). The rule asks for
    // no rerun: that request is already in the stream (spec section 8, anti-gaming rule 4). No flag owns the run's QC outcome, so the rule is evaluable in every architecture.
    id: "VR-012", severity: "error", action: "hold",
    unmet: () => null,
    check: (ds) => {
      const runs = new Map(ds.run.map((x) => [x.run_id, x]));
      return ds.result.filter((r) => runs.get(r.run_id)?.qc_outcome === "qc_failed").map((r) => `result:${r.result_id}`);
    },
  },
];
