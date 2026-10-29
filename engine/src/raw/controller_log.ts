import type { ControllerProfile, TagRow, TagSeries } from "./controller_types.ts";

// RQ9 (spec 2.4.3): a controller logs a tag when its value has moved by the tag's deadband since the last logged value, or when the maximum log interval has passed since
// the last logged row (A172: a value is logged when it changes by its deadband or when the maximum log interval has passed). A limit counts when it is reached at equality.
// The first value of a series is always logged. The series that results is irregular, and the reader takes the last row at or before a time (data_model 16.4).

export interface LogRule {
  /** The logging deadband of a tag, in the unit of its value. */
  deadband: (tag: Pick<TagSeries, "unit" | "signal" | "role">) => number;
  /** The maximum log interval in seconds. */
  max_interval_s: number;
}

/** Log the series: rows in time order, ties in the order of the series. A series is read once, by index, so a series of any length costs one pass. */
export const logTags = (series: readonly TagSeries[], rule: LogRule): TagRow[] => {
  const out: { row: TagRow; order: number }[] = [];
  series.forEach((s, order) => {
    const band = rule.deadband(s);
    let lastValue = Number.NaN;
    let lastTs = Number.NEGATIVE_INFINITY;
    for (let j = 0; j < s.n; j++) {
      const value = s.at(j);
      const ts = s.t0_s + j * s.cadence_s;
      if (j === 0 || Math.abs(value - lastValue) >= band || ts - lastTs >= rule.max_interval_s) {
        out.push({ row: { unit: s.unit, signal: s.signal, role: s.role, ts, value }, order });
        lastValue = value;
        lastTs = ts;
      }
    }
  });
  return out.sort((a, b) => a.row.ts - b.row.ts || a.order - b.order).map((x) => x.row);
};

/** The parameter name of a tag's logging deadband in the controller profile: signal, role, `_log_deadband` (`ph_pv_log_deadband`). */
export const deadbandName = (tag: Pick<TagSeries, "signal" | "role">): string => `${tag.signal.toLowerCase()}_${tag.role.toLowerCase()}_log_deadband`;

/** The logging rule of a controller profile: the deadbands of A178 and A172 and the maximum interval of A179. A tag with no parameter has no ledger entry, and no number is invented. */
export const logRuleOf = (profile: ControllerProfile): LogRule => {
  const max = profile.params.max_log_interval;
  if (!max || max.unit !== "min") throw new Error(`controller profile ${profile.profile_id}: max_log_interval (A179) is missing or not in minutes`);
  return {
    max_interval_s: Math.round(max.value * 60),
    deadband: (tag) => {
      const name = deadbandName(tag);
      const p = profile.params[name];
      if (!p) throw new Error(`controller profile ${profile.profile_id}: no logging deadband ${name} for the tag ${tag.unit}.${tag.signal}.${tag.role}; the ledger gives none (A178 has no row for the feed pump, the individual gas flows or an off-gas analyzer) and none is invented`);
      return p.value;
    },
  };
};
