import { describe, expect, it } from "vitest";
import { evaluationSettings } from "../../src/evaluate/config.ts";
import { runOpenLoop } from "../../src/experiments/assembly/open_loop.ts";
import { buildReport } from "../../src/experiments/assembly/report.ts";
import { runLab } from "../../src/experiments/assembly/lab/run.ts";
import type { LabRun } from "../../src/experiments/assembly/lab/run.ts";
import type { RunSpec } from "../../src/experiments/assembly/lab/spec.ts";
import { loadProfile } from "../../src/profiles.ts";
import { parseArchitecture } from "../../src/record/architecture.ts";
import { labData } from "../support/lab_data.ts";
import { readJson } from "../support/paths.ts";
import { SMALL, configOf, lookup } from "../support/scenarios.ts";

// docs/design/lab_ui.md section 4, the `run` request in full: a seed at a time with progress and a between-seeds cancel, buildReport once, the profile lists, the capture path.
// The expected report of the plain run is the one the experiment runner builds (runOpenLoop, buildReport); the lab function is a second route to the same numbers.

const data = labData();
const spec = (over: Partial<RunSpec> = {}): RunSpec => ({ schema_version: "1", scenario: "default", settings: SMALL, architectures: ["a_manual", "c_context"], seeds: [1009, 1103], ...over });
const done = (out: LabRun) => {
  if (!out.ok) throw new Error(`the run was cancelled after ${out.done} seed(s)`);
  return out;
};
const rowOf = (out: ReturnType<typeof done>, architecture: string, metric: string) => out.report.architectures.find((a) => a.id === architecture)?.rows.find((r) => r.metric === metric);

describe("runLab: the same numbers as the experiment runner", () => {
  it("Given the default scenario at the small size, two seeds, A and C When the lab runs Then the report equals the report of runOpenLoop and buildReport (experiment id lab)", async () => {
    const out = done(await runLab(data, spec()));
    const evaluation = evaluationSettings(readJson("scenarios", "evaluation", "default.json"));
    const reference = await runOpenLoop({
      scenario: configOf("default", { settings: SMALL }),
      seeds: [1009, 1103],
      staff: loadProfile(lookup("staff", "experienced"), "staff").params,
      evaluation,
      architectures: ["a_manual", "c_context"].map((n) => parseArchitecture(readJson("scenarios", "architectures", `${n}.json`))),
    });
    expect(out.report).toEqual(buildReport(reference, { experiment_id: "lab", min_seeds: 20, ablations_of: "c_context" }));
    expect(out.report.meets_min_seeds).toBe(false);
    expect(out.report.n_seeds).toBe(2);
  }, 60_000);

  it("Given the same spec twice Then the report and the utilisation are identical (seeded, no wall clock)", async () => {
    const [first, second] = [done(await runLab(data, spec({ seeds: [1009] }))), done(await runLab(data, spec({ seeds: [1009] })))];
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  }, 60_000);

  it("Given an ablation of C in the list Then it is run under its id with its flag off", async () => {
    const out = done(await runLab(data, spec({ architectures: ["c_context", "c_context_minus_system_issued_id"], seeds: [1009] })));
    expect(out.report.architectures.map((a) => [a.id, a.role, a.ablated_flag])).toEqual([["c_context", "preset", null], ["c_context_minus_system_issued_id", "ablation", "system_issued_id"]]);
  }, 60_000);
});

describe("runLab: progress and cancel between seeds", () => {
  const three = spec({ architectures: ["a_manual"], seeds: [1009, 1103, 1259] });

  it("Given three seeds Then progress is reported after each seed with the count done and the total", async () => {
    const seen: [number, number][] = [];
    done(await runLab(data, three, { onProgress: (d, t) => seen.push([d, t]) }));
    expect(seen).toEqual([[1, 3], [2, 3], [3, 3]]);
  }, 60_000);

  it("Given a cancel that arrives after the first seed Then the run stops before the second, answers cancelled with one seed done, and builds no report", async () => {
    const seen: number[] = [];
    const out = await runLab(data, three, { onProgress: (d) => seen.push(d), isCancelled: () => seen.length >= 1 });
    expect(out).toEqual({ ok: false, reason: "cancelled", done: 1 });
    expect(seen).toEqual([1]);
  }, 60_000);

  it("Given a cancel that is set before the run starts Then no seed is run", async () => {
    const seen: number[] = [];
    expect(await runLab(data, three, { onProgress: (d) => seen.push(d), isCancelled: () => true })).toEqual({ ok: false, reason: "cancelled", done: 0 });
    expect(seen).toEqual([]);
  });

  it("Given the cancel flag is read Then the run yields to the event loop between seeds (so a cancel message can be handled)", async () => {
    let turns = 0;
    const tick = setInterval(() => turns++, 0);
    done(await runLab(data, spec({ architectures: ["a_manual"], seeds: [1009, 1103] })));
    clearInterval(tick);
    expect(turns).toBeGreaterThan(0);
  }, 60_000);
});

describe("runLab: the profile lists (spec section 4.5)", () => {
  it("Given a bay list of the wrong length Then the engine's message arrives unchanged (the lengths are the engine's check)", async () => {
    await expect(runLab(data, spec({ settings: { ...SMALL, bay_size: 3 }, bay_profiles: ["bench_manual"] }))).rejects.toThrow(
      "scenario default: bay_profiles names 1 bioreactor profile but the scenario has 2 bays (reactor_count 6 in bays of 3); name one bioreactor profile per bay, bay 1 first (spec section 4.5)",
    );
  });

  it("Given an analyzer list that leaves a requested analyte without an analyzer Then the engine's message arrives unchanged", async () => {
    await expect(runLab(data, spec({ analyzer_profiles: ["hplc", "hplc"] }))).rejects.toThrow(/the analyte vcd is requested.*no analyzer profile in analyzer_profiles measures it/);
  });

  it("Given an all-in-one beside an HPLC and two bays of different profiles Then the run goes through and utilisation is stated per profile, one instrument each", async () => {
    const out = done(await runLab(data, spec({ settings: { ...SMALL, bay_size: 3 }, bay_profiles: ["bench_manual", "pilot"], analyzer_profiles: ["allinone_atline", "hplc"], architectures: ["a_manual"], seeds: [1009] })));
    expect(out.utilisation.by_profile.map((p) => [p.profile, p.instruments])).toEqual([["allinone_atline", 1], ["hplc", 1]]);
  }, 60_000);
});

describe("runLab: utilisation once, per analyzer profile, in both windows (spec section 4.5.6)", () => {
  it("Given a fleet of one profile Then its four rows (two windows, with and without setup) equal the pooled figure of the report, with the denominator in words", async () => {
    const out = done(await runLab(data, spec({ architectures: ["a_manual"] })));
    const [only] = out.utilisation.by_profile;
    expect(out.utilisation.by_profile).toHaveLength(1);
    expect(only?.profile).toBe("allinone_atline");
    expect(only?.instruments).toBe(2);
    const pooled: Record<string, string> = { "staffed/with": "utilisation.per_staffed_window.with_setup", "staffed/without": "utilisation.per_staffed_window.without_setup", "24h/with": "utilisation.per_24h.with_setup", "24h/without": "utilisation.per_24h.without_setup" };
    expect(only?.rows.map((r) => `${r.window}/${r.setup}`)).toEqual(Object.keys(pooled));
    for (const row of only?.rows ?? []) {
      const report = rowOf(out, "a_manual", pooled[`${row.window}/${row.setup}`] as string);
      expect([row.median, row.lo, row.hi, row.n_defined]).toEqual([report?.median, report?.lo, report?.hi, report?.n_defined]);
      expect(row.denominator.length).toBeGreaterThan(10);
    }
  }, 60_000);
});

describe("runLab: the capture path turns the raw layer on", () => {
  it("Given A and C on each capture path Then the truth is the same (the truth log hashes equal those of the run without the layer: spec section 5, rule 5)", async () => {
    const plain = done(await runLab(data, spec({ seeds: [1009] })));
    for (const capture_path of ["manual_transcription", "adapter_ingest"] as const) {
      const out = done(await runLab(data, spec({ seeds: [1009], capture_path })));
      expect(out.report.truth_log_hashes, capture_path).toEqual(plain.report.truth_log_hashes);
    }
  }, 120_000);

  it("Given a capture path Then the printed inputs include the instruments' zone of the raw layer with its ledger id (A161)", async () => {
    const out = done(await runLab(data, spec({ seeds: [1009], architectures: ["a_manual"], capture_path: "adapter_ingest" })));
    expect(out.inputs).toContainEqual({ name: "device_zone_h", value: 0, unit: "h", ref: "A161" });
    const plain = done(await runLab(data, spec({ seeds: [1009], architectures: ["a_manual"] })));
    expect(plain.inputs.map((i) => i.name)).not.toContain("device_zone_h");
  }, 120_000);

  it("Given a mixed fleet on adapter_ingest Then the dialect of each profile is read (the run goes through)", async () => {
    const fleet = spec({ analyzer_profiles: ["allinone_atline", "hplc"], capture_path: "adapter_ingest", architectures: ["c_context"], seeds: [1009] });
    expect(done(await runLab(data, fleet)).report.architectures).toHaveLength(1);
  }, 120_000);
});

describe("runLab: the inputs printed with a result", () => {
  it("Given overridden settings Then the printed inputs are the four evaluation inputs and then each setting that was changed, with unit and ledger id", async () => {
    const out = done(await runLab(data, spec({ settings: { reactor_count: 6, bay_size: 6, cohort_size: 6, horizon_days: 8, production_days: 6 }, architectures: ["a_manual"], seeds: [1009] })));
    expect(out.inputs.slice(0, 4).map((i) => i.ref)).toEqual(["A097", "A098", "A046", "A103"]);
    expect(out.inputs.slice(4)).toEqual([
      { name: "reactor_count", value: 6, unit: "reactors", ref: "A001" },
      { name: "bay_size", value: 6, unit: "reactors", ref: "A001" },
      { name: "cohort_size", value: 6, unit: "reactors", ref: "A188" },
      { name: "horizon_days", value: 8, unit: "d", ref: "A189" },
      { name: "production_days", value: 6, unit: "d", ref: "A004" },
    ]);
  }, 60_000);
});
