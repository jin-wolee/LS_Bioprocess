import type { HistorianRow } from "./types.ts";

// The value of a deadband-logged tag at a time (data_model 16.4, "Reading a deadband-logged series"): rows exist only where the value moved by its deadband or the maximum log
// interval passed (A172), so the value at time t is the last row with `ts` at or before t (step-hold), with its age t - ts. Rows are never interpolated, and a row that the system
// had not yet received at the as-of time (`ingested_at` after it) is invisible to a read as of that time (data_model 5).

export interface TagRead {
  value: number;
  ts: number;
  age_s: number;
}

type Timed = Pick<HistorianRow, "ts" | "ingested_at">;

/**
 * The last row of one tag at or before `t` among the rows known at `asOf`. `rows` are the rows of that one tag in time order (ties in the order of `ingested_at`); for a
 * repeated `ts` the latest ingested row that is visible wins. Undefined when no visible row is at or before `t`.
 */
export const lastRowAt = <R extends Timed>(rows: readonly R[], t: number, asOf = Number.POSITIVE_INFINITY): R | undefined => {
  let lo = 0;
  let hi = rows.length; // the first row with ts > t
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((rows[mid] as R).ts <= t) lo = mid + 1;
    else hi = mid;
  }
  for (let i = lo - 1; i >= 0; i--) if ((rows[i] as R).ingested_at <= asOf) return rows[i];
  return undefined;
};

/** The value of the tag at `t`, with the `ts` of the row it comes from and its age `t - ts` (data_model 16.4). */
export const readTag = (rows: readonly Pick<HistorianRow, "ts" | "value" | "ingested_at">[], t: number, asOf = Number.POSITIVE_INFINITY): TagRead | undefined => {
  const r = lastRowAt(rows, t, asOf);
  return r && { value: r.value, ts: r.ts, age_s: t - r.ts };
};
