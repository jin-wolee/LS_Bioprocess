// 2026-10-30 S2c3, experiment 2 (spec 6.2, section 3 rule 2): the oracle arm. It is the one place that decides with truth: it readjusts the probe onto the true pH of the
// newest sample whose pH result exists at the decision time, that is the offline value without any container, hold or analyzer error. It is given the samples of one reactor
// as plain data by the assembly and uses the same lab timing as the other arms (a sample exists for the decision once its first pH result exists), so the paired difference
// against it isolates the error of the offline value and the architecture's use of its context.

export interface TruthValue {
  sample_id: string;
  /** The instant the first pH result of the sample exists. */
  result_t: number;
  /** The true pH of the culture at the draw. */
  true_ph: number;
}

export interface OracleReference {
  onto: number;
  sample_id: string;
  result_t: number;
}

/** The newest sample with `since` < result time <= `t` (since: the result time of the sample the oracle used last, -1 for none), or null. */
export const oracleReference = (values: readonly TruthValue[], t: number, since: number): OracleReference | null => {
  const newest = values.filter((v) => v.result_t <= t && v.result_t > since).sort((a, b) => b.result_t - a.result_t || (a.sample_id < b.sample_id ? -1 : 1))[0];
  return newest ? { onto: newest.true_ph, sample_id: newest.sample_id, result_t: newest.result_t } : null;
};
