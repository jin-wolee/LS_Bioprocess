import type { L3Input, L3Run } from "../src/analysis.ts";
import type { Event } from "../src/generated/event.schema";
import { observe } from "../src/observe.ts";
import { runScenario } from "../src/run.ts";
import type { SampleRecord } from "../src/sampling.ts";
import { canonicalJsonl } from "../src/trace.ts";
import { readJson } from "./support/paths.ts";
import { configOf, lookup, rawScenario } from "./support/scenarios.ts";
import type { Json } from "./support/schemas.ts";
import { loadScenario } from "../src/scenario.ts";

type Ev = Record<string, number | string | boolean | Record<string, number>>;
interface Case {
  seed: number;
  events: Ev[];
  runs: L3Run[];
  input: L3Input;
  samples: SampleRecord[];
  observable: Record<string, unknown>[];
}
const key = (e: { request_id?: unknown; attempt?: unknown; visit?: unknown }): string => `${String(e.request_id)}#${String(e.attempt)}#${String(e.visit)}`;
const num = (v: unknown): number => Number(v);
const evs = (c: Case, type: string): Ev[] => c.events.filter((e) => e.type === type);

const deepFreeze = <T>(o: T): T => {
  if (o && typeof o === "object") {
    Object.values(o).forEach(deepFreeze);
    Object.freeze(o);
  }
  return o;
};

// ---- hidden fields from the schema, perturbed recursively (numbers +1.5, booleans flipped, strings suffixed)
const hiddenTable = (): Map<string, string[]> => {
  const defs = readJson<Json>("data", "schemas", "event.schema.json").$defs as Record<string, Json>;
  const out = new Map<string, string[]>();
  for (const def of Object.values(defs)) {
    const props = def.properties as Record<string, Json> | undefined;
    const type = (props?.type as Json | undefined)?.const;
    if (props && typeof type === "string") out.set(type, Object.entries(props).filter(([, p]) => p["x-visibility"] === "hidden").map(([k]) => k));
  }
  return out;
};
const perturb = (v: unknown): unknown => {
  if (typeof v === "number") return v + 1.5;
  if (typeof v === "boolean") return !v;
  if (typeof v === "string") return `${v}!`;
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, perturb(x)]));
  return v;
};

const checks: Record<string, (c: Case) => string[]> = {
  I1: (c) => {
    const by = new Map<string, [number, number][]>();
    for (const r of c.runs) by.set(r.analyzer, [...(by.get(r.analyzer) ?? []), [r.start_s - r.setup_s, r.end_s]]);
    const bad: string[] = [];
    for (const [a, iv] of by) {
      iv.sort((x, y) => x[0] - y[0]);
      for (let i = 1; i < iv.length; i++) if ((iv[i] as [number, number])[0] < (iv[i - 1] as [number, number])[1]) bad.push(`${a} overlaps at ${(iv[i] as [number, number])[0]}`);
    }
    return bad;
  },
  I2: (c) => {
    const bad: string[] = [];
    const reruns = evs(c, "rerun_requested").length;
    const requests = c.input.requests;
    const visits = requests.reduce((n, r) => n + r.visits.length, 0);
    if (c.runs.length !== visits + reruns) bad.push(`runs ${c.runs.length} != visits ${visits} + reruns ${reruns}`);
    for (const t of ["qc_result", "result_measured", "visit_finished"]) {
      const n = evs(c, t).length;
      if (t === "result_measured" ? n < c.runs.length : n !== c.runs.length) bad.push(`${t}: ${n} for ${c.runs.length} runs`);
    }
    for (const r of requests) {
      r.visits.forEach((_, v) => {
        const runs = c.runs.filter((x) => x.request_id === r.request_id && x.visit === v + 1);
        if (runs.filter((x) => x.outcome === "qc_passed").length !== 1 || runs[runs.length - 1]?.outcome !== "qc_passed") bad.push(`${r.request_id} visit ${v + 1} has no single final pass`);
      });
    }
    // sample level: planned = drawn + skipped, and each sample ends in exactly one terminal state (data_model section 6)
    const planned = evs(c, "sample_planned").length;
    const skipped = new Set(evs(c, "draw_skipped_volume_budget").map((e) => String(e.sample_id)));
    const drawn = new Set(evs(c, "sample_drawn").map((e) => String(e.sample_id)));
    if (planned !== c.samples.length || planned !== drawn.size + skipped.size) bad.push(`planned ${planned}, drawn ${drawn.size}, skipped ${skipped.size}, records ${c.samples.length}`);
    const passed = new Map<string, number>();
    for (const r of c.runs) if (r.outcome === "qc_passed") passed.set(r.request_id, (passed.get(r.request_id) ?? 0) + 1);
    const visitsOf = new Map(requests.map((r) => [r.request_id, r.visits.length] as const));
    for (const s of c.samples) {
      const terminal: string = skipped.has(s.sample_id) ? "skipped" : drawn.has(s.sample_id) && passed.get(s.sample_id) === visitsOf.get(s.sample_id) ? "closed" : "open";
      if (terminal === "open") bad.push(`${s.sample_id}: neither skipped nor closed (record says ${s.state})`);
      else if (s.state !== terminal) bad.push(`${s.sample_id}: state ${s.state}, derived ${terminal}`);
      if (skipped.has(s.sample_id) && drawn.has(s.sample_id)) bad.push(`${s.sample_id} both drawn and skipped`);
    }
    if (c.input.requests.length !== drawn.size) bad.push(`${c.input.requests.length} requests for ${drawn.size} drawn samples`);
    return bad;
  },
  I3: (c) => {
    const bad: string[] = [];
    const measured = evs(c, "result_measured");
    const keys = measured.map((e) => `${key(e)}#${String(e.analyte)}`);
    if (new Set(keys).size !== keys.length) bad.push("a result key repeats");
    for (const e of evs(c, "rerun_requested")) {
      if (!measured.some((m) => m.request_id === e.request_id && m.visit === e.visit && m.attempt === e.attempt)) bad.push(`${key(e)}: rerun without the measured attempt`);
      if (!measured.some((m) => m.request_id === e.request_id && m.visit === e.visit && num(m.attempt) === num(e.attempt) + 1)) bad.push(`${key(e)}: rerun without a next attempt`);
    }
    return bad;
  },
  I4: (c) => {
    const bad: string[] = [];
    const drawn = new Map(evs(c, "sample_drawn").map((e) => [String(e.sample_id), num(e.t)] as const));
    const received = new Map(evs(c, "sample_received").map((e) => [String(e.sample_id), num(e.t)] as const));
    const planned = new Map(evs(c, "sample_planned").map((e) => [String(e.sample_id), num(e.t)] as const));
    const queued = new Map(evs(c, "request_queued").map((e) => [key(e), num(e.t)] as const));
    for (const [id, d] of drawn) {
      if (!((planned.get(id) as number) <= d && d <= (received.get(id) as number))) bad.push(`${id}: planned/drawn/received out of order`);
      if (queued.get(`${id}#1#1`) !== received.get(id)) bad.push(`${id}: sample_received is not the first request_queued instant`);
    }
    for (const r of c.runs) {
      const arrived = queued.get(key(r)) as number;
      const sampled = drawn.get(r.request_id) as number;
      if (!(sampled <= arrived && arrived <= r.start_s - r.setup_s && r.start_s < r.end_s && r.start_s - sampled >= 0)) bad.push(`${key(r)}: sampled ${sampled}, arrived ${arrived}, start ${r.start_s}, end ${r.end_s}`);
    }
    return bad;
  },
  I5: (c) =>
    c.runs.flatMap((r) =>
      c.input.windows.filter((w) => w.analyzer === r.analyzer && r.start_s - r.setup_s < w.end_s && w.start_s < r.end_s).map((w) => `${key(r)} meets [${w.start_s}, ${w.end_s}) on ${r.analyzer}`),
    ),
  I6: (c) => {
    const bad: string[] = [];
    const groupOf = new Map(c.input.analyzers.map((a) => [a.id, a.group] as const));
    const deadline = new Map(c.input.requests.map((r) => [r.request_id, r.deadline_s ?? Infinity] as const));
    type Entry = { k: string; group: string; t: number; seq: number; dl: number };
    const waiting: Entry[] = [];
    for (const e of c.events) {
      if (e.type === "request_queued") waiting.push({ k: key(e), group: String(e.group), t: num(e.t), seq: num(e.seq), dl: deadline.get(String(e.request_id)) as number });
      if (e.type !== "visit_started") continue;
      const group = groupOf.get(String(e.analyzer)) as string;
      const order = (a: Entry, b: Entry): number => (c.input.policy === "edf" ? (a.dl === b.dl ? 0 : a.dl < b.dl ? -1 : 1) : 0) || a.t - b.t || a.seq - b.seq;
      const head = waiting.filter((w) => w.group === group).sort(order)[0] as Entry;
      if (key(e) !== head.k) bad.push(`${c.input.policy} head at t=${String(e.t)} in ${group}: took ${key(e)}, expected ${head.k}`);
      waiting.splice(waiting.indexOf(head), 1);
    }
    if (waiting.length > 0) bad.push(`${waiting.length} requests never started`);
    return bad;
  },
  I8: (c) => {
    const table = hiddenTable();
    const perturbed = c.events.map((e) => {
      const copy: Ev = { ...e };
      for (const f of table.get(String(e.type)) ?? []) copy[f] = perturb(copy[f]) as never;
      return copy;
    });
    const bad: string[] = [];
    const view = canonicalJsonl(observe(c.events as unknown as Event[]));
    if (canonicalJsonl(observe(perturbed as unknown as Event[])) !== view) bad.push("recorder-visible output changed when hidden fields changed");
    if (canonicalJsonl(c.observable) !== view) bad.push("run.observable is not the projection of the truth log");
    for (const e of c.observable as Ev[]) for (const f of table.get(String(e.type)) ?? []) if (f in e) bad.push(`${String(e.type)}.${f} leaked`);
    if (!perturbed.some((e, i) => JSON.stringify(e) !== JSON.stringify(c.events[i]))) bad.push("the perturbation changed nothing (vacuous)");
    return bad;
  },
  I10: (c) => {
    const bad: string[] = [];
    const cap = 0.33 * 2_000_000; // 33 percent (A207) of the 2 L bench vessel (A002) in uL, written out for the independent check
    const per = new Map<string, number>();
    for (const e of evs(c, "sample_drawn")) per.set(String(e.unit_id), (per.get(String(e.unit_id)) ?? 0) + num(e.volume_ul));
    for (const [u, v] of per) if (v > cap + 1e-6) bad.push(`${u} drew ${v} uL of ${cap}`);
    return bad;
  },
};
export function checkSeeds(seeds: number[]): Record<string, [number, string[]][]> {
  const violations: Record<string, Map<number, string[]>> = Object.fromEntries(
    [...Object.keys(checks), "I3b", "I7"].map((name) => [name, new Map<number, string[]>()]),
  );
  const cfg = configOf("default");
  const noReruns = loadScenario({ ...rawScenario("default"), settings: { ...(rawScenario("default").settings as Record<string, Json>), rerun_probability: { value: 0, unit: "fraction", ref: "A088" } } }, lookup);
  const frozen = deepFreeze(structuredClone(cfg));
  for (const seed of seeds) {
    const r = runScenario({ ...cfg, seed });
    const c: Case = { seed, events: r.events as unknown as Ev[], runs: r.runs, input: r.l3Input, samples: r.samples, observable: r.observable };
    for (const [name, check] of Object.entries(checks)) violations[name]?.set(seed, check(c));
    // I3: the engine does not write into its input, and a second run leaves the first log byte-identical
    const again = runScenario({ ...frozen, seed });
    const before = canonicalJsonl(r.events);
    violations.I3b?.set(seed, canonicalJsonl(again.events) === before && canonicalJsonl(r.events) === before ? [] : ["a second run differs from the first"]);
    // I7: reruns never change another sample's draws; the L2 draws of a sample do not depend on which other samples exist
    const bad: string[] = [];
    const control = runScenario({ ...noReruns, seed });
    const noise = (events: readonly Event[]) => new Map(events.filter((e) => e.type === "result_measured").map((e) => [`${key(e)}#${(e as { analyte: string }).analyte}`, (e as { noise: number }).noise] as const));
    const withReruns = noise(r.events);
    let common = 0;
    for (const [k, v] of noise(control.events)) {
      const w = withReruns.get(k);
      if (w === undefined) continue;
      common++;
      if (w !== v) bad.push(`noise of ${k} changed`);
    }
    if (common < 100) bad.push(`only ${common} common draws (vacuous)`);
    for (const e of evs(c, "rerun_requested")) {
      const a = [...withReruns].find(([k]) => k.startsWith(`${key(e)}#`));
      const b = [...withReruns].find(([k]) => k.startsWith(`${String(e.request_id)}#${num(e.attempt) + 1}#${String(e.visit)}#`));
      if (a && b && a[1] === b[1]) bad.push(`attempts of ${String(e.request_id)} share a noise draw`);
      break;
    }
    const full = new Map(r.samples.map((s) => [s.sample_id, s] as const));
    const more = runScenario({ ...loadScenario({ ...rawScenario("default"), settings: { ...(rawScenario("default").settings as Record<string, Json>), second_sample_fraction: { value: 1, unit: "fraction", ref: "A015" } } }, lookup), seed });
    let shared = 0;
    for (const s of more.samples) {
      const o = full.get(s.sample_id);
      if (!o || o.state === "skipped" || s.state === "skipped") continue;
      shared++;
      if (o.planned_s !== s.planned_s || o.drawn_s !== s.drawn_s || o.arrived_s !== s.arrived_s || o.operator_id !== s.operator_id) bad.push(`L2 draws of ${s.sample_id} changed with another sample present`);
    }
    if (shared < 100) bad.push(`only ${shared} shared samples (vacuous)`);
    violations.I7?.set(seed, bad.slice(0, 5));
  }
  return Object.fromEntries(Object.entries(violations).map(([name, map]) => [name, [...map]]));
}
