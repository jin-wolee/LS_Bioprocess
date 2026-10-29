import type { Architecture } from "../record/architecture.ts";
import type { ErrorType } from "./types.ts";

type Flags = Architecture["flags"];

/**
 * Where the mechanism of an error cannot exist (spec section 5 matrix, column "Prevented by"), the rate is zero and a forced error is
 * "prevented". Hand-typed from the matrix; a type with no flag in that column is never prevented.
 *   planned_vs_actual is not a matrix row: it needs the planned time stored (a plan issues the label) and the actual draw time not stored.
 */
export const prevented = (type: ErrorType, f: Flags): boolean => {
  switch (type) {
    case "label_error": return f.system_issued_id;
    case "feed_in_gap": return f.two_clocks;
    case "unit_rekey": return f.write_time_keys;
    case "clock_offset": return false;
    case "duplicate_replay": return f.ingest_idempotency;
    case "lost_rerun": return f.append_only_versions;
    case "unattributable_record": return f.audit_trail;
    case "planned_vs_actual": return !f.system_issued_id || f.two_clocks;
  }
};
