import { vi } from "vitest";
import { beforeAll, describe, expect, it } from "vitest";
import type { Response, ScenePlan } from "../../../src/protocol.ts";
import { createWorker } from "../../../src/worker/worker.ts";
import type { WorkerEnv } from "../../../src/worker/worker.ts";
import { HIDDEN_FIELDS, TRUTH_ONLY_TYPES } from "../../src/observe.ts";
import { answerPlantCase } from "../../src/experiments/assembly/lab/plant_case.ts";
import type { PlantKept } from "../../src/experiments/assembly/lab/plant.ts";
import { truthKeyOf } from "../../src/experiments/assembly/lab/truth_key.ts";
import { canonicalJson } from "../../src/trace.ts";
import { labData } from "../support/lab_data.ts";
import { SMALL } from "../support/scenarios.ts";
import { breakoutData } from "./breakout_data.ts";

vi.stubEnv("VITE_LAB_LOCAL", "1");

// P7b (docs/design/plant_ui.md section 6, rules 8 and 11): the break-out case through the Worker. `plant_run` with a case answers `plant_ready` with the first hall and one `plant_halls` for each other
// architecture, as for any run; the plan assembled from them is byte-equal to the plan of one build (`runPlantCase`); `plant_record` and `plant_truth` read what the Worker kept; a build with no
// SC12 file refuses a case as the `breakout` request does; and no message of a plant run holds what only the hidden script knows (the truth-boundary group at the end, over all five cases).
// Every expected value of the pick `{ breakout: true }` is typed by hand from the case's scenario file: the instant a unit becomes contaminated is its first take of the contaminated item
// (52 h = 187200 s and 62 h = 223200 s for the lots and the transfer lines of the files, the inoculation for a seed lot).

const data = breakoutData();
const ARCH = ["a_manual", "b_lims_lite", "c_context", "c_context_minus_material_lot_links", "c_context_minus_equipment_links"];
const SEED = 9013;
const caseSpec = (id = "sc12_medium_lot", architectures: string[] = ARCH, actions: unknown[] = [], seed = SEED) => ({ case: id, architectures, seed, actions });

const setup = (d = data, onPost: (m: Response, worker: ReturnType<typeof createWorker>) => void = () => undefined) => {
  const posted: Response[] = [];
  const env: WorkerEnv = { data: d, now: () => performance.now(), fetchReference: async () => undefined };
  const worker: ReturnType<typeof createWorker> = createWorker((m) => {
    posted.push(structuredClone(m));
    onPost(m, worker);
  }, env);
  const ask = async (message: unknown): Promise<Response[]> => {
    const n = posted.length;
    await worker.onMessage(message);
    return posted.slice(n);
  };
  const plant = (id: number, epoch: number, spec: unknown = caseSpec()) => worker.onMessage({ type: "plant_run", id, epoch, spec });
  return { posted, worker, ask, plant };
};
type Ready = Extract<Response, { type: "plant_ready" }>;
type Halls = Extract<Response, { type: "plant_halls" }>;
const readyOf = (posted: Response[], epoch: number): Ready => {
  const m = posted.find((p) => p.type === "plant_ready" && p.epoch === epoch);
  if (m?.type !== "plant_ready") throw new Error(`no plant_ready of epoch ${epoch}`);
  return m;
};
const hallsOf = (posted: Response[], epoch: number): Halls[] => posted.filter((p): p is Halls => p.type === "plant_halls" && p.epoch === epoch);
const assembled = (posted: Response[], epoch: number) => {
  const ready = readyOf(posted, epoch);
  const halls = hallsOf(posted, epoch);
  const plan: ScenePlan = { ...ready.plan, records: [...ready.plan.records, ...halls.flatMap((h) => h.records)] };
  return { plan, truth: ready.hashes.truth, cells: Object.assign({}, ready.hashes.cells, ...halls.map((h) => h.cells)) as Record<string, string> };
};
const reference = async (spec: unknown): Promise<{ plan: ScenePlan; truth: string; cells: Record<string, string>; kept: PlantKept }> => {
  const out = await answerPlantCase(data, spec);
  if (!out.ok) throw new Error(out.message);
  return { plan: out.answer.plan, truth: out.answer.hashes.truth, cells: out.answer.hashes.cells, kept: out.kept };
};

describe("plant_run with a case: the first hall with plant_ready, the others after it", () => {
  it("Given the five records Then plant_ready holds the plan with the hall of A and its holds, and plant_halls follow for the other four in the order of the list, with the id and the epoch of the request", async () => {
    const { posted, plant } = setup();
    await plant(11, 4);
    expect(posted.filter((m) => m.type === "plant_ready" || m.type === "plant_halls").map((m) => m.type)).toEqual(["plant_ready", "plant_halls", "plant_halls", "plant_halls", "plant_halls"]);
    const ready = readyOf(posted, 4);
    expect([ready.id, ready.epoch]).toEqual([11, 4]);
    expect(ready.plan.records.map((r) => r.architecture)).toEqual(["a_manual"]);
    expect(ready.plan.records[0]?.holds?.length).toBeGreaterThan(0);
    expect(ready.plan.layout.architectures).toEqual(ARCH); // the floor has every hall from the first answer
    expect(Object.keys(ready.hashes.cells)).toEqual(["a_manual"]);
    expect(Object.keys(ready).sort()).toEqual(["checks", "epoch", "hashes", "id", "key", "plan", "resume_at", "type"]);
    expect(hallsOf(posted, 4).map((h) => [h.id, h.epoch, h.records.map((r) => r.architecture), Object.keys(h.cells)])).toEqual(ARCH.slice(1).map((a) => [11, 4, [a], [a]]));
  }, 120_000);

  it("Given the messages of the medium-lot case Then the plan assembled from plant_ready and its plant_halls is byte-equal (canonical JSON) to the plan of one build, with the same truth hash and the same five cell digests", async () => {
    const { posted, plant } = setup();
    await plant(12, 1);
    const got = assembled(posted, 1);
    const once = await reference(caseSpec());
    expect(canonicalJson(got.plan)).toBe(canonicalJson(once.plan));
    expect(got.truth).toBe(once.truth);
    expect(got.cells).toEqual(once.cells);
  }, 120_000);

  it("Given another case in another order of the records and with a feed Then the assembled plan is again byte-equal to the plan of one build of that spec", async () => {
    const spec = caseSpec("sc12_equipment", ["c_context", "a_manual", "b_lims_lite"], [{ kind: "add_feed", at: 302400, unit_id: "U03" }], 9127);
    const { posted, plant } = setup();
    await plant(13, 1, spec);
    const got = assembled(posted, 1);
    const once = await reference(spec);
    expect(readyOf(posted, 1).plan.records.map((r) => r.architecture)).toEqual(["c_context"]);
    expect(canonicalJson(got.plan)).toBe(canonicalJson(once.plan));
    expect(got.cells).toEqual(once.cells);
    expect(got.truth).toBe(once.truth);
  }, 120_000);

  it("Given the same case asked through the breakout request Then the truth hash of plant_ready is its truth_log_hash", async () => {
    const { posted, plant, ask } = setup();
    await plant(14, 1, caseSpec("sc12_seed_lot", ["a_manual", "c_context"]));
    const [m] = await ask({ type: "breakout", id: 15, case: "sc12_seed_lot", architectures: ["a_manual", "c_context"], seed: SEED });
    if (m?.type !== "breakout_result") throw new Error(`breakout_result expected, got ${JSON.stringify(m)?.slice(0, 200)}`);
    expect(readyOf(posted, 1).hashes.truth).toBe(m.result.truth_log_hash);
  }, 120_000);

  it("Given a case Then the key of plant_ready is the key of its own truth log, and another case has another key", async () => {
    const { posted, plant } = setup();
    await plant(16, 1, caseSpec("sc12_medium_lot", ["a_manual"]));
    await plant(17, 2, caseSpec("sc12_seed_lot", ["a_manual"]));
    const once = await reference(caseSpec("sc12_medium_lot", ["a_manual"]));
    expect(readyOf(posted, 1).key).toBe(truthKeyOf(once.kept.events));
    expect(readyOf(posted, 2).key).not.toBe(readyOf(posted, 1).key);
  }, 120_000);
});

describe("plant_run with a case: epochs, previous answers and refusals", () => {
  it("Given a newer plant_run that arrives the moment plant_ready is posted Then no plant_halls of the first epoch follows", async () => {
    let second: Promise<void> | void = undefined;
    const { posted, plant } = setup(data, (m, worker) => {
      if (m.type === "plant_ready" && m.epoch === 1) second = worker.onMessage({ type: "plant_run", id: 22, epoch: 2, spec: caseSpec("sc12_medium_lot", ["a_manual", "c_context"]) });
    });
    await plant(21, 1);
    await second;
    expect(hallsOf(posted, 1)).toEqual([]);
    expect(hallsOf(posted, 2).map((h) => h.records[0]?.architecture)).toEqual(["c_context"]);
    expect(posted.filter((m) => m.type === "error")).toEqual([]);
  }, 240_000);

  it("Given the same case asked again with a feed Then prefix_equal is true and the view resumes at the feed; asked for another case it is as for a first answer", async () => {
    const { posted, plant } = setup();
    const only = ["a_manual"];
    await plant(31, 1, caseSpec("sc12_medium_lot", only));
    expect(readyOf(posted, 1)).toMatchObject({ resume_at: 0, checks: { prefix_equal: null, truth_equal: null } });
    const feed = [{ kind: "add_feed", at: 302400, unit_id: "U03" }];
    await plant(32, 2, caseSpec("sc12_medium_lot", only, feed));
    expect(readyOf(posted, 2)).toMatchObject({ resume_at: 302400, checks: { prefix_equal: true, truth_equal: null } });
    await plant(33, 3, caseSpec("sc12_seed_lot", only, feed));
    expect(readyOf(posted, 3)).toMatchObject({ resume_at: 0, checks: { prefix_equal: null, truth_equal: null } });
  }, 240_000);

  it("Given a flag switched on a hall of the case Then the hall is the derived record, the truth is as it was (truth_equal), and the record that had no lot links now holds a lot", async () => {
    const { posted, plant } = setup();
    const halls = ["a_manual", "b_lims_lite"];
    await plant(36, 1, caseSpec("sc12_medium_lot", halls));
    const flag = [{ kind: "set_flag", at: 302400, architecture: "b_lims_lite", flag: "material_lot_links", on: true }];
    await plant(37, 2, caseSpec("sc12_medium_lot", halls, flag));
    const before = assembled(posted, 1);
    const after = assembled(posted, 2);
    expect(readyOf(posted, 2)).toMatchObject({ resume_at: 302400, checks: { prefix_equal: null, truth_equal: true } });
    expect(after.truth).toBe(before.truth);
    expect(after.plan.records.map((r) => r.architecture)).toEqual(["a_manual", "b_lims_lite_plus_material_lot_links"]);
    const lotHolds = (plan: ScenePlan, i: number) => (plan.records[i]?.holds ?? []).filter((h) => h.on === "lot").length;
    expect(lotHolds(before.plan, 1)).toBe(0);
    expect(lotHolds(after.plan, 1)).toBeGreaterThan(0);
    expect(after.cells.b_lims_lite_plus_material_lot_links).not.toBe(before.cells.b_lims_lite);
    expect(after.cells.a_manual).toBe(before.cells.a_manual);
  }, 240_000);

  it("Given a case with set_capture_path Then the error is refused with unknown_target, the index of the action and the epoch", async () => {
    const { ask } = setup();
    const out = await ask({ type: "plant_run", id: 41, epoch: 3, spec: caseSpec("sc12_medium_lot", ARCH, [{ kind: "add_feed", at: 302400, unit_id: "U03" }, { kind: "set_capture_path", at: 0, path: "adapter_ingest" }]) });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: "error", id: 41, epoch: 3, code: "refused", reason: "unknown_target", index: 1 });
  }, 120_000);

  it.each([
    ["an unknown case", { case: "sc12_nope" }],
    ["a key the form does not have", { colour: "red" }],
    ["a run beside the case", { run: { scenario: "default" } }],
    ["no architecture", { architectures: [] }],
  ])("Given %s Then invalid_spec with the epoch, and no plant_ready", async (_, extra) => {
    const { ask } = setup();
    const out = await ask({ type: "plant_run", id: 42, epoch: 2, spec: { ...caseSpec(), ...extra } });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: "error", id: 42, epoch: 2, code: "invalid_spec" });
  });

  it("Given a build with no SC12 file (the public build) Then a case is refused with the code and the message of the breakout request, ready.breakout is null and nothing is run", async () => {
    const { posted, worker, ask } = setup(labData());
    await worker.start();
    expect(posted[0]).toMatchObject({ type: "ready", breakout: null });
    const [refused] = await ask({ type: "plant_run", id: 51, epoch: 1, spec: caseSpec() });
    const [screen] = await ask({ type: "breakout", id: 52, case: "sc12_medium_lot", architectures: ["a_manual"], seed: SEED });
    expect(refused).toMatchObject({ type: "error", id: 51, epoch: 1, code: "invalid_spec", message: "this build does not offer the Break-out screen" });
    expect(screen).toMatchObject({ type: "error", id: 52, code: "invalid_spec", message: "this build does not offer the Break-out screen" });
    expect(posted.some((m) => m.type === "plant_ready" || m.type === "plant_halls")).toBe(false);
  }, 60_000);
});

describe("plant_record on a case", () => {
  it("Given a planned sample that A holds a card of Then the rows of the record are answered; a confirming sample has no card and is refused as unknown_target", async () => {
    const { posted, ask, plant } = setup();
    await plant(61, 5, caseSpec("sc12_medium_lot", ["a_manual", "c_context"]));
    const ready = readyOf(posted, 5);
    const card = ready.plan.records[0]?.cards[0];
    const id = ready.plan.samples[card?.sample as number]?.id as string;
    const [view] = await ask({ type: "plant_record", id: 62, epoch: 5, architecture: "a_manual", sample_id: id });
    expect(view).toMatchObject({ type: "plant_record_view", id: 62, epoch: 5, sample: { architecture: "a_manual" } });
    const [conf] = await ask({ type: "plant_record", id: 63, epoch: 5, architecture: "a_manual", sample_id: "U01-CONF" });
    expect(conf).toMatchObject({ type: "error", id: 63, epoch: 5, code: "refused", reason: "unknown_target" });
  }, 120_000);
});

const CASES: { id: string; event: Record<string, unknown>; affected: { unit: number; onset_s: number }[] }[] = [
  {
    id: "sc12_medium_lot",
    event: { type: "bacterial", profile: "bacterial", origin_kind: "medium_lot", origin_id: "ML-3", horizon_days: 21, horizon_ref: "A189", contaminated_at: { value: 48, unit: "h", ref: "A157" } },
    affected: [{ unit: 0, onset_s: 187200 }, { unit: 4, onset_s: 223200 }],
  },
  {
    id: "sc12_seed_lot",
    event: { type: "bacterial", profile: "bacterial", origin_kind: "seed_lot", origin_id: "SL-A", horizon_days: 21, horizon_ref: "A189", contaminated_at: { value: 0, unit: "h", ref: "A157" } },
    affected: [{ unit: 0, onset_s: 28800 }, { unit: 1, onset_s: 29700 }, { unit: 2, onset_s: 30600 }],
  },
  {
    id: "sc12_equipment",
    event: { type: "bacterial", profile: "bacterial", origin_kind: "shared_equipment", origin_id: "TL-1", horizon_days: 21, horizon_ref: "A189", contaminated_at: { value: 48, unit: "h", ref: "A157" } },
    affected: [{ unit: 0, onset_s: 187200 }, { unit: 1, onset_s: 223200 }],
  },
  {
    id: "sc12_mycoplasma",
    event: { type: "mycoplasma", profile: "mycoplasma", origin_kind: "medium_lot", origin_id: "ML-3", horizon_days: 33, horizon_ref: "A189", contaminated_at: { value: 48, unit: "h", ref: "A157" } },
    affected: [{ unit: 0, onset_s: 187200 }, { unit: 4, onset_s: 223200 }],
  },
];

describe("plant_truth with the pick { breakout: true }: the truth the Break-out screen reveals, on request", () => {
  it.each(CASES)("Given $id Then the pick is answered with the event as the screen prints it and the units it reached, each with the instant it became contaminated", async ({ id, event, affected }) => {
    const { ask, plant } = setup();
    await plant(71, 5, caseSpec(id, ["a_manual"]));
    const [m, ...rest] = await ask({ type: "plant_truth", id: 72, epoch: 5, pick: { breakout: true } });
    expect(rest).toEqual([]);
    expect(m).toEqual({ type: "plant_truth_view", id: 72, epoch: 5, view: { kind: "breakout", event, affected } });
  }, 120_000);

  it("Given the sampling case Then the event names the draw as the origin, with no instant of contamination, and the one affected unit became contaminated at that draw", async () => {
    const { posted, ask, plant } = setup();
    await plant(73, 5, caseSpec("sc12_sampling", ["a_manual"]));
    const draw = readyOf(posted, 5).plan.samples.find((s) => s.id === "U01-D02-1")?.drawn_s as number;
    const [m] = await ask({ type: "plant_truth", id: 74, epoch: 5, pick: { breakout: true } });
    expect(m).toEqual({
      type: "plant_truth_view", id: 74, epoch: 5,
      view: { kind: "breakout", event: { type: "bacterial", profile: "bacterial", origin_kind: "sampling", origin_id: "U01-D02-1", horizon_days: 21, horizon_ref: "A189", contaminated_at: null }, affected: [{ unit: 0, onset_s: draw }] },
    });
  }, 120_000);

  it("Given a case Then a pick of a sample, of the halls and of a confirming sample are answered or refused as for any run, and a pick of a unit is not offered", async () => {
    const { posted, ask, plant } = setup();
    await plant(75, 5, caseSpec("sc12_medium_lot", ["a_manual", "c_context"]));
    const id = readyOf(posted, 5).plan.samples[0]?.id as string;
    const [sample] = await ask({ type: "plant_truth", id: 76, epoch: 5, pick: { sample_id: id } });
    expect(sample).toMatchObject({ type: "plant_truth_view", epoch: 5, view: { kind: "sample", sample: { sample_id: id, picked_by: "reader" } } });
    const [halls] = await ask({ type: "plant_truth", id: 77, epoch: 5, pick: { halls: true } });
    expect(halls).toMatchObject({ type: "plant_truth_view", view: { kind: "halls" } });
    const [conf] = await ask({ type: "plant_truth", id: 78, epoch: 5, pick: { sample_id: "U01-CONF" } });
    expect(conf).toMatchObject({ type: "error", id: 78, epoch: 5, code: "refused", reason: "unknown_target" });
    const [unit] = await ask({ type: "plant_truth", id: 79, epoch: 5, pick: { unit_id: "U01" } });
    expect(unit).toMatchObject({ type: "error", id: 79, epoch: 5, code: "invalid_spec" });
  }, 120_000);

  it("Given a plant run that is not a case Then the pick is refused as unknown_target; given a case and a challenge open on another run Then the pick is not locked", async () => {
    const own = setup();
    await own.worker.onMessage({ type: "plant_run", id: 81, epoch: 1, spec: { run: { schema_version: "1", scenario: "default", settings: SMALL, architectures: ["a_manual"], seeds: [1] }, seed: 1, actions: [] } });
    const [refused] = await own.ask({ type: "plant_truth", id: 82, epoch: 1, pick: { breakout: true } });
    expect(refused).toMatchObject({ type: "error", id: 82, epoch: 1, code: "refused", reason: "unknown_target" });
    expect(refused).not.toHaveProperty("index");

    const { ask, plant } = setup();
    await plant(83, 2, caseSpec("sc12_medium_lot", ["a_manual"]));
    const [started] = await ask({ type: "challenge_start", id: 84, variant: "sample", spec: { schema_version: "1", scenario: "default", settings: SMALL, architectures: [], seeds: [1] }, seed: 1, shown: "a_manual" });
    expect(started?.type).toBe("challenge_ready");
    const [view] = await ask({ type: "plant_truth", id: 85, epoch: 2, pick: { breakout: true } });
    expect(view).toMatchObject({ type: "plant_truth_view", id: 85, epoch: 2, view: { kind: "breakout" } });
  }, 240_000);

  it("Given a plant run of a case and no request for the pick Then no message of the run is a plant_truth_view and none carries the event or the affected units", async () => {
    const { posted, plant } = setup();
    await plant(86, 1, caseSpec());
    expect(posted.some((m) => m.type === "plant_truth_view")).toBe(false);
    expect(JSON.stringify(posted)).not.toMatch(/"affected"|"horizon_ref"|"origin_id"|"contaminated_at"/);
  }, 120_000);
});

// ---- The truth boundary of the plant run of a case: every plant_ready and plant_halls of all five cases ----

// The allow-list is typed from plant_ui.md section 4.1: the exact keys at every level, with the entries of P7b.
const SHAPE: Record<string, readonly string[]> = {
  plan: ["schema_version", "seed", "horizon_s", "layout", "units", "analyzers", "staff", "samples", "marks", "windows", "calibrations", "records", "lots", "equipment", "confirms"],
  layout: ["bays", "analyzers", "architectures", "items"],
  items: ["lots", "equipment"],
  bay: ["size", "profile"],
  layoutAnalyzer: ["profile", "group"],
  unit: ["id", "bay", "slot", "profile", "batch", "start_s", "end_s"],
  analyzer: ["id", "profile", "group"],
  staff: ["id", "on_duty"],
  sample: ["id", "unit", "operator", "planned_s", "drawn_s", "arrived_s", "label", "kind", "skipped", "visits"],
  visit: ["analyzer", "queued_s", "started_s", "run_started_s", "ended_s", "attempt", "qc", "setup_s", "diluted"],
  mark: ["t", "unit", "kind", "source", "item"],
  window: ["analyzer", "kind", "from_s", "to_s"],
  calibration: ["analyzer", "t"],
  record: ["architecture", "flags_on", "cards", "holds"],
  card: ["sample", "shown_s", "available_s", "slots", "findings", "version_s"],
  finding: ["rule", "raised_s"],
  slot: ["name", "stored", "basis"],
  hold: ["t", "event", "on", "target"],
  lot: ["id", "kind", "uses"],
  use: ["unit", "t"],
  equipment: ["id", "uses"],
  confirm: ["sample", "test", "result_s", "outcome"],
};
const within = (o: object, shape: string, where: string): void => {
  for (const k of Object.keys(o)) expect(SHAPE[shape], `${where}.${k}`).toContain(k);
};
const checkPlan = (plan: ScenePlan, where: string): void => {
  within(plan, "plan", where);
  within(plan.layout, "layout", `${where}.layout`);
  if (plan.layout.items) within(plan.layout.items, "items", `${where}.layout.items`);
  plan.layout.bays.forEach((b) => within(b, "bay", where));
  plan.layout.analyzers.forEach((a) => within(a, "layoutAnalyzer", where));
  plan.units.forEach((u) => within(u, "unit", where));
  plan.analyzers.forEach((a) => within(a, "analyzer", where));
  plan.staff.forEach((s) => within(s, "staff", where));
  plan.samples.forEach((s) => { within(s, "sample", where); s.visits.forEach((v) => within(v, "visit", where)); });
  plan.marks.forEach((m) => within(m, "mark", where));
  plan.windows.forEach((w) => within(w, "window", where));
  plan.calibrations.forEach((c) => within(c, "calibration", where));
  plan.records.forEach((r) => { within(r, "record", where); r.cards.forEach((c) => { within(c, "card", where); c.slots.forEach((s) => within(s, "slot", where)); c.findings.forEach((f) => within(f, "finding", where)); }); (r.holds ?? []).forEach((h) => within(h, "hold", where)); });
  (plan.lots ?? []).forEach((l) => { within(l, "lot", where); l.uses.forEach((u) => within(u, "use", where)); });
  (plan.equipment ?? []).forEach((q) => { within(q, "equipment", where); q.uses.forEach((u) => within(u, "use", where)); });
  (plan.confirms ?? []).forEach((c) => within(c, "confirm", where));
};
const keysDeep = (v: unknown): string[] => (Array.isArray(v) ? v.flatMap(keysDeep) : typeof v === "object" && v !== null ? Object.entries(v).flatMap(([k, x]) => [k, ...keysDeep(x)]) : []);
const stringsDeep = (v: unknown): string[] => (Array.isArray(v) ? v.flatMap(stringsDeep) : typeof v === "object" && v !== null ? Object.values(v).flatMap(stringsDeep) : typeof v === "string" ? [v] : []);
/** The shapes of the places a string leaf equals `value`: the keys on the way, every array index as `[]`. */
const pathsOf = (v: unknown, value: string, path = ""): string[] =>
  Array.isArray(v) ? v.flatMap((x) => pathsOf(x, value, `${path}[]`))
  : typeof v === "object" && v !== null ? Object.entries(v).flatMap(([k, x]) => pathsOf(x, value, `${path}.${k}`))
  : v === value ? [path] : [];

// the hidden facts of each case (typed from its scenario file) and a clean item of the same kind, which the contaminated one has to look like
const HIDDEN: { id: string; origin: string; clean: string }[] = [
  { id: "sc12_medium_lot", origin: "ML-3", clean: "ML-1" },
  { id: "sc12_seed_lot", origin: "SL-A", clean: "SL-B" },
  { id: "sc12_sampling", origin: "U01-D02-1", clean: "U02-D02-1" },
  { id: "sc12_equipment", origin: "TL-1", clean: "TL-2" },
  { id: "sc12_mycoplasma", origin: "ML-3", clean: "ML-1" },
];

describe.each(HIDDEN)("The truth boundary of $id: every plant_ready, plant_halls and plant_record_view", ({ id, origin, clean }) => {
  let messages: Response[];
  let planMessages: (Ready | Halls)[];
  beforeAll(async () => {
    const { posted, ask, plant } = setup();
    await plant(91, 1, caseSpec(id));
    const ready = readyOf(posted, 1);
    for (const hall of ARCH) {
      const card = (assembled(posted, 1).plan.records.find((r) => r.architecture === hall) as ScenePlan["records"][number]).cards[3];
      await ask({ type: "plant_record", id: 92, epoch: 1, architecture: hall, sample_id: ready.plan.samples[card?.sample as number]?.id });
    }
    messages = posted;
    planMessages = posted.filter((m): m is Ready | Halls => m.type === "plant_ready" || m.type === "plant_halls");
  }, 240_000);

  it("Given the five messages of the run Then the plan has the keys of the allow-list and nothing else, at every level, and the halls carry only records and digests", () => {
    expect(planMessages.map((m) => m.type)).toEqual(["plant_ready", "plant_halls", "plant_halls", "plant_halls", "plant_halls"]);
    for (const m of planMessages) {
      if (m.type === "plant_ready") {
        checkPlan(m.plan, "plan");
        expect(Object.keys(m.plan).sort()).toEqual([...(SHAPE.plan as string[])].sort()); // a case has all fifteen keys
      } else {
        expect(Object.keys(m).sort()).toEqual(["cells", "epoch", "id", "records", "type"]);
        m.records.forEach((r) => within(r, "record", "halls"));
      }
    }
  });

  it("Given every message Then no key of HIDDEN_FIELDS appears at any depth, no truth-only type appears as a value, and no key names a verdict, an onset, an origin, an affected set or an answer; the plan and the halls hold no value either", () => {
    const hidden = new Set([...Object.values(HIDDEN_FIELDS).flat(), "verdict", "onset", "origin", "contaminated", "contaminated_at", "affected", "materialised", "answer", "pv", "origin_id"]);
    for (const m of messages) {
      expect(keysDeep(m).filter((k) => hidden.has(k)), m.type).toEqual([]);
      for (const text of stringsDeep(m)) expect((TRUTH_ONLY_TYPES as readonly string[]).includes(text), text).toBe(false);
    }
    // the rows of a card are the one answer that holds a value (the record's own, through plant_record); the plan and the halls hold none
    for (const m of planMessages) expect(keysDeep(m).filter((k) => k === "value"), m.type).toEqual([]);
    expect(keysDeep(planMessages[0]).length).toBeGreaterThan(100); // the walk saw the plan
  });

  it("Given the text of every plant_ready and plant_halls Then it never speaks of contamination, an onset, an origin, an affected unit, a true value, a noise term, a spread or the injector", () => {
    for (const m of planMessages) expect(JSON.stringify(m), m.type).not.toMatch(/contaminat|onset|origin|affected|true_state|true_value|noise|spread|injector|verdict|materialis/i);
  });

  it("Given the item that is the origin of the event Then the plan names it in the places it names a clean item of the same kind and in no other, with the same keys", () => {
    const ready = planMessages[0] as Ready;
    const where = pathsOf(ready.plan, origin);
    expect(where.length).toBeGreaterThan(0);
    expect([...new Set(where)].sort()).toEqual([...new Set(pathsOf(ready.plan, clean))].sort());
    for (const m of messages) if (m.type === "plant_halls" || m.type === "plant_record_view") expect(pathsOf(m, origin), m.type).toEqual([]);
    if (ready.plan.lots?.length) expect(new Set(ready.plan.lots.map((l) => Object.keys(l).sort().join())).size).toBe(1);
  });

  it("Given the confirming results Then they carry the outcome the lab reported and no field about the unit's truth, and the record views carry no verdict", () => {
    const ready = planMessages[0] as Ready;
    expect(ready.plan.confirms?.length).toBeGreaterThan(0);
    for (const c of ready.plan.confirms ?? []) expect(["detected", "not_detected"]).toContain(c.outcome);
    for (const m of messages) if (m.type === "plant_record_view") expect(keysDeep(m)).not.toContain("verdict");
  });
});

describe("A plan that is not a case", () => {
  it("Given a plant run of the default scenario Then the plan has none of the three keys of a case and no items in its layout, and no hall has holds", async () => {
    const { posted, plant } = setup();
    await plant(95, 1, { run: { schema_version: "1", scenario: "default", settings: SMALL, architectures: ["a_manual", "c_context"], seeds: [1] }, seed: 1, actions: [] });
    const { plan } = assembled(posted, 1);
    for (const key of ["lots", "equipment", "confirms"]) expect(plan, key).not.toHaveProperty(key);
    expect(plan.layout).not.toHaveProperty("items");
    expect(plan.records.some((r) => "holds" in r)).toBe(false);
    expect(plan.samples.every((s) => s.kind === "routine")).toBe(true);
  }, 120_000);
});
