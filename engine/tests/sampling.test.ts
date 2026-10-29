import { describe, expect, it } from "vitest";
import type { Event } from "../src/generated/event.schema";
import { runProcess, stateAt } from "../src/process.ts";
import { createRng } from "../src/rng.ts";
import { runSampling } from "../src/sampling.ts";
import type { SamplingRun } from "../src/sampling.ts";
import { DAY, dayOf, isWeekend, mean } from "./support/metrics.ts";
import { configOf } from "./support/scenarios.ts";
import type { Patch } from "./support/scenarios.ts";

// L2 sampling and logistics (spec 2.2). Expected values are calendar arithmetic and ledger values quoted in the titles.
// Day 0 is a Monday, so day % 7 >= 5 is a weekend (A201).

const sampled = (patch: Patch = {}, name = "default") => {
  const cfg = configOf(name, { ...patch, settings: { death_per_h: 0, ...patch.settings } });
  const rng = createRng();
  const proc = runProcess(cfg.process, cfg.seed, rng);
  return { proc, ...runSampling(cfg.sampling, proc, cfg.seed, rng) } as SamplingRun & { proc: ReturnType<typeof runProcess> };
};
const tod = (t: number): number => t % DAY;
const of = (ev: readonly Event[], type: string) => ev.filter((e) => e.type === type) as unknown as Record<string, unknown>[];

describe("L2: planned windows to the actual draw", () => {
  const run = sampled({ settings: { second_sample_fraction: 1 } });
  const drawn = run.samples.filter((s) => s.state === "drawn");

  it("Given a 14 d batch When samples are planned Then each reactor has one first sample per day from the day after inoculation, sample ids are unique and keyed by unit, day and index", () => {
    expect(new Set(run.samples.map((s) => s.sample_id)).size).toBe(run.samples.length);
    for (const s of run.samples) expect(s.sample_id).toMatch(/^U\d{2}-D\d{2}-[12]$/);
    for (const r of run.proc.reactors) {
      const d0 = dayOf(r.inoculated_s);
      const first = run.samples.filter((s) => s.unit_id === r.unit_id && s.sample_id.endsWith("-1")).map((s) => dayOf(s.drawn_s));
      for (let d = d0 + 1; d <= d0 + 13; d++) expect(first, `${r.unit_id} day ${d}`).toContain(d);
      expect(Math.max(...first)).toBeLessThanOrEqual(d0 + 14);
      for (const s of run.samples.filter((x) => x.unit_id === r.unit_id)) {
        expect(s.drawn_s).toBeGreaterThan(r.inoculated_s);
        expect(s.drawn_s).toBeLessThan(r.harvested_s);
      }
    }
  });

  it("Then every draw falls inside the staffed window of its day: 08:00 to 18:00 on weekdays, 08:00 to 14:00 on weekends (A201)", () => {
    for (const s of drawn) {
      const end = isWeekend(dayOf(s.drawn_s)) ? 840 : 1080;
      expect(tod(s.drawn_s), s.sample_id).toBeGreaterThanOrEqual(480 * 60);
      expect(tod(s.drawn_s), s.sample_id).toBeLessThanOrEqual(end * 60);
    }
  });

  it("Then there is no second sample on a weekend day, first samples still happen on weekends, and a second sample is planned inside the 09:00 to 11:00 feed window (A015, A194)", () => {
    const second = run.samples.filter((s) => s.sample_id.endsWith("-2"));
    expect(second.length).toBeGreaterThan(100);
    for (const s of second) {
      expect(isWeekend(dayOf(s.planned_s)), s.sample_id).toBe(false);
      expect(tod(s.planned_s), s.sample_id).toBeGreaterThanOrEqual(540 * 60);
      expect(tod(s.planned_s), s.sample_id).toBeLessThanOrEqual(660 * 60);
    }
    expect(run.samples.some((s) => s.sample_id.endsWith("-1") && isWeekend(dayOf(s.planned_s)))).toBe(true);
  });

  it("Then the draw is never earlier than the plan, and the delay is added to the plan (A063)", () => {
    for (const s of drawn) expect(s.drawn_s, s.sample_id).toBeGreaterThanOrEqual(s.planned_s);
  });

  it("Then the sample arrives 10 to 25 min after the draw (A018), at whole seconds", () => {
    for (const s of drawn) {
      expect(Number.isInteger(s.arrived_s)).toBe(true);
      expect(s.arrived_s - s.drawn_s, s.sample_id).toBeGreaterThanOrEqual(600);
      expect(s.arrived_s - s.drawn_s, s.sample_id).toBeLessThanOrEqual(1500);
    }
  });

  it("Then the EDF deadline is the first 10:00 at or after the draw (A206): same day before 10:00, next day after", () => {
    for (const s of drawn) {
      const d = dayOf(s.drawn_s);
      expect(s.deadline_s, s.sample_id).toBe(tod(s.drawn_s) <= 36000 ? d * DAY + 36000 : (d + 1) * DAY + 36000);
    }
  });
});

describe("L2: the shift-start burst and the staggered window (A016, A202, A203)", () => {
  it("Given only burst samples When their planned times are read Then they are normal around 08:30 with sd 18 min (A016)", () => {
    const run = sampled({ settings: { burst_share: 1, second_sample_fraction: 0 } });
    const m = run.samples.map((s) => tod(s.planned_s) / 60);
    const mu = mean(m);
    const sd = Math.sqrt(mean(m.map((x) => (x - mu) ** 2)));
    expect(Math.abs(mu - 510)).toBeLessThan(3);
    expect(Math.abs(sd - 18)).toBeLessThan(3);
  });

  it("Given the staggered plan When bay windows are 45 min wide and 45 min apart Then reactor j of a bay is planned at start + (j + 0.5) x 45/12 min, rounded to a whole second", () => {
    const run = sampled({ sampling_plan: "staggered" });
    const plan = (id: string) => run.samples.find((s) => s.sample_id === id)?.planned_s;
    expect(plan("U01-D01-1")).toBe(DAY + 28913); // 480 + 1.875 min = 28912.5 s
    expect(plan("U02-D01-1")).toBe(DAY + 29138); // 480 + 5.625 min = 29137.5 s
    expect(plan("U13-D03-1")).toBe(3 * DAY + 31613); // bay 2 starts at 525 min: 526.875 min = 31612.5 s; U13 is inoculated on day 2
  });
});

describe("L2: staff, roster and labels", () => {
  it("Given the roster of A201 and A098 When operators draw Then weekday draws before 13:00 are by OP-01 or OP-02, after by OP-03 or OP-04, weekend draws by OP-01", () => {
    const run = sampled();
    for (const s of run.samples.filter((x) => x.state === "drawn")) {
      const weekend = isWeekend(dayOf(s.drawn_s));
      const allowed = weekend ? ["OP-01"] : tod(s.drawn_s) < 780 * 60 ? ["OP-01", "OP-02"] : ["OP-03", "OP-04"];
      expect(allowed, `${s.sample_id} by ${s.operator_id}`).toContain(s.operator_id);
    }
    expect(of(run.events, "sample_drawn").every((e) => typeof e.operator_id === "string")).toBe(true);
  });

  it("Then the staff profile decides operator.qualified: experienced true, trainee false, and trainee delays are longer (A072, A073, A063)", () => {
    const exp = sampled();
    const tr = sampled({ profiles: { staff: "trainee" } });
    expect(exp.operators).toEqual(["OP-01", "OP-02", "OP-03", "OP-04"].map((operator_id) => ({ operator_id, qualified: true })));
    expect(tr.operators.every((o) => !o.qualified)).toBe(true);
    const delay = (r: typeof exp) => mean(r.samples.filter((s) => s.state === "drawn").map((s) => s.drawn_s - s.planned_s));
    expect(delay(tr)).toBeGreaterThan(delay(exp));
  });

  it.each([
    ["preprinted_barcode", "before", "planned_s"],
    ["issued_at_draw", "before", "drawn_s"],
    ["handwritten", "after", "drawn_s"],
  ] as const)("Given label method %s When a sample is drawn Then label_bound is %s the draw in the log and its instant is the %s", (method, where, instant) => {
    const run = sampled({ label_method: method });
    const s = run.samples.find((x) => x.state === "drawn") as SamplingRun["samples"][number];
    const idx = (type: string) => run.events.findIndex((e) => e.type === type && (e as { sample_id?: string }).sample_id === s.sample_id);
    const label = run.events[idx("label_bound")] as { t: number; method: string };
    expect(label.method).toBe(method);
    expect(label.t).toBe(s[instant]);
    if (where === "before") expect(idx("label_bound")).toBeLessThan(idx("sample_drawn"));
    else expect(idx("label_bound")).toBeGreaterThan(idx("sample_drawn"));
  });

  it("Then the events of one sample are planned, drawn, received and an aliquot at the arrival instant with the storage of A021", () => {
    const run = sampled();
    const s = run.samples.find((x) => x.state === "drawn") as SamplingRun["samples"][number];
    const mine = run.events.filter((e) => (e as { sample_id?: string }).sample_id === s.sample_id).map((e) => e.type);
    expect(mine.filter((t) => t !== "label_bound")).toEqual(["sample_planned", "sample_drawn", "sample_received", "aliquot_created"]);
    const alq = of(run.events, "aliquot_created").find((e) => e.sample_id === s.sample_id);
    expect(alq).toMatchObject({ t: s.arrived_s, aliquot_id: `${s.sample_id}-A1`, storage: "room_temperature", volume_ul: s.volume_ul });
    expect(sampled({ profiles: { analyzer: "hplc" } }).events.find((e) => e.type === "aliquot_created")).toMatchObject({ storage: "frozen" });
  });

  it("Then sample_drawn carries the hidden true state of the culture at the draw instant", () => {
    const run = sampled();
    for (const e of of(run.events, "sample_drawn").slice(0, 8)) {
      expect(e.true_state, String(e.sample_id)).toEqual(stateAt(run.proc, String(e.unit_id), Number(e.t)));
    }
  });
});

describe("L2: volume budget (A207, A057)", () => {
  it("Given the micro-scale profile (600 uL of 12.5 mL, cap 33 percent = 4125 uL) When a reactor is sampled daily Then 6 draws fit, the rest are skipped and logged, and every skip is a sample in state skipped", () => {
    const run = sampled({ profiles: { bioreactor: "micro_mini_parallel" } });
    for (const r of run.proc.reactors) {
      const mine = run.samples.filter((s) => s.unit_id === r.unit_id);
      const ok = mine.filter((s) => s.state === "drawn");
      expect(ok, r.unit_id).toHaveLength(6);
      expect(ok.every((s) => s.volume_ul === 600)).toBe(true);
      expect(mine.filter((s) => s.state === "skipped").length).toBeGreaterThan(0);
    }
    const skips = of(run.events, "draw_skipped_volume_budget");
    expect(skips.length).toBe(run.samples.filter((s) => s.state === "skipped").length);
    expect(skips.every((e) => e.cumulative_ul === 3600 && e.volume_ul === 600)).toBe(true);
    const skipped = new Set(run.samples.filter((s) => s.state === "skipped").map((s) => s.sample_id));
    expect(of(run.events, "sample_received").some((e) => skipped.has(String(e.sample_id)))).toBe(false);
  });

  it("Given the bench profile (280 uL of 2 L) Then nothing is skipped on a 14 d batch", () => {
    expect(of(sampled().events, "draw_skipped_volume_budget")).toHaveLength(0);
  });
});
