import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import type { Event } from "../src/generated/event.schema";
import type { Profile } from "../src/generated/profile.schema";
import { ROOT, listFiles } from "./support/paths.ts";
import { SMALL, lookup, rawScenario, runOf } from "./support/scenarios.ts";
import { makeAjv, ledgerIds, refsOf, rejected } from "./support/schemas.ts";

// Profiles and scenarios are data (spec 4, ADR-0012): schema-valid, every number {value, unit, ref} with a ledger ref,
// and the engine contains no branch on a profile id (rubric B).

const KINDS = ["bioreactor", "analyzer", "staff"] as const;
const profileFiles = KINDS.flatMap((k) => listFiles("scenarios", "profiles", k).map((f) => [k, f.replace(/\.json$/, "")] as const));
const scenarioFiles = ["default", "sc02_shift_burst", "sc05_one_analyzer_down"];

describe("Data: scenarios and profiles", () => {
  const ajv = makeAjv();

  it("lists the eight profiles of the spec (4.1 to 4.3) and the three scenarios of S1b", () => {
    expect(profileFiles.map(([, id]) => id).sort()).toEqual(["allinone_atline", "bench_manual", "experienced", "hplc", "micro_mini_parallel", "pilot", "split_cellcounter_metabolite", "trainee"]);
    expect(listFiles("scenarios").filter((f) => f.endsWith(".json")).map((f) => f.replace(".json", ""))).toEqual([...scenarioFiles].sort());
  });

  it.each(profileFiles)("profile %s/%s is schema-valid, its file name is its id and every ref is a ledger id", (kind, id) => {
    const doc = lookup(kind, id) as Profile;
    expect(rejected(ajv, "profile", doc)).toBe(false);
    expect(doc.profile_id).toBe(id);
    expect(doc.kind).toBe(kind);
    const ids = ledgerIds();
    for (const r of refsOf(doc)) expect(ids.has(r), r).toBe(true);
  });

  it.each(scenarioFiles)("scenario %s is schema-valid and every ref in it is a ledger id", (name) => {
    const doc = rawScenario(name);
    expect(rejected(ajv, "scenario", doc)).toBe(false);
    const ids = ledgerIds();
    const refs = refsOf(doc);
    expect(refs.length).toBeGreaterThan(50);
    for (const r of refs) expect(ids.has(r), r).toBe(true);
    expect(doc.scenario_id).toBe(name);
  });

  it.each(profileFiles.filter(([k]) => k === "analyzer"))("analyzer profile %s/%s: every name in its route refers to a param of the same profile", (_k, id) => {
    const doc = lookup("analyzer", id) as Profile;
    const has = (n: string | undefined): void => void (n === undefined || expect(Object.keys(doc.params), n).toContain(n));
    for (const stage of doc.route ?? []) {
      has(stage.service);
      has(stage.transfer);
      for (const n of stage.dilution_factors ?? []) has(n);
      for (const a of stage.analytes) {
        has(a.noise);
        has(a.limit);
      }
    }
    expect(doc.route?.length).toBeGreaterThan(0);
  });

  it("the profiles of SC1 carry the numbers the spec cites: 270 s service (A023), 2 L and 0.014 percent (A002, A057), delay sd 5 min (A063)", () => {
    expect((lookup("analyzer", "allinone_atline") as Profile).params.service_s).toMatchObject({ value: 270, ref: "A023" });
    expect((lookup("bioreactor", "bench_manual") as Profile).params).toMatchObject({ working_volume_l: { value: 2, ref: "A002" }, sample_volume_pct: { value: 0.014, ref: "A057" } });
    expect((lookup("staff", "experienced") as Profile).params.delay_sd_min).toMatchObject({ value: 5, ref: "A063" });
  });

  it("SC2 and SC5 change only the settings of their rows (spec 7): the sampling plan, and the maintenance window", () => {
    const base = rawScenario("default");
    const diff = (name: string): string[] => {
      const other = rawScenario(name);
      return [...new Set([...Object.keys(base), ...Object.keys(other)])].filter((k) => JSON.stringify(base[k]) !== JSON.stringify(other[k])).sort();
    };
    expect(diff("sc02_shift_burst")).toEqual(["description", "sampling_plan", "scenario_id"]);
    expect(diff("sc05_one_analyzer_down")).toEqual(["description", "maintenance", "scenario_id"]);
    expect(base.seed).toBe(1);
  });
});

describe("Data: the engine is generic (no branch on a profile, scenario or preset id)", () => {
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p, out);
      else out.push(p);
    }
    return out;
  };
  const IDS = /['"](bench_manual|micro_mini_parallel|pilot|allinone_atline|split_cellcounter_metabolite|hplc|trainee|experienced|a_manual|b_lims_lite|c_context|sc\d\d_[a-z_]+)['"]/;

  it("the profile-id grep of the rubric (section B) over engine/src, generated files included, is empty", () => {
    const files = walk(join(ROOT, "engine", "src"));
    expect(files.length).toBeGreaterThan(10);
    const hits = files.filter((f) => IDS.test(readFileSync(f, "utf8"))).map((f) => relative(ROOT, f));
    expect(hits).toEqual([]);
  });

  it("the grep itself recognises a planted branch", () => {
    expect(IDS.test('if (cfg.profile === "hplc") return;')).toBe(true);
    expect(IDS.test("const profileId = pick();")).toBe(false);
  });
});

describe("Data: switching a profile changes only data", () => {
  const types = (events: readonly Event[], type: string) => events.filter((e) => e.type === type) as unknown as Record<string, unknown>[];

  it("Given the split analyzer Then each sample makes two visits, on the counter group first and the metabolite group second, 60 s apart (A106)", () => {
    const r = runOf("default", { profiles: { analyzer: "split_cellcounter_metabolite" }, settings: { ...SMALL, rerun_probability: 0, lactate_production_pmol_per_cell_d: 0 } });
    const id = (r.samples.find((s) => s.state === "closed") as { sample_id: string }).sample_id;
    const queued = types(r.events, "request_queued").filter((e) => e.request_id === id);
    expect(queued.map((e) => e.group)).toEqual(["CELL", "CHEM"]);
    const finished = types(r.events, "visit_finished").find((e) => e.request_id === id && e.visit === 1) as { t: number };
    expect((queued[1] as { t: number }).t).toBe(finished.t + 60);
  });

  it("Given the HPLC analyzer Then each sample makes one 60 s run (A028) and the aliquot is frozen (A021)", () => {
    const r = runOf("default", { profiles: { analyzer: "hplc" }, settings: SMALL });
    expect(r.runs.length).toBeGreaterThan(20);
    expect(r.runs.every((x) => x.end_s - x.start_s === 60)).toBe(true);
    expect(types(r.events, "aliquot_created").every((e) => e.storage === "frozen")).toBe(true);
    expect(types(r.events, "result_measured").every((e) => e.analyte === "titer")).toBe(true);
  });

  it("Given the trainee profile Then every operator is unqualified; given the micro-scale profile Then draws are 600 uL and pH is read from an open container", () => {
    expect(runOf("default", { profiles: { staff: "trainee" }, settings: SMALL }).operators.every((o) => !o.qualified)).toBe(true);
    const r = runOf("default", { profiles: { bioreactor: "micro_mini_parallel" }, settings: SMALL });
    expect(types(r.events, "sample_drawn").every((e) => e.volume_ul === 600)).toBe(true);
    expect(types(r.events, "result_measured").filter((e) => e.analyte === "ph").some((e) => e.stability_kind === "first_order_offset")).toBe(true);
  });

  it("Given the pilot profile Then draws are 275 uL (0.00055 percent of 50 L)", () => {
    const r = runOf("default", { profiles: { bioreactor: "pilot" }, settings: SMALL });
    expect(types(r.events, "sample_drawn").every((e) => Math.abs((e.volume_ul as number) - 275) < 1e-6)).toBe(true);
  });
});
