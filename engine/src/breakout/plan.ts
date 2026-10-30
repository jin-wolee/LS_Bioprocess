import { batchIdOf, inoculationInstant, unitIdOf } from "../process.ts";
import type { ProcessConfig } from "../process.ts";
import { hoursText } from "./config.ts";
import type { BreakoutConfig } from "./config.ts";

// The script of a break-out event, computed from the scenario block and the process settings before anything runs (spec 11.8.2 rules S1 to S4): which units are affected and when,
// the first signal and the stop of each, the first decision instant, the confirming samples and when their results arrive. The loader calls it for the refusals; the run calls it again
// for the script. For a sampling origin the onset is the instant of a draw of the run, which only the run knows: the loader passes no draw and gets nothing back after the checks it can do.

const DAY = 86400;
const MILLI = 1e6;
/** Microlitres to a millionth, as in sampling.ts: 2 mL is exactly 2000. */
const roundUl = (x: number): number => Math.round(x * MILLI) / MILLI;

export interface UnitScript {
  unit_id: string;
  batch_id: string;
  onset_s: number;
  /** The first sensor tick at or after onset + lag: the instant the true value of the alarm signal reaches its limit. */
  signal_s: number;
  /** signal_at + d1: the unit stops here. */
  stop_s: number;
}

export interface AliquotScript { aliquot_id: string; test: string; volume_ul: number; result_s: number }
export interface ConfirmScript {
  unit_id: string;
  batch_id: string;
  sample_id: string;
  /** Truth: the unit is affected, so every test reports detected. */
  affected: boolean;
  volume_ul: number;
  aliquots: AliquotScript[];
}
/** A consumption or a use that leaves a process-event record (no effect on the culture, rule S4). */
export interface ItemRecord { t: number; unit_id: string; kind: "medium_addition" | "equipment_use"; item_id: string }

export interface BreakoutPlan {
  origin: { kind: BreakoutConfig["origin"]["kind"]; id: string };
  /** The affected units in unit order. */
  units: UnitScript[];
  /** The first signal: the deviation opens here. */
  deviation_s: number;
  /** The first signal plus d1: the confirming samples are drawn here, and the first unit stops. */
  decision_s: number;
  records: ItemRecord[];
  seedLots: Record<string, string>;
  confirm: ConfirmScript[];
}

/** The instant of a draw of the run, by sample id; undefined when the run has no such draw. */
export type DrawInstant = (sample_id: string) => number | undefined;

interface UnitInfo { unit_id: string; index: number; t0: number; end: number }

/** A unit of the run by its id, with its inoculation and its scheduled end (the horizon, or the production length); undefined for any other id, including a non-canonical spelling (U1). */
const unitInfo = (c: ProcessConfig, unit_id: string): UnitInfo | undefined => {
  const m = /^U(\d+)$/.exec(unit_id);
  if (!m) return undefined;
  const index = Number(m[1]) - 1;
  if (index < 0 || index >= c.reactors || unitIdOf(index) !== unit_id) return undefined;
  const t0 = inoculationInstant(c, index);
  return t0 >= c.horizon_s ? undefined : { unit_id, index, t0, end: Math.min(t0 + c.production_s, c.horizon_s) };
};

const originId = (o: BreakoutConfig["origin"]): string =>
  o.kind === "seed_lot" || o.kind === "medium_lot" ? o.lot_id : o.kind === "shared_equipment" ? o.equipment_id : o.kind === "unit_equipment" ? o.unit_id : o.sample_id;

interface Touch { unit_id: string; at_s: number; item: string }

export const planBreakout = (b: BreakoutConfig, scenario: string, c: ProcessConfig, drawn?: DrawInstant): BreakoutPlan | undefined => {
  const fail = (m: string): never => {
    throw new Error(`scenario ${scenario}: ${m}`);
  };
  const unit = (id: string, where: string): UnitInfo => unitInfo(c, id) ?? fail(`breakout ${where} names the unit ${id}, which is not a unit of the run`);
  /** A record of a lot or an item must fall inside the life of its unit: from the inoculation to the scheduled end. */
  const inside = (u: UnitInfo, at_s: number, where: string, what: string): void => {
    if (at_s < u.t0) fail(`breakout ${where} has ${u.unit_id} ${what} at ${hoursText(at_s)} h, before its inoculation at ${hoursText(u.t0)} h`);
    if (at_s >= u.end) fail(`breakout ${where} has ${u.unit_id} ${what} at ${hoursText(at_s)} h, at or after its scheduled end at ${hoursText(u.end)} h`);
  };

  const seedLots: Record<string, string> = {};
  const records: ItemRecord[] = [];
  const touches: Touch[] = [];
  for (const k of b.consumption) {
    const u = unit(k.unit_id, "topology.consumption");
    const seed = b.lots.find((l) => l.lot_id === k.lot_id)?.kind === "seed";
    const at_s = k.at_s ?? u.t0;
    inside(u, at_s, "topology", seed ? `be inoculated from the seed lot ${k.lot_id}` : `consume the medium lot ${k.lot_id}`);
    if (seed) seedLots[k.unit_id] = k.lot_id;
    else records.push({ t: at_s, unit_id: k.unit_id, kind: "medium_addition", item_id: k.lot_id });
    touches.push({ unit_id: k.unit_id, at_s, item: k.lot_id });
  }
  for (const k of b.use) {
    const u = unit(k.unit_id, "topology.use");
    inside(u, k.at_s, "topology", `use the equipment item ${k.equipment_id}`);
    records.push({ t: k.at_s, unit_id: k.unit_id, kind: "equipment_use", item_id: k.equipment_id });
    touches.push({ unit_id: k.unit_id, at_s: k.at_s, item: k.equipment_id });
  }

  // who is touched by the origin, and from when it is contaminated
  const o = b.origin;
  let reach: Touch[];
  let contaminated_s = 0;
  if (o.kind === "seed_lot" || o.kind === "medium_lot" || o.kind === "shared_equipment") {
    const item = o.kind === "shared_equipment" ? o.equipment_id : o.lot_id;
    reach = touches.filter((t) => t.item === item);
    contaminated_s = o.contaminated_s;
  } else if (o.kind === "unit_equipment") {
    inside(unit(o.unit_id, "origin"), o.at_s, "origin", "have its own equipment contaminated");
    reach = [{ unit_id: o.unit_id, at_s: o.at_s, item: o.unit_id }];
  } else {
    const m = /^(U\d+)-D\d+-\d+$/.exec(o.sample_id);
    if (!m) return fail(`breakout origin names the sample ${o.sample_id}, which is not a routine sample id of the form U01-D03-1`);
    unit(m[1] as string, "origin");
    if (drawn === undefined) return undefined; // the loader: the draw instant is only known to the run
    const at_s = drawn(o.sample_id);
    if (at_s === undefined) return fail(`breakout origin names the sample ${o.sample_id}, which no draw of the run produces (it may have been skipped for the volume budget)`);
    reach = [{ unit_id: m[1] as string, at_s, item: o.sample_id }];
  }

  const onsets = new Map<string, number>();
  for (const t of reach) if (t.at_s >= contaminated_s) onsets.set(t.unit_id, Math.min(onsets.get(t.unit_id) ?? Infinity, t.at_s));
  if (onsets.size === 0) fail(`breakout origin ${originId(o)} reaches no unit: no unit consumes or uses it at or after ${hoursText(contaminated_s)} h`);

  // the first signal is the first sensor tick (of the unit, from its inoculation) at or after onset + lag
  const cadence = c.sensors.cadence_s;
  const units: UnitScript[] = [...onsets.entries()]
    .map(([unit_id, onset_s]) => ({ info: unit(unit_id, "origin"), onset_s }))
    .sort((x, y) => x.info.index - y.info.index)
    .map(({ info, onset_s }) => {
      const signal_s = info.t0 + Math.ceil((onset_s + b.lag_s - info.t0) / cadence) * cadence;
      return { unit_id: info.unit_id, batch_id: batchIdOf(info.unit_id), onset_s, signal_s, stop_s: signal_s + b.signal_to_response_s };
    });
  const deviation_s = Math.min(...units.map((u) => u.signal_s));
  const decision_s = deviation_s + b.signal_to_response_s;

  // a consumption or a use after the first decision cannot be stopped in an open-loop run (ruling D5), and every affected unit must be affected before the confirming draws
  if (o.kind === "seed_lot" || o.kind === "medium_lot" || o.kind === "shared_equipment") {
    const what = o.kind === "seed_lot" ? "be inoculated from the contaminated seed lot" : o.kind === "medium_lot" ? "consume the contaminated medium lot" : "use the contaminated equipment item";
    for (const t of reach) {
      if (t.at_s >= decision_s) fail(`breakout topology has ${t.unit_id} ${what} ${t.item} at ${hoursText(t.at_s)} h, at or after the first decision at ${hoursText(decision_s)} h; an open-loop run cannot stop a consumption or a use after the decision (spec 11.8.2 rule S4)`);
    }
  }
  for (const u of units) {
    const end = unit(u.unit_id, "origin").end;
    if (u.stop_s >= end) fail(`breakout stops ${u.unit_id} at ${hoursText(u.stop_s)} h (its first signal at ${hoursText(u.signal_s)} h plus ${hoursText(b.signal_to_response_s)} h), but ${u.unit_id} runs only until ${hoursText(end)} h`);
  }

  // one confirming sample per confirmed unit, drawn at the decision instant; one aliquot per test
  const confirm: ConfirmScript[] = [];
  const latest = { result_s: -1, test: "", unit_id: "" };
  for (const id of b.confirm) {
    const info = unit(id, "confirm");
    if (!(info.t0 <= decision_s && decision_s < info.end)) fail(`breakout confirm names ${id}, which is not running at the first decision (${hoursText(decision_s)} h): it is inoculated at ${hoursText(info.t0)} h and ends at ${hoursText(info.end)} h`);
    const sample_id = `${id}-CONF`;
    const aliquots = b.tests.map((t, i): AliquotScript => ({ aliquot_id: `${sample_id}-A${i + 1}`, test: t.test, volume_ul: roundUl(t.volume_ml * 1000), result_s: decision_s + t.turnaround_s }));
    for (const a of aliquots) if (a.result_s > latest.result_s) Object.assign(latest, { result_s: a.result_s, test: a.test, unit_id: id });
    confirm.push({ unit_id: id, batch_id: batchIdOf(id), sample_id, affected: onsets.has(id), volume_ul: roundUl(aliquots.reduce((sum, a) => sum + a.volume_ul, 0)), aliquots });
  }
  // no result may be open at the end of the run (rule S3): the horizon must hold the latest one
  if (latest.result_s > c.horizon_s) {
    fail(`horizon_days ${c.horizon_s / DAY} ends before the ${latest.test} result of ${latest.unit_id} at ${hoursText(latest.result_s)} h; the latest confirming result needs a horizon of at least ${Math.ceil(latest.result_s / DAY)} d (A189)`);
  }
  return { origin: { kind: o.kind, id: originId(o) }, units, deviation_s, decision_s, records, seedLots, confirm };
};
