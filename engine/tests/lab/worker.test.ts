import { beforeAll, describe, expect, it } from "vitest";
import { computeReference, makeDeps } from "../../src/experiments/assembly/lab/check.ts";
import type { Reference } from "../../src/experiments/assembly/lab/check.ts";
import { ENGINE_VERSION } from "../../src/trace.ts";
import type { Response } from "../../../src/protocol.ts";
import { createWorker } from "../../../src/worker/worker.ts";
import type { WorkerEnv } from "../../../src/worker/worker.ts";
import { labData } from "../support/lab_data.ts";
import { readJson } from "../support/paths.ts";

// docs/design/lab_ui.md section 4: the Worker protocol. Start-up (`ready`, then the browser check), the `run` request in its Home form, `invalid_spec`, and the rules 1 and 4:
// the page can ask for nothing but a RunSpec (no truth log, event stream, answer key or raw quirk key leaves the Worker), and an engine exception arrives with its English message.
// The Worker is driven through createWorker with a recording `post`; the real Worker entry is the same function behind postMessage (the end-to-end check `load` runs it).

const data = labData();
const NODE = { version: "v0.0.0", flags: ["--no-maglev-escape-analysis"] };
const FLAGS = ["system_issued_id", "two_clocks", "available_at", "instrument_state_snapshot", "append_only_versions", "write_time_keys", "ingest_idempotency", "audit_trail"];
const home = { schema_version: "1", scenario: "default", settings: {}, architectures: [], seeds: [1] };

let reference: Reference;
beforeAll(async () => {
  reference = await computeReference(makeDeps(data, () => performance.now()), NODE);
}, 60_000);

// The default env has no usable reference, so the check ends at once in the state error and the tests that are not about the check stay fast; real() runs the check against the real reference.
const setup = (over: Partial<WorkerEnv> = {}) => {
  const posted: Response[] = [];
  const worker = createWorker((r) => posted.push(structuredClone(r)), { data, now: () => performance.now(), fetchReference: async () => undefined, ...over });
  return { posted, worker };
};
const real = (): Partial<WorkerEnv> => ({ fetchReference: async () => reference });
const send = (worker: ReturnType<typeof createWorker>, message: unknown): void => {
  void worker.onMessage(message);
};
const last = (posted: Response[]): Response => posted[posted.length - 1] as Response;

describe("start-up", () => {
  it("Given a started Worker Then it posts ready first, then the check as pending, then the outcome of the check", async () => {
    const { posted, worker } = setup(real());
    await worker.start();
    expect(posted.map((m) => (m.type === "check" ? `check:${m.state}` : m.type))).toEqual(["ready", "check:pending", "check:identical"]);
  }, 60_000);

  it("Given the ready message Then it carries the engine version, schema version 1, the flags of the engine (the page never types how many) and the bundled scenario with its inputs", async () => {
    const { posted, worker } = setup();
    await worker.start();
    const ready = posted[0];
    if (ready?.type !== "ready") throw new Error("the first message must be ready");
    expect(ready.engine_version).toBe(ENGINE_VERSION);
    expect(ready.schema_version).toBe("1");
    expect(ready.flags).toEqual(FLAGS);
    expect(ready.scenarios.map((s) => s.id)).toEqual(["default", "sc02_shift_burst", "sc03_feed_in_gap", "sc05_one_analyzer_down"]);
    expect(ready.scenarios[0]?.settings[0]).toEqual({ name: "reactor_count", value: 24, unit: "reactors", ref: "A001" });
  });

  it("Given the ready message Then it is the full payload of the design: minimum seeds, seed list, presets with the ablations of C, evaluation inputs, profile catalogue, no challenge variant", async () => {
    const { posted, worker } = setup();
    await worker.start();
    const ready = posted[0];
    if (ready?.type !== "ready") throw new Error("the first message must be ready");
    expect(ready.min_seeds).toBe(20);
    expect(ready.seed_list).toHaveLength(30);
    expect(ready.presets).toHaveLength(3 + FLAGS.length);
    expect(ready.evaluation.map((e) => e.ref)).toEqual(["A097", "A098", "A046", "A103"]);
    expect(ready.profiles).toHaveLength(8);
    expect(ready.challenge_variants).toEqual([]);
  });

  it("Given the real reference Then the check detail holds three equal truth hashes, equal repeats and cells, and five timed runs", async () => {
    const { posted, worker } = setup(real());
    await worker.start();
    const done = last(posted);
    if (done.type !== "check") throw new Error("the last message must be the check");
    expect(done.detail.truth).toEqual([{ seed: 1, equal: true }, { seed: 2, equal: true }, { seed: 3, equal: true }]);
    expect(done.detail).toMatchObject({ repeats_equal: true, cells_equal: true });
    expect(done.detail.runs_ms).toHaveLength(5);
    expect(done.detail.runs_ms.every((ms) => ms > 0)).toBe(true);
  }, 60_000);

  it("Given a reference with one hash digit changed Then the check is failed and names the seed that differs (the Worker compares with the reference it was given)", async () => {
    const altered = structuredClone(reference);
    const row = altered.truth[1];
    if (!row) throw new Error("the reference has seed 2");
    row.log_hash = (row.log_hash.startsWith("a") ? "b" : "a") + row.log_hash.slice(1);
    const { posted, worker } = setup({ fetchReference: async () => altered });
    await worker.start();
    const done = last(posted);
    expect(done).toMatchObject({ type: "check", state: "failed", detail: { repeats_equal: true, cells_equal: true } });
    expect(done.type === "check" && done.detail.truth.map((t) => t.equal)).toEqual([true, false, true]);
  }, 60_000);

  it("Given a reference that cannot be fetched Then the check is error with the reason, and the Worker still answers runs", async () => {
    const { posted, worker } = setup({ fetchReference: async () => Promise.reject(new Error("HTTP 404")) });
    await worker.start();
    expect(last(posted)).toMatchObject({ type: "check", state: "error", detail: { reason: expect.stringMatching(/reference\.json could not be loaded.*HTTP 404/) } });
    send(worker, { type: "run", id: 1, spec: home });
    expect(last(posted)).toMatchObject({ type: "result", id: 1 });
  });
});

describe("the `run` request in its Home form", () => {
  it.each([1, 2, 3])("Given seed %i When the page asks for a run Then the result carries the summary of the golden", async (seed) => {
    const golden = readJson<{ event_count: number; event_counts: Record<string, number> }>("tests", "golden", `default_seed${seed}.summary.json`);
    const { posted, worker } = setup();
    await worker.start();
    send(worker, { type: "run", id: 40 + seed, spec: { ...home, seeds: [seed] } });
    expect(last(posted)).toMatchObject({ type: "result", id: 40 + seed, summary: { events: golden.event_count, event_counts: golden.event_counts } });
  });

  it("Given a checked Worker When the page asks for a run Then the footer labels it a simulation result with the scenario, seeds, engine version, no architectures and the check state", async () => {
    const { posted, worker } = setup(real());
    await worker.start();
    send(worker, { type: "run", id: 7, spec: home });
    expect(last(posted)).toMatchObject({
      type: "result",
      id: 7,
      footer: { kind: "simulation_result", scenario: "default", seeds: [1], engine_version: ENGINE_VERSION, architectures: [], inputs: [], check: "identical" },
    });
  }, 60_000);

  it("Given a run asked for before the check has finished Then the footer says pending (the page re-labels it when the check message arrives)", async () => {
    const { posted, worker } = setup(real());
    const starting = worker.start();
    send(worker, { type: "run", id: 5, spec: home });
    await starting;
    const result = posted.find((m) => m.type === "result");
    expect(result).toMatchObject({ id: 5, footer: { check: "pending" } });
  }, 60_000);
});

describe("invalid_spec", () => {
  it.each([
    ["a scenario that is not bundled", { ...home, scenario: "sc08_ph_restandardisation" }, /unknown scenario/],
    ["a setting the scenario lacks", { ...home, settings: { nope: 1 } }, /unknown setting "nope"/],
    ["a seed that is date-shaped", { ...home, seeds: [20260101] }, /date-shaped/],
    ["an architecture that does not exist", { ...home, architectures: ["z"] }, /unknown architecture/],
    ["a key outside the spec (a way to ask for the truth log)", { ...home, events: true }, /unknown key "events"/],
    ["two seeds and no architecture (nothing is recorded)", { ...home, seeds: [1, 2] }, /exactly one seed/],
    ["a profile that is not bundled in the bay list", { ...home, bay_profiles: ["no_such"] }, /bay_profiles\[0\] names "no_such"/],
    ["an analyzer profile in the bay list", { ...home, bay_profiles: ["hplc"] }, /not a bundled bioreactor profile/],
    ["a capture path that does not exist", { ...home, capture_path: "fax" }, /capture_path must be one of/],
    ["no spec at all", undefined, /spec must be an object/],
  ])("Given %s When the run is asked for Then the answer is invalid_spec with the request id and nothing ran", async (_name, spec, text) => {
    const { posted, worker } = setup();
    await worker.start();
    const before = posted.length;
    send(worker, { type: "run", id: 9, spec });
    expect(posted.length).toBe(before + 1);
    expect(last(posted)).toEqual({ type: "error", id: 9, code: "invalid_spec", message: expect.stringMatching(text) });
  });
});

describe("the request envelope", () => {
  it.each([
    ["a string", "run"],
    ["null", null],
    ["a list", []],
    ["an object without a type", { id: 1, spec: home }],
    ["a request type this build does not know", { type: "lineage", id: 2, spec: home }],
    ["a cancel without a numeric id", { type: "cancel", id: "3" }],
  ])("Given %s Then the answer is invalid_spec", async (_name, message) => {
    const { posted, worker } = setup();
    await worker.start();
    send(worker, message);
    expect(last(posted)).toMatchObject({ type: "error", code: "invalid_spec" });
  });

  it("Given a request whose id is not a number Then the error carries id null; given a numeric id it carries that id", async () => {
    const { posted, worker } = setup();
    await worker.start();
    send(worker, { type: "run", id: "x", spec: home });
    expect(last(posted)).toMatchObject({ type: "error", id: null, code: "invalid_spec" });
    send(worker, { type: "bogus", id: 12 });
    expect(last(posted)).toMatchObject({ type: "error", id: 12, code: "invalid_spec" });
  });
});

describe("rule 4: engine exceptions arrive as error with the English message of the engine", () => {
  it("Given a setting value the scenario itself rejects Then the answer is engine_error, the message is the engine message, and the Worker keeps answering", async () => {
    const { posted, worker } = setup();
    await worker.start();
    send(worker, { type: "run", id: 21, spec: { ...home, settings: { cohort_size: 0 } } });
    expect(last(posted)).toEqual({ type: "error", id: 21, code: "engine_error", message: "the cohort size must be positive" });
    send(worker, { type: "run", id: 22, spec: home });
    expect(last(posted)).toMatchObject({ type: "result", id: 22 });
  });
});

describe("rule 1: there is no way to ask for the truth", () => {
  // `truth` is a key of the check detail by design (seed and equal only), so it is checked apart
  const FORBIDDEN = ["events", "log", "key_text", "sensors", "observable", "samples", "answer_key", "raw_key", "true_value", "noise", "true_state"];

  /** Every key of a message with its value. */
  const entriesOf = (value: unknown, found: [string, unknown][] = []): [string, unknown][] => {
    if (Array.isArray(value)) value.forEach((v) => entriesOf(v, found));
    else if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) {
        found.push([k, v]);
        entriesOf(v, found);
      }
    }
    return found;
  };

  it("Given every message the Worker posts for a start and a run Then it is plain data (a JSON round trip changes nothing) and no key names a truth structure", async () => {
    const { posted, worker } = setup(real());
    await worker.start();
    send(worker, { type: "run", id: 1, spec: home });
    for (const message of posted) {
      expect(JSON.parse(JSON.stringify(message))).toEqual(message);
      const entries = entriesOf(message);
      // the summary has a count named `events`; a key of that name may hold a number, never a list or an object
      for (const [key, value] of entries) if (FORBIDDEN.includes(key)) expect(typeof value, `${message.type}: ${key}`).toBe("number");
      if (message.type === "check") for (const row of message.detail.truth) expect(Object.keys(row).sort()).toEqual(["equal", "seed"]);
      else expect(entries.some(([key]) => key === "truth"), `${message.type} carries a key truth`).toBe(false);
    }
  }, 60_000);

  it("Given the result of a run Then it holds counts and a footer only, never the event list", async () => {
    const { posted, worker } = setup();
    await worker.start();
    send(worker, { type: "run", id: 1, spec: home });
    const result = last(posted);
    if (result.type !== "result") throw new Error("a result is expected");
    expect(Object.keys(result).sort()).toEqual(["footer", "id", "summary", "type"]);
    expect(Object.keys(result.summary ?? {}).sort()).toEqual(["event_counts", "events"]);
    // 7,211 events would be megabytes; counts by type and a footer are a few hundred bytes
    expect(JSON.stringify(result).length).toBeLessThan(2000);
  });
});
