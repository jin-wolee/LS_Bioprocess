import { describe, expect, it } from "vitest";
import { evaluationSettings } from "../../src/evaluate/config.ts";
import type { LoggedDecision } from "../../src/experiments/assembly/closed_loop_log.ts";
import { eligibleSamples, pickDecisionPlant } from "../../src/experiments/assembly/lab/decision_plant.ts";
import { decisionTruth, differingDecisions, runDecisionLoop } from "../../src/experiments/assembly/lab/decisions.ts";
import type { DecisionLoop } from "../../src/experiments/assembly/lab/decisions.ts";
import type { ForcedError } from "../../src/inject/types.ts";
import type { Architecture } from "../../src/record/architecture.ts";
import { createRng } from "../../src/rng.ts";
import type { StreamKey } from "../../src/rng.ts";
import { runScenario } from "../../src/run.ts";
import { loadScenario } from "../../src/scenario.ts";
import { loadClosedLoop } from "../support/experiment2.ts";
import { ALL_ARCHS } from "../support/open_loop_setup.ts";
import { readJson } from "../support/paths.ts";
import { SMALL, lookup, patched, rawScenario } from "../support/scenarios.ts";

// S3d, the lab function of the decision variant (lab_ui.md section 9, "The decision variant"). The world is the small SC8 scenario with the technique probability at 0.5, seed 3
// (A064: the container of a sample is open when its draw with key (seed, sample, -, 0, error:technique_error) is below 0.5). The expected values are typed by hand from the truth
// events of that run and from the rules of the spec, never from an arm:
//   the decision of a reactor at a readjustment tick (every 24 h, A108, from the reactor's first tick) reads the newest pH row it has not used that was measured at or before the tick
//   (spec 6.2); it skips the value when the container the record gives it is open (A041), or the hold it gives it is above 1800 s (A046, only where sampled_at is stored: C);
//   the container and the hold are those of the id the row is filed under, which is the neighbour's under a label error.
//   U01 has its ticks at 115200, 201600, 288000, ... Its pH rows: U01-D01-1 (121600), U01-D01-2 (125981), U01-D02-1 (203670), ...
//   U01-D01-2: drawn 124589, run starts 125711 (hold 1122 s), result 125981, closed.   U04-D01-2: drawn 125634, run starts 126451 (hold 817 s), result 126721, open.
//   U03-D01-2: drawn 121144, run starts 121956 (hold 812 s), result 122226, open.     U06-D01-2: drawn 121845, run starts 122808, result 123078, closed.
// At 201600 U01's newest row is U01-D01-2's (closed, hold 1122 s: used by every architecture); at 203400 U03's newest row is U03-D01-2's (open: skipped by every architecture).

const EVAL = evaluationSettings(readJson("scenarios", "evaluation", "default.json"));
const A: Architecture = ALL_ARCHS[0]!;
const C: Architecture = ALL_ARCHS[2]!;
const C_MINUS: Architecture = ALL_ARCHS[3]!; // c_context_minus_system_issued_id
const scenario = loadScenario(patched(rawScenario("sc08_ph_restandardisation"), { settings: { ...SMALL, technique_error_probability: 0.5 } }), lookup);
const run = runScenario({ ...scenario, seed: 3, feedback: false });
const loopOf = (architecture: Architecture, forced?: readonly ForcedError[]): DecisionLoop =>
  runDecisionLoop({ scenario, seed: 3, evaluation: EVAL, architecture, run, ...(forced && { forced }) });
const decision = (loop: DecisionLoop, id: string): LoggedDecision => {
  const d = loop.decisions.find((x) => x.decision_id === id);
  if (!d) throw new Error(`no decision ${id}`);
  return d;
};
const PLANT_1: ForcedError = { type: "label_error", sample_id: "U01-D01-2", detail: { as_id: "U04-D01-2" } };
const PLANT_2: ForcedError = { type: "label_error", sample_id: "U03-D01-2", detail: { as_id: "U06-D01-2" } };

describe("The decisions of the unplanted loop, as the record holds them", () => {
  const a = loopOf(A);

  it("Given A Then the decisions are in time order, one per reactor and readjustment tick, with the id <unit>@<t>", () => {
    expect(a.decisions.map((d) => d.t)).toEqual([...a.decisions.map((d) => d.t)].sort((x, y) => x - y));
    expect(a.decisions.length).toBe(6 * 6); // six reactors, each with 8641 sensor ticks (six days from its first tick): readjustment ticks 115200, 201600, ... 547200 for U01
    expect(a.decisions.map((d) => d.decision_id)).toContain("U01@115200");
    expect(a.decisions.every((d) => d.decision_id === `${d.unit_id}@${d.t}`)).toBe(true);
  });

  it("Given A and the first tick of U01 Then no pH row exists yet: the decision is none and reads nothing", () => {
    expect(decision(a, "U01@115200")).toMatchObject({ unit_id: "U01", t: 115200, action: "none", read: null, onto: null, reason: null });
  });

  it("Given A and the tick U01@201600 Then it reads the row filed under U01-D01-2 (measured 125981, closed, no hold stored) and readjusts onto its value", () => {
    const d = decision(a, "U01@201600");
    expect(d).toMatchObject({ action: "readjust", reason: null, read: { filed_under: "U01-D01-2", measured_at: 125981, container: "closed", hold_s: null, state: null } });
    expect(d.onto).toBe(d.read?.value);
  });

  it("Given C without system_issued_id and the same tick Then the record also gives the hold: 1122 s, within the limit, so it readjusts", () => {
    const d = decision(loopOf(C_MINUS), "U01@201600");
    expect(d).toMatchObject({ action: "readjust", read: { filed_under: "U01-D01-2", measured_at: 125981, container: "closed", hold_s: 1122 } });
  });

  it("Given A and the tick U03@203400 Then the row's container is open: the decision skips for a known bias and sets nothing", () => {
    expect(decision(a, "U03@203400")).toMatchObject({ action: "skip", reason: "known_bias", onto: null, read: { filed_under: "U03-D01-2", measured_at: 122226, container: "open" } });
  });
});

describe("A label error on U01-D01-2 read as U04-D01-2 (a closed sample filed under an open one)", () => {
  const base = loopOf(A);
  const planted = loopOf(A, [PLANT_1]);

  it("Then the decision U01@201600 reads the neighbour's row: filed under U04-D01-2, with U04-D01-2's container, and skips where it readjusted", () => {
    const d = decision(planted, "U01@201600");
    expect(d).toMatchObject({ action: "skip", reason: "known_bias", onto: null, read: { filed_under: "U04-D01-2", measured_at: 125981, container: "open", hold_s: null } });
  });

  it("Then it is still the value of the planted sample: the value read equals the value the unplanted loop read", () => {
    expect(decision(planted, "U01@201600").read?.value).toBe(decision(base, "U01@201600").read?.value);
  });

  it("Then it is the only decision that differs from the unplanted loop (action or row)", () => {
    expect(differingDecisions(base.decisions, planted.decisions)).toEqual(["U01@201600"]);
  });

  it("Then the truth side names the sample the row came from and its real container and hold, which the record view does not", () => {
    expect(decisionTruth(planted, "U01@201600")).toEqual({ decision_id: "U01@201600", from_sample: "U01-D01-2", container: "closed", hold_s: 1122 });
    expect(decisionTruth(base, "U01@201600")).toEqual({ decision_id: "U01@201600", from_sample: "U01-D01-2", container: "closed", hold_s: 1122 });
    expect(decisionTruth(planted, "U01@115200")).toBeNull();
    expect(JSON.stringify(planted.decisions)).not.toMatch(/from_sample/);
  });
});

describe("A label error on U03-D01-2 read as U06-D01-2 (an open sample filed under a closed one)", () => {
  const base = loopOf(A);
  const planted = loopOf(A, [PLANT_2]);

  it("Then the decision U03@203400 reads the closed neighbour's context and readjusts onto the value of the open sample it skipped before", () => {
    const d = decision(planted, "U03@203400");
    expect(d).toMatchObject({ action: "readjust", read: { filed_under: "U06-D01-2", measured_at: 122226, container: "closed" } });
    expect(d.onto).toBe(decision(base, "U03@203400").read?.value);
    expect(differingDecisions(base.decisions, planted.decisions)).toEqual(["U03@203400"]);
  });

  it("Then the truth side says the value came from an open container held 812 s", () => {
    expect(decisionTruth(planted, "U03@203400")).toEqual({ decision_id: "U03@203400", from_sample: "U03-D01-2", container: "open", hold_s: 812 });
  });
});

describe("The same plant under C, where system_issued_id prevents the error", () => {
  it("Then no decision differs, none of them in any field, and the injector realises no label error", () => {
    const base = loopOf(C);
    const planted = loopOf(C, [PLANT_1]);
    expect(planted.decisions).toEqual(base.decisions);
    expect(differingDecisions(base.decisions, planted.decisions)).toEqual([]);
    expect(planted.materialised.filter((m) => m.type === "label_error")).toEqual([]);
  });
});

describe("The same plant under C without system_issued_id", () => {
  const base = loopOf(C_MINUS);
  const planted = loopOf(C_MINUS, [PLANT_1]);

  it("Then the decision differs as in A: the neighbour's row, the neighbour's container, a skip where it readjusted", () => {
    expect(decision(planted, "U01@201600")).toMatchObject({ action: "skip", reason: "known_bias", onto: null, read: { filed_under: "U04-D01-2", measured_at: 125981, container: "open" } });
    expect(differingDecisions(base.decisions, planted.decisions)).toEqual(["U01@201600"]);
  });

  it("Then the hold it reads is the neighbour's: the run table holds one run for U04-D01-2/1/1, the one the later run_started (U04-D01-2's, 126451) wrote, less the neighbour's draw at 125634", () => {
    expect(decision(planted, "U01@201600").read?.hold_s).toBe(817);
  });
});

describe("differingDecisions compares the action and the row, not the values", () => {
  const d = (over: Partial<LoggedDecision> = {}): LoggedDecision => ({
    decision_id: "U01@100", unit_id: "U01", t: 100, action: "readjust", onto: 7.01, reason: null,
    read: { result_id: "R1", filed_under: "S1", measured_at: 50, value: 7.01, container: "closed", hold_s: null, state: null }, ...over,
  });
  const read = (over: Partial<NonNullable<LoggedDecision["read"]>>): NonNullable<LoggedDecision["read"]> => ({ ...(d().read as NonNullable<LoggedDecision["read"]>), ...over });

  it("Given equal decisions, or a different value and onto only Then nothing differs", () => {
    expect(differingDecisions([d()], [d()])).toEqual([]);
    expect(differingDecisions([d()], [d({ onto: 7.2, read: read({ value: 7.2 }) })])).toEqual([]);
  });

  it("Given another action, another id filed under, another measured_at, or a row against none Then the decision differs", () => {
    expect(differingDecisions([d()], [d({ action: "skip", onto: null, reason: "known_bias" })])).toEqual(["U01@100"]);
    expect(differingDecisions([d()], [d({ read: read({ filed_under: "S2" }) })])).toEqual(["U01@100"]);
    expect(differingDecisions([d()], [d({ read: read({ measured_at: 51 }) })])).toEqual(["U01@100"]);
    expect(differingDecisions([d()], [d({ action: "none", onto: null, read: null })])).toEqual(["U01@100"]);
  });

  it("Given a context only (container or hold) that changed with the same action and row Then it does not differ", () => {
    expect(differingDecisions([d()], [d({ read: read({ container: "open", hold_s: 9 }) })])).toEqual([]);
  });

  it("Given loops with other decision ids Then they cannot be compared", () => {
    expect(() => differingDecisions([d()], [d({ decision_id: "U01@200", t: 200 })])).toThrow(/same decisions/);
  });
});

describe("The sample that is planted", () => {
  const base = loopOf(A);
  // Every sample whose pH row a decision of A reads in the unplanted loop (spec 6.2: the newest row not used before, at each tick), listed by hand from the sample draws, the first
  // results and the ticks of U01..U06 (a decision that reads nothing is not listed). The neighbour is the next draw in the stream, else the previous.
  const READ = [
    "U01-D01-2", "U01-D02-2", "U01-D03-2", "U01-D04-2", "U01-D05-1",
    "U02-D01-1", "U02-D02-2", "U02-D03-1", "U02-D04-1", "U02-D05-1",
    "U03-D01-2", "U03-D02-2", "U03-D03-1", "U03-D04-1", "U03-D05-1",
    "U04-D02-1", "U04-D02-2", "U04-D03-1", "U04-D04-1", "U04-D05-1",
    "U05-D01-1", "U05-D02-2", "U05-D03-2", "U05-D04-1", "U05-D05-1",
    "U06-D01-1", "U06-D03-1", "U06-D03-2", "U06-D04-1", "U06-D06-1",
  ];
  const drawn = run.events.flatMap((e) => (e.type === "sample_drawn" ? [e.sample_id] : []));
  const neighbourOf = (id: string): string => (drawn[drawn.indexOf(id) + 1] ?? drawn[drawn.indexOf(id) - 1]) as string;

  it("Given A and the unplanted loop Then the eligible samples are those whose row a decision reads, each with the neighbour whose id the label takes", () => {
    const eligible = eligibleSamples(base);
    expect(eligible.map((e) => e.sample_id)).toEqual([...READ].sort());
    for (const e of eligible) expect(e.as_id, e.sample_id).toBe(neighbourOf(e.sample_id));
    expect(neighbourOf("U01-D01-2")).toBe("U04-D01-2");
  });

  it("Given the draws Then one draw per eligible sample is asked for, keyed (run_seed, sample_id, -, 0, challenge:pick_decision), and the sample with the smallest u is the plant", () => {
    const keys: StreamKey[] = [];
    const plant = pickDecisionPlant(3, base, createRng((k) => keys.push(k)));
    expect(keys.map((k) => k[1]).sort()).toEqual([...READ].sort());
    for (const k of keys) expect([k[0], k[2], k[3], k[4]]).toEqual([3, "-", 0, "challenge:pick_decision"]);
    // the draw of a sample is a function of its own key alone (spec section 3, rule 3), so the minimum can be taken here from the canonical keys
    const u = (id: string): number => createRng().stream([3, id, "-", 0, "challenge:pick_decision"]).float();
    const smallest = [...READ].sort((x, y) => u(x) - u(y) || (x < y ? -1 : 1))[0] as string;
    expect(plant).toEqual({ type: "label_error", sample_id: smallest, detail: { as_id: neighbourOf(smallest) } });
  });

  it("Given the same seed and loop twice Then the plant is the same (it is a function of the seed)", () => {
    expect(pickDecisionPlant(3, base)).toEqual(pickDecisionPlant(3, base));
  });

  it("Given the plant Then a decision of A reads its row: the planted loop differs from the unplanted one in at least that decision", () => {
    const plant = pickDecisionPlant(3, base) as ForcedError;
    const planted = loopOf(A, [plant]);
    const differing = differingDecisions(base.decisions, planted.decisions);
    expect(differing.length).toBeGreaterThanOrEqual(1);
    expect(differing.map((id) => decisionTruth(base, id)?.from_sample)).toContain(plant.sample_id);
  });
});

describe("The plant at the full size of experiment 2 (the first five seeds of its list)", () => {
  const { input } = loadClosedLoop(readJson("scenarios", "experiments", "experiment2.json"));

  it.each(input.seeds.slice(0, 5))("Given seed %i Then the picked plant changes the decision that read its row in A and in C without system_issued_id, and changes nothing in C", (seed) => {
    const lab = runScenario({ ...input.scenario, seed, feedback: false });
    const loop = (architecture: Architecture, forced?: readonly ForcedError[]): DecisionLoop =>
      runDecisionLoop({ scenario: input.scenario, seed, evaluation: input.evaluation, architecture, run: lab, ...(forced && { forced }) });
    for (const architecture of [A, C_MINUS]) {
      const base = loop(architecture);
      const plant = pickDecisionPlant(seed, base) as ForcedError;
      expect(plant, architecture.id).not.toBeNull();
      const readers = base.decisions.filter((d) => decisionTruth(base, d.decision_id)?.from_sample === plant.sample_id).map((d) => d.decision_id);
      expect(readers.length, architecture.id).toBeGreaterThan(0);
      // every row of the planted sample is now filed under another id, so each decision that read one of them reads another row or none
      expect(differingDecisions(base.decisions, loop(architecture, [plant]).decisions), architecture.id).toEqual(expect.arrayContaining(readers));
    }
    const base = loop(C);
    const plant = pickDecisionPlant(seed, base) as ForcedError;
    expect(loop(C, [plant]).decisions).toEqual(base.decisions);
  });
});
