import { describe, expect, it } from "vitest";
import { anchorEpoch } from "../../src/calendar.ts";
import type { ObservableEvent, ObservableSensorSeries } from "../../src/observe.ts";
import { emitController } from "../../src/raw/controller_emit.ts";
import type { EmitControllerInput } from "../../src/raw/controller_emit.ts";
import { logRuleOf, logTags } from "../../src/raw/controller_log.ts";
import { phaseTransitions } from "../../src/raw/controller_phases.ts";
import { tagSeries } from "../../src/raw/controller_series.ts";
import type { AlarmTransition, PhaseTransition, TagRow } from "../../src/raw/controller_types.ts";
import { BANNER } from "../../src/raw/types.ts";
import { ANCHOR, profileOf } from "../support/controller_fixtures.ts";

// Step 7, the controller emitter (spec 2.4.1 and 2.4.3; docs/prompts/20 Step 7). One generic function from plain data and a controller profile to file text, branching on no profile id.
// The expected file texts and rows are typed by hand from the profile data and the design; row values, ids, users and instants are test-only. Scenario second 0 is
// 2030-01-07 00:00:00 UTC (the synthetic Monday), so 08:00:00 is 28800 and one day is 86400.

const base = (family: string, over: Partial<EmitControllerInput> = {}): EmitControllerInput => ({
  profile: profileOf(family), controller: family === "ctrl_neutral" ? "CTRL-1" : "CTRL-2", anchor_epoch_s: anchorEpoch(ANCHOR), zone_offset_s: 0, cut: "daily", tags: [], alarms: [], phases: [], ...over,
});
const TAGS: TagRow[] = [
  { unit: "U01", signal: "pH", role: "PV", ts: 28800, value: 7.01 },
  { unit: "U01", signal: "DO", role: "SP", ts: 28860, value: 30 },
];
const ALARMS: AlarmTransition[] = [
  { unit: "U01", alarm_id: "AL-1", tag: "pH.PV", severity: 500, from: "normal", to: "unacknowledged", ts: 32400, actor: null },
  { unit: "U01", alarm_id: "AL-1", tag: "pH.PV", severity: 500, from: "unacknowledged", to: "acknowledged", ts: 32700, actor: "op1" },
];
const PHASES: PhaseTransition[] = [
  { unit: "U01", batch: "B-U01", phase: "before_shift", from: "idle", to: "running", ts: 28800 },
  { unit: "U01", batch: "B-U01", phase: "before_shift", from: "running", to: "complete", ts: 100000 },
];

describe("the controller emitter writes the profile's logs", () => {
  it("Given tag rows for the first family When emitted Then the file is the banner, the header and one line per row, with a UTC stamp that carries its offset", () => {
    const [f] = emitController(base("ctrl_neutral", { tags: TAGS }));
    expect(f?.file_name).toBe("ctrl_tags_CTRL-1_2030-01-07.csv");
    expect(f?.text).toBe([BANNER, "Timestamp,Unit,Tag,Value,Quality", "2030-01-07T08:00:00+00:00,U01,pH.PV,7.01,good", "2030-01-07T08:01:00+00:00,U01,DO.SP,30,good", ""].join("\n"));
  });
  it("Given the same rows for the second family and an entry zone of +2 h (test-only) When emitted Then the unit sits in parentheses in the variable name and the stamp is local wall-clock text with no zone", () => {
    const [f] = emitController(base("ctrl_bench", { tags: TAGS, zone_offset_s: 7200 }));
    expect(f?.file_name).toBe("bench_process_CTRL-2_2030-01-07.csv");
    expect(f?.text).toBe([BANNER, "Time,Variable,Value", "2030-01-07 10:00:00,pH.PV (U01),7.01", "2030-01-07 10:01:00,DO.SP (U01),30", ""].join("\n"));
  });
  it("Given alarm transitions Then the first family writes both states, tag and severity, and the second writes the new state and the acknowledging user only", () => {
    const [n] = emitController(base("ctrl_neutral", { alarms: ALARMS }));
    expect(n?.text.split("\n").slice(1)).toEqual(["Timestamp,Unit,Alarm,Tag,Severity,From,To", "2030-01-07T09:00:00+00:00,U01,AL-1,pH.PV,500,normal,unacknowledged", "2030-01-07T09:05:00+00:00,U01,AL-1,pH.PV,500,unacknowledged,acknowledged", ""]);
    const [b] = emitController(base("ctrl_bench", { alarms: ALARMS }));
    expect(b?.file_name).toBe("bench_alarms_CTRL-2_2030-01-07.csv");
    expect(b?.text.split("\n").slice(1)).toEqual(["Time,Alarm,State,User", "2030-01-07 09:00:00,AL-1 (U01),unacknowledged,", "2030-01-07 09:05:00,AL-1 (U01),acknowledged,op1", ""]);
  });
  it("Given phase transitions Then the first family writes the ISA-88 ids of the profile, and the second writes recipe, step with the unit in parentheses, and the new state", () => {
    const [n] = emitController(base("ctrl_neutral", { phases: PHASES }));
    expect(n?.file_name).toBe("ctrl_phases_CTRL-1_2030-01-07.csv");
    expect(n?.text.split("\n").slice(1, 3)).toEqual(["Timestamp,Unit,Batch,Recipe,Procedure,Unit Procedure,Operation,Phase,From,To", "2030-01-07T08:00:00+00:00,U01,B-U01,REC-CULTURE,culture,culture_run,culture_control,before_shift,idle,running"]);
    const b = emitController(base("ctrl_bench", { phases: PHASES }));
    expect(b.map((x) => x.file_name)).toEqual(["bench_steps_CTRL-2_2030-01-07.csv", "bench_steps_CTRL-2_2030-01-08.csv"]);
    expect(b[0]?.text.split("\n").slice(1)).toEqual(["Time,Recipe,Step,State", "2030-01-07 08:00:00,REC-CULTURE,before_shift (U01),running", ""]);
  });
  it("Given rows of a log that has none Then no file is written for it: an empty log carries no information, so the second family's user-event and error exports never exist", () => {
    expect(emitController(base("ctrl_bench", { tags: TAGS })).map((f) => f.log)).toEqual(["process_data"]);
    expect(emitController(base("ctrl_neutral", { tags: TAGS, alarms: ALARMS, phases: PHASES })).map((f) => f.log)).toEqual(["tag", "alarm", "phase", "phase"]);
    expect(emitController(base("ctrl_bench", { tags: TAGS, alarms: ALARMS, phases: PHASES })).map((f) => f.log)).toEqual(["process_data", "alarms", "recipe_steps", "recipe_steps"]);
    expect(emitController(base("ctrl_neutral")).length).toBe(0);
  });
  it("Given any family and any log Then the first line of every file is the banner (ADR-0014 R3)", () => {
    for (const family of ["ctrl_neutral", "ctrl_bench"]) for (const cut of ["daily", "per_row"] as const) {
      for (const f of emitController(base(family, { cut, tags: TAGS, alarms: ALARMS, phases: PHASES }))) expect(f.text.split("\n")[0]).toBe(BANNER);
    }
  });
  it("Given the same inputs twice Then the files are byte-identical", () => {
    const a = emitController(base("ctrl_neutral", { tags: TAGS, alarms: ALARMS, phases: PHASES }));
    const b = emitController(base("ctrl_neutral", { tags: TAGS, alarms: ALARMS, phases: PHASES }));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("the controller log cut (A217)", () => {
  it("Given rows on two days and the daily cut Then there is one file per log per day, each received at the end of its day (86400 and 172800 s)", () => {
    const tags: TagRow[] = [...TAGS, { unit: "U01", signal: "pH", role: "PV", ts: 100000, value: 6.99 }];
    const files = emitController(base("ctrl_neutral", { tags }));
    expect(files.map((f) => [f.file_name, f.received_at, f.rows])).toEqual([["ctrl_tags_CTRL-1_2030-01-07.csv", 86400, 2], ["ctrl_tags_CTRL-1_2030-01-08.csv", 172800, 1]]);
  });
  it("Given the same rows and the per_row cut Then each row is a file of its own that reaches the host at its own stamp", () => {
    const files = emitController(base("ctrl_neutral", { cut: "per_row", tags: TAGS }));
    expect(files.map((f) => [f.file_name, f.received_at, f.rows])).toEqual([["ctrl_tags_CTRL-1_2030-01-07_080000_000001.csv", 28800, 1], ["ctrl_tags_CTRL-1_2030-01-07_080100_000002.csv", 28860, 1]]);
    expect(files[0]?.text).toBe([BANNER, "Timestamp,Unit,Tag,Value,Quality", "2030-01-07T08:00:00+00:00,U01,pH.PV,7.01,good", ""].join("\n"));
  });
  it("Given an unknown cut Then the emitter refuses it", () => {
    expect(() => emitController(base("ctrl_neutral", { cut: "weekly" as never, tags: TAGS }))).toThrow(/cut/);
  });
});

describe("the log rule and the signals the profile data covers", () => {
  it("Given the profile data Then the deadbands are those of A178 (PV: pH 0.05, DO 2.0, temperature 0.2; SP: pH 0.01, DO 1.0, temperature 0.1) and the maximum interval is 60 min (A179)", () => {
    const rule = logRuleOf(profileOf("ctrl_neutral"));
    const at = (signal: string, role: "PV" | "SP") => rule.deadband({ unit: "U01", signal, role });
    expect([at("pH", "PV"), at("DO", "PV"), at("temperature", "PV"), at("pH", "SP"), at("DO", "SP"), at("temperature", "SP"), at("agitation", "PV")]).toEqual([0.05, 2.0, 0.2, 0.01, 1.0, 0.1, 0.5]);
    expect(rule.max_interval_s).toBe(3600);
  });
  it("Given a tag that has no deadband in the ledger (the feed pump, a gas flow, off-gas CO2: A178 gives none) Then the rule names the gap and invents no number", () => {
    const rule = logRuleOf(profileOf("ctrl_neutral"));
    expect(() => rule.deadband({ unit: "U01", signal: "feed_pump", role: "OUT" })).toThrow(/A178/);
  });
  it("Given a flat pH PV for two hours at the 60 s cadence and the deadbands of the profile Then only the first value and the value at each hour are logged", () => {
    const rule = logRuleOf(profileOf("ctrl_neutral"));
    const rows = logTags([{ unit: "U01", signal: "pH", role: "PV", t0_s: 0, cadence_s: 60, n: 121, at: () => 7.0 }], rule);
    expect(rows.map((r) => r.ts)).toEqual([0, 3600, 7200]);
  });
});

describe("the series and the phases come from observable data only", () => {
  const sensors = (signal: string, pv: number[]): ObservableSensorSeries => ({ unit_id: "U01", signal: signal as ObservableSensorSeries["signal"], t0_s: 28800, cadence_s: 60, n: pv.length, pv });
  const EVENTS: ObservableEvent[] = [
    { type: "inoculation", t: 28800, unit_id: "U01", batch_id: "B-U01", density_e6_per_ml: 1 },
    { type: "process_event", t: 29000, unit_id: "U01", batch_id: "B-U01", kind: "feed", source: "rule", amount: 0.05, amount_unit: "L" },
    { type: "process_event", t: 28920, unit_id: "U01", batch_id: "B-U01", kind: "temperature_shift", source: "scheduled", amount: 33, amount_unit: "C" },
    { type: "process_event", t: 29100, unit_id: "U01", batch_id: "B-U01", kind: "alarm", source: "scripted" },
    { type: "process_event", t: 100000, unit_id: "U01", batch_id: "B-U01", kind: "harvest", source: "scheduled" },
  ];
  it("Given the PV series of a unit, the scenario set points (pH 7, DO 30, temperature 37: A198) and a shift to 33 C at the third tick Then the SP series are the set points, and the temperature SP follows the shift from the tick at or after it", () => {
    const series = tagSeries([sensors("pH", [7.0, 7.0, 7.0]), sensors("DO", [30, 30, 30]), sensors("temperature", [37, 37, 36.5])], EVENTS, { pH: 7, DO: 30, temperature: 37 });
    const sp = series.filter((s) => s.role === "SP");
    expect(sp.map((s) => s.signal)).toEqual(["pH", "DO", "temperature"]);
    expect(sp.map((s) => [0, 1, 2].map((j) => s.at(j)))).toEqual([[7, 7, 7], [30, 30, 30], [37, 37, 33]]);
    expect(series.filter((s) => s.role === "PV").map((s) => s.signal)).toEqual(["pH", "DO", "temperature"]);
  });
  it("Given those series and the profile deadbands Then the logged rows are the first value of each tag and the step of the temperature set point (37 to 33, 4 C is above 0.1 C)", () => {
    const series = tagSeries([sensors("pH", [7.0, 7.0, 7.0]), sensors("DO", [30, 30, 30]), sensors("temperature", [37, 37, 36.5])], EVENTS, { pH: 7, DO: 30, temperature: 37 });
    const rows = logTags(series, logRuleOf(profileOf("ctrl_neutral")));
    expect(rows.filter((r) => r.signal === "temperature" && r.role === "SP").map((r) => [r.ts, r.value])).toEqual([[28800, 37], [28920, 33]]);
    expect(rows.filter((r) => r.signal === "pH").map((r) => [r.role, r.ts])).toEqual([["PV", 28800], ["SP", 28800]]);
  });
  it("Given the inoculation, the shift, a feed, a scripted alarm and the harvest of a unit Then the phases are before_shift from inoculation to the shift and after_shift from the shift to the harvest; the feed and the alarm start no phase", () => {
    expect(phaseTransitions(EVENTS).map((t) => [t.unit, t.batch, t.phase, t.from, t.to, t.ts])).toEqual([
      ["U01", "B-U01", "before_shift", "idle", "running", 28800],
      ["U01", "B-U01", "before_shift", "running", "complete", 28920],
      ["U01", "B-U01", "after_shift", "idle", "running", 28920],
      ["U01", "B-U01", "after_shift", "running", "complete", 100000],
    ]);
  });
  it("Given a batch with no shift and a harvest Then before_shift runs to the harvest, and a batch still open at the end of the horizon has its first transition only", () => {
    const noShift = EVENTS.filter((e) => !(e.type === "process_event" && e.kind === "temperature_shift"));
    expect(phaseTransitions(noShift).map((t) => [t.phase, t.from, t.to, t.ts])).toEqual([["before_shift", "idle", "running", 28800], ["before_shift", "running", "complete", 100000]]);
    expect(phaseTransitions(EVENTS.slice(0, 1)).map((t) => [t.phase, t.from, t.to, t.ts])).toEqual([["before_shift", "idle", "running", 28800]]);
  });
  it("Given no alarm rows in the input Then a production run writes no alarm log: scheduled alarm events start no alarm transition (acknowledge and return-to-normal times have no ledger entry)", () => {
    expect(phaseTransitions(EVENTS).some((t) => t.phase === "alarm")).toBe(false);
  });
});
