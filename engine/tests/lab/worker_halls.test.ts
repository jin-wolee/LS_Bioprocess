import { beforeAll, describe, expect, it } from "vitest";
import type { Response, ScenePlan } from "../../../src/protocol.ts";
import { createWorker } from "../../../src/worker/worker.ts";
import type { WorkerEnv } from "../../../src/worker/worker.ts";
import { runPlant } from "../../src/experiments/assembly/lab/plant.ts";
import type { PlantSpec } from "../../src/experiments/assembly/lab/plant.ts";
import { canonicalJson } from "../../src/trace.ts";
import { labData } from "../support/lab_data.ts";

// P5a (docs/design/plant_ui.md sections 5.5 and 6): the progressive halls and the record request of the Worker, on the whole default scenario (seed 1, 24 reactors, 21 days; A, B and C).
// `plant_ready` comes once the truth run and the record of the first architecture of the spec are built; the other architectures follow, one `plant_halls` each, in the order of the spec; a newer
// epoch cancels the halls still pending; `plant_record` answers from the run the Worker keeps. The proof is equality with `runPlant`, which builds every architecture in one call: the plan
// assembled from the messages is byte-equal (canonical JSON) to the plan of one build, and the hashes are the same.

const HALLS = ["a_manual", "b_lims_lite", "c_context"];
const run = { schema_version: "1", scenario: "default", settings: {}, architectures: HALLS, seeds: [1] };
const spec = (architectures = HALLS, actions: unknown[] = []) => ({ run: { ...run, architectures }, seed: 1, actions });

const data = labData();
const setup = (onPost: (m: Response, worker: ReturnType<typeof createWorker>) => void = () => undefined) => {
  const posted: Response[] = [];
  const env: WorkerEnv = { data, now: () => performance.now(), fetchReference: async () => undefined };
  const worker: ReturnType<typeof createWorker> = createWorker((m) => {
    posted.push(structuredClone(m));
    onPost(m, worker);
  }, env);
  const plant = (id: number, epoch: number, s: unknown = spec()) => worker.onMessage({ type: "plant_run", id, epoch, spec: s });
  return { posted, worker, plant };
};
type Ready = Extract<Response, { type: "plant_ready" }>;
type Halls = Extract<Response, { type: "plant_halls" }>;
const readyOf = (posted: Response[], epoch: number): Ready => {
  const m = posted.find((p) => p.type === "plant_ready" && p.epoch === epoch);
  if (m?.type !== "plant_ready") throw new Error(`no plant_ready of epoch ${epoch}`);
  return m;
};
const hallsOf = (posted: Response[], epoch: number): Halls[] => posted.filter((p): p is Halls => p.type === "plant_halls" && p.epoch === epoch);
/** The plan and the cell digests the page assembles from the messages of one epoch: the first hall in `plant_ready`, the others merged in the order they arrive. */
const assembled = (posted: Response[], epoch: number) => {
  const ready = readyOf(posted, epoch);
  const halls = hallsOf(posted, epoch);
  const plan: ScenePlan = { ...ready.plan, records: [...ready.plan.records, ...halls.flatMap((h) => h.records)] };
  return { plan, truth: ready.hashes.truth, cells: Object.assign({}, ready.hashes.cells, ...halls.map((h) => h.cells)) as Record<string, string> };
};

let once: Awaited<ReturnType<typeof runPlant>>;
beforeAll(async () => {
  once = await runPlant(data, spec() as unknown as PlantSpec);
}, 120_000);

describe("plant_run: the first hall with plant_ready, the others after it", () => {
  it("Given A, B and C Then plant_ready holds the plan with the hall of A only and the digest of A; plant_halls follow for B and then C, one hall and one digest each, with the id and the epoch of the request", async () => {
    const { posted, plant } = setup();
    await plant(11, 4);
    const kinds = posted.filter((m) => m.type === "plant_ready" || m.type === "plant_halls").map((m) => m.type);
    expect(kinds).toEqual(["plant_ready", "plant_halls", "plant_halls"]);
    const ready = readyOf(posted, 4);
    expect(ready.plan.records.map((r) => r.architecture)).toEqual(["a_manual"]);
    expect(ready.plan.layout.architectures).toEqual(HALLS); // the floor has all three halls from the first answer
    expect(Object.keys(ready.hashes.cells)).toEqual(["a_manual"]);
    const halls = hallsOf(posted, 4);
    expect(halls.map((h) => [h.id, h.epoch, h.records.map((r) => r.architecture), Object.keys(h.cells)])).toEqual([
      [11, 4, ["b_lims_lite"], ["b_lims_lite"]],
      [11, 4, ["c_context"], ["c_context"]],
    ]);
    expect(Object.keys(halls[0] as Halls).sort()).toEqual(["cells", "epoch", "id", "records", "type"]);
  }, 120_000);

  it("Given the order of the spec Then the first hall is the first architecture named, whichever it is", async () => {
    const { posted, plant } = setup();
    await plant(12, 1, spec(["c_context", "a_manual"]));
    expect(readyOf(posted, 1).plan.records.map((r) => r.architecture)).toEqual(["c_context"]);
    expect(hallsOf(posted, 1).map((h) => h.records[0]?.architecture)).toEqual(["a_manual"]);
  }, 120_000);

  it("Given one architecture only Then there is no plant_halls", async () => {
    const { posted, plant } = setup();
    await plant(13, 1, spec(["b_lims_lite"]));
    expect(readyOf(posted, 1).plan.records.map((r) => r.architecture)).toEqual(["b_lims_lite"]);
    expect(hallsOf(posted, 1)).toEqual([]);
  }, 120_000);

  it("Given the messages of the default scenario Then the plan assembled from plant_ready and its plant_halls is byte-equal (canonical JSON) to the plan of one build, and the truth hash and the three cell digests are equal", async () => {
    if (!once.ok) throw new Error("the one-build reference was refused");
    const { posted, plant } = setup();
    await plant(14, 1);
    const got = assembled(posted, 1);
    expect(canonicalJson(got.plan)).toBe(canonicalJson(once.answer.plan));
    expect(got.truth).toBe(once.answer.hashes.truth);
    expect(got.cells).toEqual(once.answer.hashes.cells);
    expect(Object.keys(got.cells)).toEqual(HALLS);
  }, 120_000);

  it("Given the spec in another order and with a feed Then the assembled plan is again byte-equal to the plan of one build of that spec", async () => {
    const s = spec(["c_context", "b_lims_lite", "a_manual"], [{ kind: "add_feed", at: 302400, unit_id: "U01" }]);
    const reference = await runPlant(data, s as unknown as PlantSpec);
    if (!reference.ok) throw new Error("the one-build reference was refused");
    const { posted, plant } = setup();
    await plant(15, 1, s);
    const got = assembled(posted, 1);
    expect(canonicalJson(got.plan)).toBe(canonicalJson(reference.answer.plan));
    expect(got.cells).toEqual(reference.answer.hashes.cells);
    expect(got.truth).toBe(reference.answer.hashes.truth);
  }, 120_000);
});

describe("plant_run: a newer epoch cancels the halls still pending", () => {
  it("Given a newer plant_run that arrives the moment plant_ready of the first is posted Then no plant_halls of the first epoch follows; the second epoch is answered in full and nothing is reported cancelled", async () => {
    let second: Promise<void> | void = undefined;
    const { posted, plant } = setup((m, worker) => {
      if (m.type === "plant_ready" && m.epoch === 1) second = worker.onMessage({ type: "plant_run", id: 22, epoch: 2, spec: spec() });
    });
    await plant(21, 1);
    await second;
    expect(hallsOf(posted, 1)).toEqual([]);
    expect(hallsOf(posted, 2).map((h) => h.records[0]?.architecture)).toEqual(["b_lims_lite", "c_context"]);
    expect(posted.filter((m) => m.type === "error")).toEqual([]); // the halls that are dropped are not errors: the plan of the first epoch was answered
    expect(posted.filter((m) => m.type === "plant_ready").map((m) => (m as Ready).epoch)).toEqual([1, 2]);
  }, 240_000);

  it("Given a newer plant_run that arrives after the first hall after plant_ready Then the last hall of the first epoch is never posted", async () => {
    let second: Promise<void> | void = undefined;
    const { posted, plant } = setup((m, worker) => {
      if (m.type === "plant_halls" && m.epoch === 1) second = worker.onMessage({ type: "plant_run", id: 32, epoch: 2, spec: spec(["a_manual"]) });
    });
    await plant(31, 1);
    await second;
    expect(hallsOf(posted, 1).map((h) => h.records[0]?.architecture)).toEqual(["b_lims_lite"]);
    expect(hallsOf(posted, 2)).toEqual([]);
    expect(readyOf(posted, 2).plan.records.map((r) => r.architecture)).toEqual(["a_manual"]);
  }, 240_000);
});

describe("plant_record: the rows of one card from the run the Worker keeps", () => {
  const ask = async (extra: Record<string, unknown>, before?: (worker: ReturnType<typeof createWorker>) => Promise<void> | void) => {
    const { posted, worker, plant } = setup();
    await plant(41, 7);
    await before?.(worker);
    const n = posted.length;
    await worker.onMessage({ type: "plant_record", id: 42, epoch: 7, architecture: "c_context", sample_id: "U07-D06-1", ...extra });
    return posted.slice(n);
  };

  it("Given a card of C Then plant_record_view carries the rows of the lineage view for that sample in C: a sample node, its two runs, its twelve rejected results, the findings, and no process-context node (nothing is offered); no answer and no verdict", async () => {
    const [m, ...rest] = await ask({});
    expect(rest).toEqual([]);
    if (m?.type !== "plant_record_view") throw new Error(`plant_record_view expected, got ${JSON.stringify(m)?.slice(0, 200)}`);
    expect(Object.keys(m).sort()).toEqual(["epoch", "id", "sample", "type"]);
    expect([m.id, m.epoch, m.sample.architecture]).toEqual([42, 7, "c_context"]);
    expect(Object.keys(m.sample).sort()).toEqual(["architecture", "edges", "flags_on", "labelling", "nodes"]);
    const tables = m.sample.nodes.reduce<Record<string, number>>((n, x) => ({ ...n, [x.table]: (n[x.table] ?? 0) + 1 }), {});
    expect(tables).toMatchObject({ sample: 1, analysis_request: 1, run: 2, result: 12, validation_finding: 12 });
    expect(tables.process_context).toBeUndefined();
    expect(m.sample.nodes.find((x) => x.id === "sample:U07-D06-1")?.fields.find((f) => f.name === "unit_id")?.value).toBe("U07");
    expect(JSON.stringify(m)).not.toMatch(/verdict|realised_errors|answers/);
  }, 120_000);

  it("Given a card of A Then the request for A answers with the rows of A: the sample node holds no sampled_at", async () => {
    const [m] = await ask({ architecture: "a_manual", sample_id: "U01-D06-1" });
    if (m?.type !== "plant_record_view") throw new Error("plant_record_view expected");
    expect(m.sample.architecture).toBe("a_manual");
    expect(m.sample.nodes.find((x) => x.table === "sample")?.fields.find((f) => f.name === "sampled_at")?.value).toBeNull();
  }, 120_000);

  it("Given an epoch that is not the one the Worker holds Then the error is cancelled with that epoch (the page drops it), and the Worker goes on", async () => {
    const [m] = await ask({ epoch: 6 });
    expect(m).toMatchObject({ type: "error", id: 42, epoch: 6, code: "cancelled" });
  }, 120_000);

  it("Given no plant run at all Then the record request is cancelled, not answered", async () => {
    const { posted, worker } = setup();
    await worker.onMessage({ type: "plant_record", id: 43, epoch: 1, architecture: "a_manual", sample_id: "U01-D06-1" });
    expect(posted).toMatchObject([{ type: "error", id: 43, epoch: 1, code: "cancelled" }]);
  });

  it.each([
    ["a sample the run does not have", { sample_id: "U99-D99-9" }],
    ["an architecture the run does not have", { architecture: "z_nothing" }],
    ["a sample the hall holds no card for (A holds none of U06-D09-1, absence is not shown)", { architecture: "a_manual", sample_id: "U06-D09-1" }],
  ])("Given %s Then the request is refused as unknown_target with its epoch", async (_, extra) => {
    const [m] = await ask(extra);
    expect(m).toMatchObject({ type: "error", id: 42, epoch: 7, code: "refused", reason: "unknown_target" });
    expect((m as { message: string }).message).toMatch(/hall|card|architecture/);
  }, 120_000);

  it("Given a hall that is not built yet (asked for in the moment plant_ready is posted) Then it is refused as unknown_target, and the same request after the halls arrive is answered", async () => {
    const answers: Response[] = [];
    const { posted, plant } = setup((m, worker) => {
      if (m.type === "plant_ready") void worker.onMessage({ type: "plant_record", id: 44, epoch: 8, architecture: "c_context", sample_id: "U07-D06-1" });
      if (m.type === "error" || m.type === "plant_record_view") answers.push(m);
    });
    await plant(41, 8);
    expect(answers).toMatchObject([{ type: "error", id: 44, epoch: 8, code: "refused", reason: "unknown_target" }]);
    expect(hallsOf(posted, 8)).toHaveLength(2);
  }, 120_000);

  it.each([
    ["no id", { id: undefined }],
    ["no whole epoch", { epoch: 1.5 }],
    ["no architecture", { architecture: 3 }],
    ["no sample id", { sample_id: undefined }],
  ])("Given a request with %s Then invalid_spec", async (_, extra) => {
    const { posted, worker } = setup();
    await worker.onMessage({ type: "plant_record", id: 45, epoch: 1, architecture: "a_manual", sample_id: "U01-D06-1", ...extra });
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ type: "error", code: "invalid_spec" });
  });
});
