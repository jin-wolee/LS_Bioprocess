import { describe, expect, it } from "vitest";
import { ENGINE_VERSION } from "../../src/trace.ts";
import type { Response } from "../../../src/protocol.ts";
import { createWorker } from "../../../src/worker/worker.ts";
import type { WorkerEnv } from "../../../src/worker/worker.ts";
import { labData } from "../support/lab_data.ts";

// docs/design/lab_ui.md section 4: the `run` request in full. Architectures and seeds, run seed by seed with `progress` and a between-seeds `cancel`, `buildReport` once; the profile lists
// and the capture path; engine load errors as `engine_error` verbatim. The Worker is driven through createWorker with a recording `post`; worker.test.ts holds start-up, the Home form and
// invalid_spec. The runs here use the small size of the default scenario (6 reactors, 8 days) so that a seed takes a fraction of a second.

const data = labData();
const SMALL = { reactor_count: 6, bay_size: 6, cohort_size: 6, horizon_days: 8, production_days: 6 };
const full = (over: Record<string, unknown> = {}) => ({ schema_version: "1", scenario: "default", settings: SMALL, architectures: ["a_manual", "c_context"], seeds: [1009, 1103], ...over });
const home = { schema_version: "1", scenario: "default", settings: {}, architectures: [], seeds: [1] };

const setup = (over: Partial<WorkerEnv> = {}) => {
  const posted: Response[] = [];
  const worker = createWorker((r) => posted.push(structuredClone(r)), { data, now: () => performance.now(), fetchReference: async () => undefined, ...over });
  return { posted, worker };
};
const last = (posted: Response[]): Response => posted[posted.length - 1] as Response;

describe("the full run: progress after each seed, then one result", () => {
  it("Given two seeds and two architectures When the page asks for a run Then progress follows each seed and then one result carries the report, the utilisation and the footer", async () => {
    const { posted, worker } = setup();
    await worker.start();
    const before = posted.length;
    await worker.onMessage({ type: "run", id: 31, spec: full() });
    const mine = posted.slice(before);
    expect(mine.map((m) => m.type)).toEqual(["progress", "progress", "result"]);
    expect(mine[0]).toEqual({ type: "progress", id: 31, done: 1, total: 2 });
    expect(mine[1]).toEqual({ type: "progress", id: 31, done: 2, total: 2 });
    const result = mine[2];
    if (result?.type !== "result" || !result.report) throw new Error("a result with a report is expected");
    expect(Object.keys(result).sort()).toEqual(["footer", "id", "report", "type", "utilisation"]);
    expect(result.report.architectures.map((a) => a.id)).toEqual(["a_manual", "c_context"]);
    expect(result.report.seeds).toEqual([1009, 1103]);
    expect(result.utilisation?.by_profile.map((p) => p.profile)).toEqual(["allinone_atline"]);
    expect(result.footer).toMatchObject({ kind: "simulation_result", scenario: "default", seeds: [1009, 1103], architectures: ["a_manual", "c_context"], engine_version: ENGINE_VERSION, check: "error" });
    expect(result.footer.inputs.slice(0, 4).map((i) => i.ref)).toEqual(["A097", "A098", "A046", "A103"]);
  }, 120_000);

  it("Given the lists and the capture path in the spec Then the footer repeats them (the printed inputs of the result)", async () => {
    const { posted, worker } = setup();
    await worker.start();
    const spec = full({ settings: { ...SMALL, bay_size: 3 }, bay_profiles: ["bench_manual", "pilot"], analyzer_profiles: ["allinone_atline", "hplc"], capture_path: "manual_transcription", architectures: ["a_manual"], seeds: [1009] });
    await worker.onMessage({ type: "run", id: 32, spec });
    expect(last(posted)).toMatchObject({ type: "result", id: 32, footer: { bay_profiles: ["bench_manual", "pilot"], analyzer_profiles: ["allinone_atline", "hplc"], capture_path: "manual_transcription" } });
  }, 120_000);

  it("Given a result of a full run Then it is plain data and holds no truth key (rule 1), and the report with its rows is small", async () => {
    const { posted, worker } = setup();
    await worker.start();
    await worker.onMessage({ type: "run", id: 41, spec: full({ seeds: [1009] }) });
    const result = last(posted);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    const keys = JSON.stringify(result).match(/"([A-Za-z_]+)":/g)?.map((k) => k.slice(1, -2)) ?? [];
    for (const forbidden of ["key_text", "answer_key", "raw_key", "true_value", "noise", "true_state", "sensors", "observable"]) expect(keys, forbidden).not.toContain(forbidden);
    expect(JSON.stringify(result).length).toBeLessThan(200_000);
  }, 120_000);
});

describe("cancel: read between seeds", () => {
  it("Given a run that is cancelled after its first seed Then the answer is cancelled after that one progress, and no result follows", async () => {
    const posted: Response[] = [];
    const ref: { worker?: ReturnType<typeof createWorker> } = {};
    ref.worker = createWorker(
      (r) => {
        posted.push(structuredClone(r));
        // the page's cancel arrives while the Worker yields between two seeds
        if (r.type === "progress" && r.done === 1) void ref.worker?.onMessage({ type: "cancel", id: 33 });
      },
      { data, now: () => performance.now(), fetchReference: async () => undefined },
    );
    await ref.worker.start();
    const before = posted.length;
    await ref.worker.onMessage({ type: "run", id: 33, spec: full({ architectures: ["a_manual"], seeds: [1009, 1103, 1259] }) });
    const mine = posted.slice(before);
    expect(mine.map((m) => m.type)).toEqual(["progress", "error"]);
    expect(mine[1]).toEqual({ type: "error", id: 33, code: "cancelled", message: "the run was cancelled after 1 of 3 seeds" });
  }, 120_000);

  it("Given a cancel for a run that is not queued or running Then nothing is posted and nothing breaks", async () => {
    const { posted, worker } = setup();
    await worker.start();
    const before = posted.length;
    await worker.onMessage({ type: "cancel", id: 999 });
    expect(posted.length).toBe(before);
    await worker.onMessage({ type: "run", id: 34, spec: full({ architectures: ["a_manual"], seeds: [1009] }) });
    expect(last(posted)).toMatchObject({ type: "result", id: 34 });
  }, 120_000);

  it("Given two runs asked for at once Then they are answered one after the other in the order asked, and a cancel of the queued one stops it before any seed", async () => {
    const { posted, worker } = setup();
    await worker.start();
    const before = posted.length;
    const first = worker.onMessage({ type: "run", id: 35, spec: full({ architectures: ["a_manual"], seeds: [1009] }) });
    const second = worker.onMessage({ type: "run", id: 36, spec: full({ architectures: ["a_manual"], seeds: [1009] }) });
    void worker.onMessage({ type: "cancel", id: 36 });
    await Promise.all([first, second]);
    expect(posted.slice(before).map((m) => (m.type === "progress" || m.type === "result" || m.type === "error" ? `${m.type}:${m.id}` : m.type))).toEqual(["progress:35", "result:35", "error:36"]);
    expect(last(posted)).toMatchObject({ code: "cancelled", message: "the run was cancelled before it started" });
  }, 120_000);
});

describe("errors of the full run", () => {
  it("Given a bay list of the wrong length Then the answer is engine_error with the engine message verbatim, nothing ran, and the Worker keeps answering", async () => {
    const { posted, worker } = setup();
    await worker.start();
    const before = posted.length;
    await worker.onMessage({ type: "run", id: 37, spec: full({ settings: { ...SMALL, bay_size: 3 }, bay_profiles: ["bench_manual"] }) });
    expect(posted.slice(before)).toEqual([
      {
        type: "error",
        id: 37,
        code: "engine_error",
        message: "scenario default: bay_profiles names 1 bioreactor profile but the scenario has 2 bays (reactor_count 6 in bays of 3); name one bioreactor profile per bay, bay 1 first (spec section 4.5)",
      },
    ]);
    await worker.onMessage({ type: "run", id: 38, spec: home });
    expect(last(posted)).toMatchObject({ type: "result", id: 38 });
  }, 120_000);

  it("Given an invalid spec with architectures Then it is refused at once with invalid_spec and no progress is posted", async () => {
    const { posted, worker } = setup();
    await worker.start();
    const before = posted.length;
    await worker.onMessage({ type: "run", id: 39, spec: full({ seeds: [20260101, 1] }) });
    expect(posted.slice(before)).toEqual([{ type: "error", id: 39, code: "invalid_spec", message: expect.stringMatching(/date-shaped/) }]);
  });
});
