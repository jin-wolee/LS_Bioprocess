import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { runSeed } from "../../src/experiments/assembly/run_seed.ts";
import type { SeedOutput } from "../../src/experiments/assembly/run_seed.ts";
import { parseArchitecture } from "../../src/record/architecture.ts";
import { runScenario } from "../../src/run.ts";
import type { ScenarioRun } from "../../src/run.ts";
import type { RecordedDataset } from "../../src/record/types.ts";
import * as emitModule from "../../src/raw/controller_emit.ts";
import { logHash } from "../../src/trace.ts";
import { join } from "node:path";
import { ROOT, readJson } from "../support/paths.ts";
import { rawConfigOf, rawInputOf } from "../support/raw_run.ts";
import { SMALL, runOf } from "../support/scenarios.ts";
import { inputOf } from "../support/sc_run.ts";

// Step 7, the controller side on the capture path (spec section 5, "Capture path", rule 3; docs/prompts/20 Step 7). Controller logs are machine files: on adapter_ingest they are parsed
// (RQ9 to RQ11) and the dataset has historian values, alarm events and batch phase records; on manual_transcription a person can copy a result but not a tag log, so the historian
// values reach the recorder as observable events, as with the layer off, and no alarm or phase record exists. The scenario is the small one with two bays of two units, one bay on
// each controller family; the expected rows are typed by hand from the design: the inoculations (08:00 and a step of 15 min: 28800, 29700, 30600 and 31500 s, A188), the shift at 10:00
// on culture day 4 (381600 s, A195), and the set points (pH 7, DO 30 %, temperature 37 C then 33 C, A198). The alarm rows of a hand-given sequence are test-only values.

const preset = (name: string) => parseArchitecture(readJson("data", "scenarios", "architectures", `${name}.json`));
const [A, B, C] = [preset("a_manual"), preset("b_lims_lite"), preset("c_context")];
const TWO_BAYS = { seed: 1, settings: { reactor_count: 4, bay_size: 2, cohort_size: 4, horizon_days: 8, production_days: 6 } };
const T0 = { U01: 28800, U02: 29700, U03: 30600, U04: 31500 } as const;
const SHIFT = 381600;
const DAY = 86400;

const runWith = (over: Parameters<typeof rawConfigOf>[2], archs = [A, B, C]): { run: ScenarioRun; out: SeedOutput } => {
  const config = rawConfigOf("default", TWO_BAYS, over);
  const run = runScenario(config);
  return { run, out: runSeed(rawInputOf(run, config, "two-bays", archs, 8)) };
};
const lateOf = (ds: RecordedDataset | undefined) => ds?.historian.late ?? [];
const firstOf = (ds: RecordedDataset | undefined, tag: string) => lateOf(ds).find((r) => r.tag === tag);

describe("the default raw-layer scenario: one bay on each family, daily files", () => {
  let run: ScenarioRun;
  let out: SeedOutput;
  beforeAll(() => {
    ({ run, out } = runWith({}));
  }, 120_000);
  const ds = (a: { id: string }) => out.datasets[a.id];

  it("Given bays of two units and the families ctrl_neutral and ctrl_bench When C is recorded Then its raw tables hold the files of both: CTRL-1 writes ctrl_ files for U01 and U02 and CTRL-2 writes bench_ files for U03 and U04", () => {
    const names = (ds(C)?.raw?.raw_file ?? []).map((f) => f.file_name).filter((n) => /^(ctrl|bench)_/.test(n));
    expect(names).toContain("ctrl_tags_CTRL-1_2030-01-07.csv");
    expect(names).toContain("ctrl_phases_CTRL-1_2030-01-07.csv");
    expect(names).toContain("bench_process_CTRL-2_2030-01-07.csv");
    expect(names).toContain("bench_steps_CTRL-2_2030-01-07.csv");
    expect(names.some((n) => /^ctrl_alarms|^bench_alarms|^bench_user|^bench_errors/.test(n))).toBe(false);
    expect((ds(C)?.raw?.adapter ?? []).filter((a) => a.device_class === "controller").map((a) => [a.adapter_id, a.dialect_id, a.instrument_id])).toEqual([
      ["AD-ctrl_neutral-CTRL-1", "ctrl_neutral", "CTRL-1"], ["AD-ctrl_bench-CTRL-2", "ctrl_bench", "CTRL-2"],
    ]);
  });
  it("Given both families Then the tags of both land under the same canonical form unit_tag.signal.role, with the six tags of each unit: PV and SP of pH, DO and temperature", () => {
    const tags = new Set(lateOf(ds(C)).map((r) => r.tag));
    for (const unit of ["U01", "U02", "U03", "U04"]) {
      for (const signal of ["pH", "DO", "temperature"]) for (const role of ["PV", "SP"]) expect(tags.has(`${unit}.${signal}.${role}`), `${unit}.${signal}.${role}`).toBe(true);
    }
    expect([...tags].every((t) => /^U0[1-4]\.(pH|DO|temperature)\.(PV|SP)$/.test(t))).toBe(true);
    expect([...tags].some((t) => t.endsWith(".OUT"))).toBe(false);
  });
  it("Given the inoculations Then the first row of each unit's pH PV is stamped at its inoculation, and the SP rows start with the set points of A198", () => {
    for (const [unit, t0] of Object.entries(T0)) {
      expect(firstOf(ds(C), `${unit}.pH.PV`)?.ts, unit).toBe(t0);
      expect([`${unit}.pH.SP`, `${unit}.DO.SP`, `${unit}.temperature.SP`].map((tag) => { const r = firstOf(ds(C), tag); return [r?.ts, r?.value]; })).toEqual([[t0, 7], [t0, 30], [t0, 37]]);
    }
  });
  it("Given the shift at 10:00 of day 4 Then each unit's temperature SP steps from 37 to 33 at 381600 s, and no row lies between the hourly rows of a flat tag", () => {
    for (const unit of Object.keys(T0)) {
      const sp = lateOf(ds(C)).filter((r) => r.tag === `${unit}.temperature.SP`);
      expect(sp.filter((r) => r.value === 33)[0]?.ts, unit).toBe(SHIFT);
      expect(sp.filter((r) => r.ts < SHIFT).every((r) => r.value === 37)).toBe(true);
    }
    const ph = lateOf(ds(C)).filter((r) => r.tag === "U01.pH.SP").map((r) => r.ts);
    expect(ph.slice(1).every((ts, i) => ts - (ph[i] as number) === 3600)).toBe(true); // a flat set point is logged once an hour (A179)
  });
  it("Given the observable PV series Then every logged PV row is the process value of its tick: nothing is interpolated or rounded", () => {
    const series = new Map(run.observableSensors.map((s) => [`${s.unit_id}.${s.signal}.PV`, s]));
    const pv = lateOf(ds(C)).filter((r) => r.tag.endsWith(".PV"));
    expect(pv.length).toBeGreaterThan(300);
    for (const r of pv) {
      const s = series.get(r.tag);
      if (!s) throw new Error(`no observable series for ${r.tag}`);
      const j = (r.ts - s.t0_s) / s.cadence_s;
      expect(Number.isInteger(j), r.tag).toBe(true);
      expect(r.value, `${r.tag} at ${r.ts}`).toBe(s.pv[j]);
    }
  });
  it("Given daily files Then every historian row of day 0 was ingested at the end of that day, 86400 s, and a row of day 1 at 172800 s", () => {
    const rows = lateOf(ds(C)).filter((r) => r.tag === "U01.pH.PV");
    expect(rows.filter((r) => r.ts < DAY).every((r) => r.ingested_at === DAY)).toBe(true);
    expect(rows.filter((r) => r.ts >= DAY && r.ts < 2 * DAY).every((r) => r.ingested_at === 2 * DAY)).toBe(true);
  });
  it("Given the phases Then U01 (ctrl_neutral) has before_shift from the inoculation to the shift and after_shift from the shift to the harvest, with the ISA-88 ids of the profile", () => {
    const harvest = (unit: string) => run.events.find((e) => e.type === "process_event" && e.unit_id === unit && e.kind === "harvest")?.t;
    const rows = (ds(C)?.raw?.batch_phase_record ?? []).filter((r) => r.unit_id === "U01");
    expect(rows.map((r) => [r.phase, r.from_state, r.to_state, r.ts])).toEqual([
      ["before_shift", "idle", "running", 28800], ["before_shift", "running", "complete", SHIFT], ["after_shift", "idle", "running", SHIFT], ["after_shift", "running", "complete", harvest("U01")],
    ]);
    expect(rows[0]).toMatchObject({ batch_id: "B-U01", recipe_id: "REC-CULTURE", procedure: "culture", unit_procedure: "culture_run", operation: "culture_control" });
  });
  it("Given U03 on ctrl_bench Then its recipe steps are the same four transitions, with batch, procedure, unit procedure and operation null: that family's log does not carry them", () => {
    const rows = (ds(C)?.raw?.batch_phase_record ?? []).filter((r) => r.unit_id === "U03");
    expect(rows.map((r) => [r.phase, r.from_state, r.to_state])).toEqual([["before_shift", "idle", "running"], ["before_shift", "running", "complete"], ["after_shift", "idle", "running"], ["after_shift", "running", "complete"]]);
    expect(rows[0]).toMatchObject({ batch_id: null, recipe_id: "REC-CULTURE", procedure: null, unit_procedure: null, operation: null });
    expect(rows[0]?.ts).toBe(30600);
  });
  it("Given the production run Then there is no alarm row: acknowledge and return-to-normal times have no ledger entry, and the key reports the alarm log, OUT and the other L1 signals as not modelled", () => {
    expect(ds(C)?.raw?.alarm_event).toEqual([]);
    const key = JSON.parse(out.raw?.[C.id]?.key_text ?? "{}") as { not_modelled: string[] };
    expect(key.not_modelled).toEqual(expect.arrayContaining(["ctrl_out", "ctrl_alarm_log", "ctrl_extra_signals"]));
  });
  it("Given the controller rows Then they are raw data rows of the ingest metrics (spec 2.4.7): a clean production run has no unreadable, held or quarantined row among them", () => {
    const m = out.raw?.[C.id]?.metrics;
    expect(m).toMatchObject({ status: "reported", parse_failure: { status: "reported", num: 0 }, stage: { quarantined: 0, held: 0 } });
    expect(m && m.status === "reported" ? m.rows : 0).toBeGreaterThan(ds(C)?.historian.late.length ?? Infinity);
  });
  it("Given the architectures on their default paths Then A, B and C all parse the controller logs only on adapter_ingest: A's controller tables are absent, B's and C's are the same rows", () => {
    expect(ds(A)?.raw).toBeUndefined();
    expect(JSON.stringify(lateOf(ds(B)))).toBe(JSON.stringify(lateOf(ds(C))));
    expect(ds(B)?.raw?.batch_phase_record.length).toBe(ds(C)?.raw?.batch_phase_record.length);
  });
});

describe("A on manual_transcription has no controller record, and A with adapter_ingest has them", () => {
  let manual: RecordedDataset | undefined;
  let adapter: RecordedDataset | undefined;
  beforeAll(() => {
    manual = runWith({ capture_path: "manual_transcription" }, [A]).out.datasets[A.id];
    adapter = runWith({ capture_path: "adapter_ingest" }, [A]).out.datasets[A.id];
  }, 120_000);
  it("Given A on manual_transcription Then there is no alarm_event and no batch_phase_record, and no raw table at all", () => {
    expect(manual?.raw).toBeUndefined();
    expect(manual?.capture?.path).toBe("manual_transcription");
  });
  it("Given A on manual_transcription Then the historian values arrive as observable events: the 12 columnar series of 4 units and 3 signals, 60 s apart, and no late row", () => {
    expect(manual?.historian.series.map((s) => `${s.unit_id}.${s.signal}`).sort()).toEqual(["U01", "U02", "U03", "U04"].flatMap((u) => ["DO", "pH", "temperature"].map((s) => `${u}.${s}`)));
    expect(new Set(manual?.historian.series.map((s) => s.cadence_s))).toEqual(new Set([60]));
    expect(manual?.historian.late).toEqual([]);
  });
  it("Given A with adapter_ingest Then it parses both families: historian values of the four units, the phase records of U01 and U03, and no columnar series", () => {
    expect(new Set(lateOf(adapter).map((r) => r.tag.split(".")[0]))).toEqual(new Set(["U01", "U02", "U03", "U04"]));
    expect(new Set((adapter?.raw?.batch_phase_record ?? []).map((r) => r.unit_id))).toEqual(new Set(["U01", "U02", "U03", "U04"]));
    expect(adapter?.raw?.alarm_event).toEqual([]);
    expect(adapter?.historian.series).toEqual([]);
  });
});

describe("a transition the state model does not allow, given by hand, in the whole pipeline", () => {
  // test-only values: alarm AL-1 on U01 goes unacknowledged, acknowledged and then back to unacknowledged
  const HAND = [
    { unit: "U01", alarm_id: "AL-1", tag: "pH.PV", severity: 500, from: "normal", to: "unacknowledged", ts: 40000, actor: null },
    { unit: "U01", alarm_id: "AL-1", tag: "pH.PV", severity: 500, from: "unacknowledged", to: "acknowledged", ts: 40300, actor: null },
    { unit: "U01", alarm_id: "AL-1", tag: "pH.PV", severity: 500, from: "acknowledged", to: "unacknowledged", ts: 40600, actor: null },
  ];
  let out: SeedOutput;
  beforeAll(() => {
    const config = rawConfigOf("default", TWO_BAYS);
    const input = rawInputOf(runScenario(config), config, "two-bays-hand", [C], 8);
    if (!input.raw?.controller) throw new Error("no controller setup");
    out = runSeed({ ...input, raw: { ...input.raw, controller: { ...input.raw.controller, forced: { alarms: HAND } } } });
  }, 120_000);
  it("Given the hand-given sequence When the run completes Then the held row is stored beside the two that load, flagged by VR-025, and the review did not stop (the finding is not a result's)", () => {
    const ds = out.datasets[C.id];
    expect(ds?.raw?.alarm_event.map((r) => [r.from_state, r.to_state, r.ts])).toEqual([["normal", "unacknowledged", 40000], ["unacknowledged", "acknowledged", 40300], ["acknowledged", "unacknowledged", 40600]]);
    const held = ds?.raw?.raw_record.filter((r) => r.state === "held") ?? [];
    expect(held.map((r) => r.rule_id)).toEqual(["VR-025"]);
    const ids = (ds?.raw?.alarm_event ?? []).map((r) => `alarm_event:${r.raw_ref.raw_file_id}:${r.raw_ref.line_no}`);
    expect((ds?.validation_finding ?? []).filter((f) => f.rule === "VR-025").map((f) => [f.target, f.action, f.status])).toEqual([[ids[2], "hold", "open"]]);
  });
  it("Given the same run Then the raw-layer metrics count the held controller row among the rows held at ingest, and the alarm log is no longer reported as not modelled", () => {
    expect(out.raw?.[C.id]?.metrics).toMatchObject({ stage: { held: 1 } });
    const key = JSON.parse(out.raw?.[C.id]?.key_text ?? "{}") as { not_modelled: string[] };
    expect(key.not_modelled).not.toContain("ctrl_alarm_log");
  });
});

describe("with the layer off the controller emitter does not run", () => {
  it("Given a scenario with the layer off When it is recorded Then no controller file is emitted, the dataset has no raw tables and the columnar series, and the log equals the golden", async () => {
    const spy = vi.spyOn(emitModule, "emitController");
    try {
      const run = runOf("default", { seed: 1, settings: SMALL });
      const out = runSeed(inputOf(run, "default-small", [A, C], 8));
      expect(spy).not.toHaveBeenCalled();
      for (const d of Object.values(out.datasets)) {
        expect(d.raw).toBeUndefined();
        expect(d.historian.series.length).toBeGreaterThan(0);
        expect(d.historian.late).toEqual([]);
      }
      const golden = (JSON.parse(readFileSync(join(ROOT, "tests", "golden", "default_seed1.summary.json"), "utf8")) as { log_hash: string }).log_hash;
      expect(await logHash(runOf("default", { seed: 1 }).events)).toBe(golden);
    } finally {
      spy.mockRestore();
    }
  }, 120_000);
  it("Given the layer on Then the emitter runs once per bay on adapter_ingest and not at all on manual_transcription", () => {
    const spy = vi.spyOn(emitModule, "emitController");
    try {
      runWith({ capture_path: "manual_transcription" }, [A]);
      expect(spy).not.toHaveBeenCalled();
      runWith({ capture_path: "adapter_ingest" }, [A]);
      expect(spy.mock.calls.length).toBe(2);
    } finally {
      spy.mockRestore();
    }
  }, 120_000);
});
