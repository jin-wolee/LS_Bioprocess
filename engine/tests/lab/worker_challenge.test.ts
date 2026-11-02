import { describe, expect, it } from "vitest";
import type { Response } from "../../../src/protocol.ts";
import { createWorker } from "../../../src/worker/worker.ts";
import type { WorkerEnv } from "../../../src/worker/worker.ts";
import { labData } from "../support/lab_data.ts";
import { SMALL } from "../support/scenarios.ts";
import { DECISION_SCENARIO, DECISION_SMALL, decisionData } from "./decision_data.ts";

// S3e, the lineage and challenge requests of the Worker protocol (docs/design/lab_ui.md sections 4 and 9). Rule 2: `lineage` is refused with `locked` for a run that is an unrevealed
// challenge. Rule 3: before the guess or the give-up no message carries the planted sample, its detail, the affected decisions or any reveal field. The Worker is driven through createWorker
// with a recording `post`, as worker.test.ts does.

const SAMPLE_SPEC = { schema_version: "1", scenario: "default", settings: SMALL, architectures: [], seeds: [41] };
const DECISION_SPEC = { schema_version: "1", scenario: DECISION_SCENARIO, settings: DECISION_SMALL, architectures: [], seeds: [3] };
// the types of message the page may receive between the start of a challenge and the guess (the allow-list of the end-to-end check `challenge`)
const ALLOWED_BEFORE_GUESS = ["ready", "check", "progress", "result", "error", "challenge_ready", "sample_record", "lineage"];

const setup = (data = labData()) => {
  const posted: Response[] = [];
  const env: WorkerEnv = { data, now: () => performance.now(), fetchReference: async () => undefined };
  const worker = createWorker((r) => posted.push(structuredClone(r)), env);
  const send = async (message: unknown): Promise<Response> => {
    const before = posted.length;
    await worker.onMessage(message);
    const out = posted.slice(before);
    return out[out.length - 1] as Response;
  };
  return { posted, send, worker };
};
const keysDeep = (v: unknown): string[] => (Array.isArray(v) ? v.flatMap(keysDeep) : typeof v === "object" && v !== null ? Object.entries(v).flatMap(([k, x]) => [k, ...keysDeep(x)]) : []);
const errorOf = (r: Response): { code: string; message: string } => (r.type === "error" ? { code: r.code, message: r.message } : { code: r.type, message: "" });

describe("ready", () => {
  it("Given a build without SC8 Then only the sample variant is offered and the decision seed list is empty", async () => {
    const { posted, worker } = setup();
    await worker.start();
    expect(posted[0]).toMatchObject({ type: "ready", challenge_variants: ["sample"], decision_seed_list: [] });
  });

  it("Given a build that bundles SC8 Then both variants are offered and the seed list is the one of experiment 2 (thirty neutral seeds, typed from the file)", async () => {
    const { posted, worker } = setup(decisionData());
    await worker.start();
    const ready = posted[0];
    if (ready?.type !== "ready") throw new Error("ready first");
    expect(ready.challenge_variants).toEqual(["sample", "decision"]);
    expect(ready.decision_seed_list).toHaveLength(30);
    expect(ready.decision_seed_list.slice(0, 3)).toEqual([5113, 5231, 5381]);
    expect(ready.scenarios.map((s) => s.id)).not.toContain(DECISION_SCENARIO); // SC8 is reachable from the challenge only
  });
});

describe("lineage", () => {
  it("Given SC3, seed 1 and the rule Then the Worker answers a lineage message with the view and the samples of the run", async () => {
    const { send } = setup();
    const spec = { schema_version: "1", scenario: "sc03_feed_in_gap", settings: {}, architectures: ["a_manual", "c_context"], seeds: [1] };
    const answer = await send({ type: "lineage", id: 9, spec, seed: 1, pick: { rule: "sc3" } });
    if (answer.type !== "lineage") throw new Error(`expected lineage, got ${JSON.stringify(errorOf(answer))}`);
    expect(answer.id).toBe(9);
    expect(answer.view.sample.sample_id).toBe("U03-D10-2"); // the sample of the fixture
    expect(answer.view.columns.map((c) => c.architecture)).toEqual(["a_manual", "c_context"]);
    expect(answer.sample_ids).toContain("U03-D10-2");
  }, 60_000);

  it("Given a spec the Worker does not know, a bad seed or a bad pick Then invalid_spec with a message", async () => {
    const { send } = setup();
    const ok = { schema_version: "1", scenario: "sc03_feed_in_gap", settings: {}, architectures: ["a_manual"], seeds: [1] };
    expect(errorOf(await send({ type: "lineage", id: 1, spec: { ...ok, scenario: "nope" }, seed: 1, pick: { rule: "sc3" } })).code).toBe("invalid_spec");
    expect(errorOf(await send({ type: "lineage", id: 2, spec: ok, seed: 20260101, pick: { rule: "sc3" } })).code).toBe("invalid_spec"); // date-shaped
    expect(errorOf(await send({ type: "lineage", id: 3, spec: ok, seed: 1, pick: {} })).code).toBe("invalid_spec");
    expect(errorOf(await send({ type: "lineage", id: 4, spec: ok, seed: 1, pick: { sample_id: "U99-D99-9" } })).code).toBe("invalid_spec");
  }, 60_000);
});

describe("The sample challenge", () => {
  it("Given a start Then the Worker answers challenge_ready with the id of the challenge, the announced type, the record and the inputs, and nothing else about the plant", async () => {
    const { posted, send } = setup();
    const ready = await send({ type: "challenge_start", id: 20, variant: "sample", spec: SAMPLE_SPEC, seed: 41, shown: "c_context_minus_system_issued_id" });
    if (ready.type !== "challenge_ready") throw new Error(JSON.stringify(errorOf(ready)));
    expect(ready).toMatchObject({ id: 20, announced_type: "label_error", challenge: expect.stringMatching(/^challenge-/) });
    expect((ready.record as { architecture: string }).architecture).toBe("c_context_minus_system_issued_id");
    expect(ready.inputs.length).toBeGreaterThan(0);
    for (const input of ready.inputs) expect(input.ref).toMatch(/^[AS]\d{3}$/);
    // `key` (audit A1, F7): the key of the truth of the challenge's run, a hash that names the run and says nothing of the plant (lab_ui.md section 4, rule 2)
    expect(Object.keys(ready).sort()).toEqual(["announced_type", "challenge", "id", "inputs", "key", "record", "type"]);
    expect(ready.key).toMatch(/^[0-9a-f]{16}$/);
    expect(posted.every((m) => ALLOWED_BEFORE_GUESS.includes(m.type))).toBe(true);
  }, 60_000);

  it("Given a started challenge Then every message before the guess is of an allowed type and carries no reveal field; after the guess the reveal's planted sample is in none of them outside the record tables", async () => {
    const { posted, send } = setup();
    const ready = await send({ type: "challenge_start", id: 20, variant: "sample", spec: SAMPLE_SPEC, seed: 41, shown: "a_manual" });
    if (ready.type !== "challenge_ready") throw new Error("ready expected");
    const first = (ready.record as { samples: { sample_id: string }[] }).samples[0]?.sample_id as string;
    const opened = await send({ type: "challenge_open", id: 21, challenge: ready.challenge, sample_id: first });
    expect(opened.type).toBe("sample_record");
    const before = [...posted];
    const reveal = await send({ type: "challenge_guess", id: 22, challenge: ready.challenge, target: { sample_id: first } });
    if (reveal.type !== "challenge_reveal") throw new Error(JSON.stringify(errorOf(reveal)));
    expect(before.map((m) => m.type).filter((t) => !ALLOWED_BEFORE_GUESS.includes(t))).toEqual([]);
    for (const m of before) for (const forbidden of ["reveal", "planted", "affected", "plant", "materialised", "realised_errors", "score"]) expect(keysDeep(m), `${m.type} ${forbidden}`).not.toContain(forbidden);
    const planted = reveal.reveal.planted.affected[0] as string;
    const outsideTheRecord = { ...(ready as unknown as Record<string, unknown>), record: null };
    expect(JSON.stringify(outsideTheRecord)).not.toContain(planted);
    expect(JSON.stringify(opened)).not.toContain('"truth"');
  }, 60_000);

  it("Given the reveal Then the challenge is over: a second guess, a give-up or an open is refused", async () => {
    const { send } = setup();
    const ready = await send({ type: "challenge_start", id: 20, variant: "sample", spec: SAMPLE_SPEC, seed: 41, shown: "c_context_minus_system_issued_id" });
    if (ready.type !== "challenge_ready") throw new Error("ready expected");
    const gone = await send({ type: "challenge_giveup", id: 21, challenge: ready.challenge });
    expect(gone.type).toBe("challenge_reveal");
    expect(errorOf(await send({ type: "challenge_guess", id: 22, challenge: ready.challenge, target: { sample_id: "x" } })).code).toBe("invalid_spec");
    expect(errorOf(await send({ type: "challenge_giveup", id: 23, challenge: ready.challenge })).code).toBe("invalid_spec");
    expect(errorOf(await send({ type: "challenge_open", id: 24, challenge: ready.challenge, sample_id: "x" })).code).toBe("invalid_spec");
  }, 60_000);

  it("Given a guess that is not a sample of the shown record, an unknown challenge or a bad start Then invalid_spec", async () => {
    const { send } = setup();
    const ready = await send({ type: "challenge_start", id: 20, variant: "sample", spec: SAMPLE_SPEC, seed: 41, shown: "a_manual" });
    if (ready.type !== "challenge_ready") throw new Error("ready expected");
    expect(errorOf(await send({ type: "challenge_guess", id: 21, challenge: ready.challenge, target: { sample_id: "U99-D99-9" } })).code).toBe("invalid_spec");
    expect(errorOf(await send({ type: "challenge_guess", id: 22, challenge: ready.challenge, target: { decision_id: "U01@1" } })).code).toBe("invalid_spec");
    expect(errorOf(await send({ type: "challenge_guess", id: 23, challenge: "challenge-99", target: { sample_id: "x" } })).code).toBe("invalid_spec");
    expect(errorOf(await send({ type: "challenge_start", id: 24, variant: "sample", spec: SAMPLE_SPEC, seed: 41, shown: "c_context" })).message).toMatch(/every drawn type is prevented/);
    expect(errorOf(await send({ type: "challenge_start", id: 25, variant: "decision", spec: SAMPLE_SPEC, seed: 41, shown: "a_manual" })).message).toMatch(/not offered/);
    expect(errorOf(await send({ type: "challenge_start", id: 26, variant: "poem", spec: SAMPLE_SPEC, seed: 41, shown: "a_manual" })).code).toBe("invalid_spec");
  }, 60_000);

  it("Given an unrevealed challenge Then lineage of the same run is locked, a lineage of another seed is not, and after the give-up the same run answers", async () => {
    const { send } = setup();
    const ready = await send({ type: "challenge_start", id: 20, variant: "sample", spec: SAMPLE_SPEC, seed: 41, shown: "a_manual" });
    if (ready.type !== "challenge_ready") throw new Error("ready expected");
    const sample_id = (ready.record as { samples: { sample_id: string }[] }).samples[0]?.sample_id as string;
    const lineage = (seed: number) => send({ type: "lineage", id: 30 + seed, spec: { ...SAMPLE_SPEC, architectures: ["a_manual", "c_context"], seeds: [seed] }, seed, pick: { sample_id } });
    expect(errorOf(await lineage(41)).code).toBe("locked");
    expect(errorOf(await lineage(42)).code).not.toBe("locked"); // another seed is another run: it answers, or refuses on the sample id, but never with `locked`
    await send({ type: "challenge_giveup", id: 40, challenge: ready.challenge });
    expect((await lineage(41)).type).toBe("lineage");
  }, 120_000);
});

describe("The decision challenge", () => {
  it("Given a start Then progress is posted after each of the two loops, then challenge_ready with the decisions and the inputs of the loop with their ledger ids", async () => {
    const { posted, send } = setup(decisionData());
    const ready = await send({ type: "challenge_start", id: 50, variant: "decision", spec: DECISION_SPEC, seed: 3, shown: "a_manual" });
    if (ready.type !== "challenge_ready") throw new Error(JSON.stringify(errorOf(ready)));
    const progress = posted.filter((m) => m.type === "progress");
    expect(progress.map((m) => (m.type === "progress" ? [m.id, m.done, m.total] : []))).toEqual([[50, 1, 2], [50, 2, 2]]);
    expect(ready.announced_type).toBe("label_error");
    expect((ready.record as { decisions: unknown[] }).decisions).toHaveLength(36);
    expect(ready.inputs.map((i) => i.ref).sort()).toEqual(["A041", "A042", "A043", "A046", "A051", "A064", "A108"]);
  }, 60_000);

  it("Given a guess of an affected decision Then the reveal holds the decisions part and the score hit; the messages before it carry no affected decision marker", async () => {
    const { posted, send } = setup(decisionData());
    const ready = await send({ type: "challenge_start", id: 50, variant: "decision", spec: DECISION_SPEC, seed: 3, shown: "a_manual" });
    if (ready.type !== "challenge_ready") throw new Error("ready expected");
    const before = [...posted];
    // the page cannot know which decision is affected; the unit test asks the reveal of a give-up first on a second challenge of the same seed (the plant is a function of the seed)
    const probe = await send({ type: "challenge_start", id: 51, variant: "decision", spec: DECISION_SPEC, seed: 3, shown: "a_manual" });
    if (probe.type !== "challenge_ready") throw new Error("ready expected");
    const gaveUp = await send({ type: "challenge_giveup", id: 52, challenge: probe.challenge });
    if (gaveUp.type !== "challenge_reveal") throw new Error("reveal expected");
    const affected = gaveUp.reveal.decisions?.affected ?? [];
    expect(affected.length).toBeGreaterThan(0);
    const reveal = await send({ type: "challenge_guess", id: 53, challenge: ready.challenge, target: { decision_id: affected[0] } });
    if (reveal.type !== "challenge_reveal") throw new Error(JSON.stringify(errorOf(reveal)));
    expect(reveal.reveal.score).toEqual({ result: "hit" });
    for (const m of before) for (const forbidden of ["reveal", "planted", "affected", "plant", "decisions_affected", "from_sample", "truth"]) expect(keysDeep(m), `${m.type} ${forbidden}`).not.toContain(forbidden);
  }, 120_000);

  it("Given a guess that is not a decision of the record, or a variant on a scenario that is not SC8, or an architecture that prevents the error Then invalid_spec", async () => {
    const { send } = setup(decisionData());
    expect(errorOf(await send({ type: "challenge_start", id: 60, variant: "decision", spec: SAMPLE_SPEC, seed: 3, shown: "a_manual" })).message).toMatch(/sc08_ph_restandardisation/);
    expect(errorOf(await send({ type: "challenge_start", id: 61, variant: "decision", spec: DECISION_SPEC, seed: 3, shown: "b_lims_lite" })).message).toMatch(/system_issued_id/);
    const ready = await send({ type: "challenge_start", id: 62, variant: "decision", spec: DECISION_SPEC, seed: 3, shown: "a_manual" });
    if (ready.type !== "challenge_ready") throw new Error("ready expected");
    expect(errorOf(await send({ type: "challenge_guess", id: 63, challenge: ready.challenge, target: { decision_id: "U99@1" } })).code).toBe("invalid_spec");
    expect(errorOf(await send({ type: "challenge_guess", id: 64, challenge: ready.challenge, target: { sample_id: "U01-D01-1" } })).code).toBe("invalid_spec");
  }, 120_000);
});
