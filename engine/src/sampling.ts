import { wholeSeconds } from "./clock.ts";
import type { Event } from "./generated/event.schema";
import { stateAt } from "./process.ts";
import type { CultureState, ProcessRun } from "./process.ts";
import type { Stage } from "./generated/profile.schema";
import { readAll } from "./profiles.ts";
import type { Params, Profile } from "./profiles.ts";
import type { Rng } from "./rng.ts";

// L2 sampling and logistics (spec 2.2): planned windows to the actual draw, label, transport, aliquot, volume budget.
// Every draw of a sample comes from streams keyed by the sample id alone, so adding or removing another sample never changes it.
// Day 0 is a Monday (A201). The truth state of the culture at the draw is attached to the sample (hidden); stability effects
// between the draw and the run are applied later, at the run (measure.ts).

const DAY = 86400;

export type SamplingPlan = "burst" | "staggered";
export type LabelMethod = "handwritten" | "preprinted_barcode" | "issued_at_draw";

export interface SamplingConfig {
  plan: SamplingPlan;
  label: LabelMethod;
  start_s: number;
  endWeekday_s: number;
  endWeekend_s: number;
  shiftChange_s: number;
  opsPerShift: number;
  weekendOps: number;
  secondFraction: number;
  burstShare: number;
  burstCenter_s: number;
  burstSd_s: number;
  feedStart_s: number;
  feedEnd_s: number;
  transportLo_s: number;
  transportHi_s: number;
  /** Volume of one draw and the cap per reactor, in microlitres (A057, A207). */
  volumeUl: number;
  capUl: number;
  stagger: { start_s: number; window_s: number; offset_s: number; baySize: number };
  delaySd_s: number;
  qualified: boolean;
  /** Clock time of the earliest-deadline rule (A206). */
  deadline_s: number;
  storage: Stage["storage"];
}

/** Microlitres to a millionth, so 4.8 percent of 12.5 mL is exactly 600. */
const roundUl = (x: number): number => Math.round(x * 1e6) / 1e6;

export const samplingConfig = (s: Params, staff: Params, bioreactor: Params, analyzer: Profile, plan: SamplingPlan, label: LabelMethod): SamplingConfig => {
  const v = readAll(s, {
    start: ["staffed_start_min", "min"], endWeekday: ["staffed_end_weekday_min", "min"], endWeekend: ["staffed_end_weekend_min", "min"], shiftChange: ["shift_change_min", "min"],
    opsPerShift: ["operators_per_shift", "operators"], weekendOps: ["weekend_operators", "operators"], perDay: ["samples_per_reactor_per_day", "samples/reactor/day"],
    second: ["second_sample_fraction", "fraction"], burstShare: ["burst_share", "fraction"], burstCenter: ["burst_center_min", "min"], burstSd: ["burst_sd_min", "min"],
    feedStart: ["feed_window_start_min", "min"], feedEnd: ["feed_window_end_min", "min"], transportLo: ["transport_lo_min", "min"], transportHi: ["transport_hi_min", "min"],
    capPct: ["volume_cap_pct", "%"], sStart: ["stagger_bay_start_min", "min"], sWindow: ["stagger_window_min", "min"], sOffset: ["stagger_bay_offset_min", "min"],
    deadline: ["edf_deadline_min", "min"], baySize: ["bay_size", "reactors"],
  });
  const b = readAll(bioreactor, { pct: ["sample_volume_pct", "%"], volume: ["working_volume_l", "L"] });
  const p = readAll(staff, { delaySd: ["delay_sd_min", "min"], qualified: ["qualified", "flag"] });
  if (v.perDay !== 1) throw new Error("S1b plans one regular sample per reactor and day (A014 = 1)");
  const first = analyzer.route?.[0];
  if (!first) throw new Error("the analyzer profile has no route");
  const min = (x: number): number => wholeSeconds(x * 60); // whole seconds once, at load (contract: Time)
  return {
    plan, label, start_s: min(v.start), endWeekday_s: min(v.endWeekday), endWeekend_s: min(v.endWeekend), shiftChange_s: min(v.shiftChange),
    opsPerShift: v.opsPerShift, weekendOps: v.weekendOps, secondFraction: v.second, burstShare: v.burstShare, burstCenter_s: min(v.burstCenter), burstSd_s: min(v.burstSd),
    feedStart_s: min(v.feedStart), feedEnd_s: min(v.feedEnd), transportLo_s: min(v.transportLo), transportHi_s: min(v.transportHi),
    volumeUl: roundUl((b.pct / 100) * b.volume * 1e6), capUl: roundUl((v.capPct / 100) * b.volume * 1e6),
    stagger: { start_s: min(v.sStart), window_s: min(v.sWindow), offset_s: min(v.sOffset), baySize: v.baySize },
    delaySd_s: min(p.delaySd), qualified: p.qualified === 1, deadline_s: min(v.deadline), storage: first.storage,
  };
};

export interface Operator {
  operator_id: string;
  /** Training status in the truth world, from the staff profile (A072, A073). The recorded counterpart is `qualification`. */
  qualified: boolean;
}

export interface SampleRecord {
  sample_id: string;
  unit_id: string;
  batch_id: string;
  operator_id: string;
  planned_s: number;
  drawn_s: number;
  /** Receipt at the analyzer bench (`sample.arrived_at`); equal to drawn_s for a skipped sample, which never arrives. */
  arrived_s: number;
  /** The first 10:00 at or after the draw (A206). */
  deadline_s: number;
  volume_ul: number;
  /** drawn or skipped here; the scenario run sets closed once every visit has passed (data_model section 6). */
  state: "drawn" | "skipped" | "closed";
  aliquot_id?: string;
  true_state?: CultureState;
}

export interface SamplingRun {
  events: Event[];
  samples: SampleRecord[];
  operators: Operator[];
}

const isWeekend = (day: number): boolean => day % 7 >= 5;

export const runSampling = (cfg: SamplingConfig, proc: ProcessRun, seed: number, rng: Rng): SamplingRun => {
  const events: Event[] = [];
  const samples: SampleRecord[] = [];
  const draw = (sample: string, purpose: string) => rng.stream([seed, sample, "-", 0, purpose]);
  const endOf = (day: number): number => (isWeekend(day) ? cfg.endWeekend_s : cfg.endWeekday_s);
  const opId = (n: number): string => `OP-${String(n).padStart(2, "0")}`;
  const operators: Operator[] = Array.from({ length: 2 * cfg.opsPerShift }, (_, i) => ({ operator_id: opId(i + 1), qualified: cfg.qualified }));

  for (const r of proc.reactors) {
    const cands: { id: string; day: number; planned: number; drawn: number; arrived: number; operator: string }[] = [];
    for (let day = Math.floor(r.inoculated_s / DAY) + 1; day * DAY < r.harvested_s; day++) {
      for (const n of [1, 2]) {
        const id = `${r.unit_id}-D${String(day).padStart(2, "0")}-${n}`;
        if (n === 2 && (isWeekend(day) || draw(id, "exists").float() >= cfg.secondFraction)) continue;
        // planned instant: the second sample is uniform in the feed window; a first sample is on the bay window (staggered) or burst or uniform (A202, A203)
        let planned: number;
        if (n === 2) planned = cfg.feedStart_s + draw(id, "plan").float() * (cfg.feedEnd_s - cfg.feedStart_s);
        else if (cfg.plan === "staggered") planned = cfg.stagger.start_s + (r.bay - 1) * cfg.stagger.offset_s + ((r.slot + 0.5) * cfg.stagger.window_s) / cfg.stagger.baySize;
        else {
          const planStream = draw(id, "plan");
          planned = planStream.float() < cfg.burstShare ? cfg.burstCenter_s + cfg.burstSd_s * planStream.gaussian() : cfg.start_s + planStream.float() * (endOf(day) - cfg.start_s);
        }
        const plannedS = day * DAY + wholeSeconds(planned);
        // the draw: the planned instant plus a delay (half-normal with the sd of the staff profile, A063), kept inside the staffed window (A202)
        const delay = wholeSeconds(Math.abs(draw(id, "delay").gaussian()) * cfg.delaySd_s);
        const drawn = Math.min(Math.max(plannedS + delay, day * DAY + cfg.start_s), day * DAY + endOf(day));
        if (drawn >= r.harvested_s) continue;
        const arrived = drawn + wholeSeconds(cfg.transportLo_s + draw(id, "transport").float() * (cfg.transportHi_s - cfg.transportLo_s));
        const weekend = isWeekend(day);
        const pool = weekend ? cfg.weekendOps : cfg.opsPerShift;
        const shift = weekend || drawn - day * DAY < cfg.shiftChange_s ? 0 : 1;
        const operator = opId(shift * cfg.opsPerShift + 1 + draw(id, "operator").int(0, pool - 1));
        cands.push({ id, day, planned: plannedS, drawn, arrived, operator });
      }
    }
    cands.sort((a, b) => a.drawn - b.drawn || (a.id < b.id ? -1 : 1));
    let used = 0;
    for (const c of cands) {
      const sample_id = c.id;
      const base = { sample_id, unit_id: r.unit_id, batch_id: r.batch_id };
      const deadlineToday = Math.floor(c.drawn / DAY) * DAY + cfg.deadline_s;
      const rec: SampleRecord = {
        ...base, operator_id: c.operator, planned_s: c.planned, drawn_s: c.drawn, arrived_s: c.arrived, deadline_s: c.drawn <= deadlineToday ? deadlineToday : deadlineToday + DAY,
        volume_ul: cfg.volumeUl, state: "drawn",
      };
      events.push({ type: "sample_planned", t: c.planned, ...base });
      if (used + cfg.volumeUl > cfg.capUl + 1e-9) {
        rec.state = "skipped";
        rec.arrived_s = c.drawn;
        events.push({ type: "draw_skipped_volume_budget", t: c.drawn, ...base, volume_ul: cfg.volumeUl, cumulative_ul: used });
        samples.push(rec);
        continue;
      }
      used += cfg.volumeUl;
      const label = (t: number): Event => ({ type: "label_bound", t, sample_id, method: cfg.label });
      if (cfg.label === "preprinted_barcode") events.push(label(c.planned));
      else if (cfg.label === "issued_at_draw") events.push(label(c.drawn));
      rec.true_state = stateAt(proc, r.unit_id, c.drawn);
      rec.aliquot_id = `${sample_id}-A1`;
      events.push({ type: "sample_drawn", t: c.drawn, ...base, operator_id: c.operator, volume_ul: cfg.volumeUl, true_state: { ...rec.true_state } });
      if (cfg.label === "handwritten") events.push(label(c.drawn));
      events.push({ type: "sample_received", t: c.arrived, sample_id });
      events.push({ type: "aliquot_created", t: c.arrived, sample_id, aliquot_id: rec.aliquot_id, storage: cfg.storage, volume_ul: cfg.volumeUl });
      samples.push(rec);
    }
  }
  return { events, samples, operators };
};
