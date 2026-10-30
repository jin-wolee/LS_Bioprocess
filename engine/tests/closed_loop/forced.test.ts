import { describe, expect, it } from "vitest";
import { evaluationSettings } from "../../src/evaluate/config.ts";
import { runArm } from "../../src/experiments/assembly/closed_loop_arm.ts";
import type { ArmSpec } from "../../src/experiments/assembly/closed_loop_arm.ts";
import { runClosedLoopSeed } from "../../src/experiments/assembly/closed_loop.ts";
import type { ClosedLoopInput } from "../../src/experiments/assembly/closed_loop.ts";
import { plantStream } from "../../src/experiments/assembly/closed_loop_plant.ts";
import { buildShared } from "../../src/experiments/assembly/closed_loop_shared.ts";
import type { ForcedError } from "../../src/inject/types.ts";
import type { ObservableEvent } from "../../src/observe.ts";
import type { ResultRow } from "../../src/record/types.ts";
import { createRng } from "../../src/rng.ts";
import { runScenario } from "../../src/run.ts";
import { loadScenario } from "../../src/scenario.ts";
import { ELEVEN, PRESETS } from "../support/open_loop_setup.ts";
import { readJson } from "../support/paths.ts";
import { SMALL, lookup, patched, rawScenario } from "../support/scenarios.ts";

// S3d: a label error forced on a named sample reaches the recorded pH rows that the arms read (lab_ui.md sections 5 and 9, "The decision variant"). The world is the small SC8 scenario
// with the technique probability at 0.5 (so that some samples are open and some closed: the container is drawn per sample with key (seed, sample, -, 0, error:technique_error), A064),
// seed 3. The facts below are read from the truth events of that run (the sample draws, the run starts and the results), not from any arm:
//   U01-D01-2  drawn 124589, run starts 125711 (hold 1122 s), pH result at 125981 on AN-1, technique draw 0.928: closed.
//   U04-D01-2  drawn 125634, run starts 126451 (hold 817 s), pH result at 126721 on AN-1, technique draw 0.245: open. It is the next draw after U01-D01-2 in the stream.
// The production rule of a label error takes the next draw as the id the label reads, so the plant is U01-D01-2 labelled as U04-D01-2.

const EVAL = evaluationSettings(readJson("scenarios", "evaluation", "default.json"));
const A = ELEVEN[0]!;
const C_MINUS = ELEVEN[3]!; // c_context_minus_system_issued_id: the other seven flags on
const scenario = loadScenario(patched(rawScenario("sc08_ph_restandardisation"), { settings: { ...SMALL, technique_error_probability: 0.5 } }), lookup);
const run = runScenario({ ...scenario, seed: 3, feedback: false });
const PLANT: ForcedError = { type: "label_error", sample_id: "U01-D01-2", detail: { as_id: "U04-D01-2" } };
const sharedOf = (architectures: typeof PRESETS, forced?: readonly ForcedError[]) =>
  buildShared(run, scenario, 3, { architectures, evaluation: EVAL, rng: createRng(), ...(forced && { forced }) });
const input = (over: Partial<ClosedLoopInput> = {}): ClosedLoopInput => ({
  scenario, seeds: [3], evaluation: EVAL, architectures: PRESETS, variants: [{ id: "c_context_modelled", of: "c_context", bias_handling: "model" }], ...over,
});

describe("A forced label error: which row the record files under which id", () => {
  it("Given A and the plant Then the pH row measured for U01-D01-2 is filed under U04-D01-2 and still stands for U01-D01-2's run; U04-D01-2's own row is filed under it as before", () => {
    const sh = sharedOf([A], [PLANT]);
    const planted = sh.structure.a_manual?.ph.get("U01-D01-2") ?? [];
    expect(planted.map((x) => [x.row.request_id, x.row.measured_at, x.run_id])).toEqual([["U04-D01-2", 125981, "U01-D01-2/1/1"]]);
    const own = sh.structure.a_manual?.ph.get("U04-D01-2") ?? [];
    expect(own.map((x) => [x.row.request_id, x.row.measured_at, x.run_id])).toEqual([["U04-D01-2", 126721, "U04-D01-2/1/1"]]);
    expect(sh.structure.a_manual?.materialised.filter((m) => m.type === "label_error")).toEqual([{ type: "label_error", sample_id: "U01-D01-2", detail: { as_id: "U04-D01-2" } }]);
  });

  it("Given no plant Then the same row is filed under its own id", () => {
    const sh = sharedOf([A]);
    expect((sh.structure.a_manual?.ph.get("U01-D01-2") ?? []).map((x) => [x.row.request_id, x.run_id])).toEqual([["U01-D01-2", "U01-D01-2/1/1"]]);
    expect(sh.structure.a_manual?.materialised).toEqual([]);
  });

  it("Given C, where system_issued_id prevents the error, and the same plant Then every pH row is filed under its own id and no label error is realised", () => {
    const sh = sharedOf(PRESETS, [PLANT]);
    expect((sh.structure.c_context?.ph.get("U01-D01-2") ?? []).map((x) => x.row.request_id)).toEqual(["U01-D01-2"]);
    expect(sh.structure.c_context?.materialised.filter((m) => m.type === "label_error")).toEqual([]);
    expect(sh.structure.b_lims_lite?.materialised.filter((m) => m.type === "label_error")).toEqual([]);
  });

  it("Given C without system_issued_id (idempotency on) and the plant Then U04-D01-2's own result, later on the same analyzer with the same key, is not loaded: the only row filed under U04-D01-2 is the planted sample's", () => {
    const sh = sharedOf([C_MINUS], [PLANT]);
    const id = C_MINUS.id;
    expect((sh.structure[id]?.ph.get("U01-D01-2") ?? []).map((x) => [x.row.request_id, x.row.measured_at])).toEqual([["U04-D01-2", 125981]]);
    expect(sh.structure[id]?.ph.has("U04-D01-2")).toBe(false);
  });

  it("Given two results of different samples filed under one id at the same second with the same value Then the row cannot be told apart and the stream is refused", () => {
    const drawn = (sample_id: string, unit_id: string): ObservableEvent => ({ type: "sample_drawn", t: 10, sample_id, unit_id, batch_id: "B", operator_id: "O1", volume_ul: 100 });
    const measured = (request_id: string, analyzer: string): ObservableEvent => ({ type: "result_measured", t: 500, request_id, attempt: 1, visit: 1, analyzer, analyte: "ph", value: 7 });
    const events = [drawn("S1", "U1"), drawn("S2", "U2"), measured("S1", "AN-1"), measured("S2", "AN-2")];
    const planted = plantStream(1, A, events, [{ type: "label_error", sample_id: "S1", detail: { as_id: "S2" } }]);
    const row = { run_id: "S2/1/1", analyte: "ph", measured_at: 500, value: 7 } as ResultRow;
    expect(() => planted.standsFor(row)).toThrow(/same instant/);
  });
});

describe("A forced label error in the closed loop: the arms", () => {
  const base = runClosedLoopSeed(input(), 3);
  const planted = runClosedLoopSeed(input({ forced: [PLANT] }), 3);
  const arm = (o: typeof base, id: string) => o.arms.find((a) => a.id === id) as (typeof base)["arms"][number];

  it("Then the oracle, which reads no record, is the oracle of the unplanted loop", () => {
    expect(arm(planted, "oracle")).toEqual(arm(base, "oracle"));
  });

  it("Then B and C, which prevent the error, and the modelled variant of C are what they were", () => {
    for (const id of ["b_lims_lite", "c_context", "c_context_modelled"]) expect(arm(planted, id), id).toEqual(arm(base, id));
  });

  it("Then A skips one readjustment it made before (the decision of U01 at 201600 reads an open container) and only reactor U01 moves", () => {
    const a = arm(planted, "a_manual");
    const b = arm(base, "a_manual");
    expect(a.counts).toEqual({ ...b.counts, readjusted: b.counts.readjusted - 1, skipped_known_bias: b.counts.skipped_known_bias + 1 });
    expect(a.reactors[0]).not.toEqual(b.reactors[0]);
    expect(a.reactors.slice(1)).toEqual(b.reactors.slice(1));
  });
});

describe("The decision log", () => {
  const sh = sharedOf(PRESETS);

  it("Given the log is asked for Then A's arm returns one entry per readjustment slot, in the order of the slots, and the oracle's is empty", () => {
    const a = runArm(sh, { id: "a_manual", kind: "architecture", structure: "a_manual" } as ArmSpec, createRng(), { decisions: true });
    expect(a.decisions?.length).toBe(a.counts.slots);
    expect(a.decisions?.filter((d) => d.action === "readjust").length).toBe(a.counts.readjusted);
    expect(a.decisions?.filter((d) => d.action === "skip").length).toBe(a.counts.skipped_known_bias);
    expect(a.decisions?.filter((d) => d.action === "none").length).toBe(a.counts.no_new_result);
    expect(runArm(sh, { id: "oracle", kind: "oracle" }, createRng(), { decisions: true }).decisions).toEqual([]);
  });

  it("Given the log is not asked for Then the outcome has no decisions key and equals the outcome with the log asked for, key apart", () => {
    const spec: ArmSpec = { id: "a_manual", kind: "architecture", structure: "a_manual" };
    const plain = runArm(sh, spec, createRng());
    const logged = runArm(sh, spec, createRng(), { decisions: true });
    expect("decisions" in plain).toBe(false);
    const { decisions, ...rest } = logged;
    expect(decisions?.length).toBeGreaterThan(0);
    expect(rest).toEqual(plain);
  });
});
