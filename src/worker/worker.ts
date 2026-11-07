import { canonicalActions } from "../../engine/src/experiments/assembly/lab/actions.ts";
import type { Action, PlantRefusal } from "../../engine/src/experiments/assembly/lab/actions.ts";
import { answerBreakout } from "../../engine/src/experiments/assembly/lab/breakout.ts";
import { checkError, makeDeps, runCheck } from "../../engine/src/experiments/assembly/lab/check.ts";
import { createChallenges } from "../../engine/src/experiments/assembly/lab/challenges.ts";
import type { Refusal } from "../../engine/src/experiments/assembly/lab/challenges.ts";
import { checkFleet } from "../../engine/src/experiments/assembly/lab/fleet_check.ts";
import { homeRun } from "../../engine/src/experiments/assembly/lab/home.ts";
import { answerLineage } from "../../engine/src/experiments/assembly/lab/lineage_request.ts";
import type { PlantKept } from "../../engine/src/experiments/assembly/lab/plant.ts";
import { answerPlantRecord } from "../../engine/src/experiments/assembly/lab/plant_record.ts";
import { answerPlantStart } from "../../engine/src/experiments/assembly/lab/plant_stage.ts";
import { answerPlantTruth, checkTruthPick } from "../../engine/src/experiments/assembly/lab/plant_truth.ts";
import { readyOf } from "../../engine/src/experiments/assembly/lab/ready.ts";
import { checkRunActions, runLab } from "../../engine/src/experiments/assembly/lab/run.ts";
import type { LabData } from "../../engine/src/experiments/assembly/lab/setup.ts";
import { checkRunSpec } from "../../engine/src/experiments/assembly/lab/spec.ts";
import type { RunSpec } from "../../engine/src/experiments/assembly/lab/spec.ts";
import { truthKeyOf } from "../../engine/src/experiments/assembly/lab/truth_key.ts";
import type { CheckDetail, CheckState, ErrorCode, ResultFooter, Response } from "../protocol.ts";
import { LAB_DATA } from "./data.ts";

// The Worker entry (docs/design/lab_ui.md section 4): the only file of src/ with value imports from engine/, and only from engine/src/experiments/assembly/lab/. The page sends a request of plain
// data and gets plain data back; there is no message that asks for a truth log, an event stream, the answer key or the raw quirk key. Both sides are one build, so the page trusts the Worker's
// messages; the Worker does not trust a request, because a shareable link is user input (invalid_spec).
//
// S3g adds `breakout` (the Break-out screen): one SC12 case, one seed, the chosen architectures, answered with `breakout_result`.
//
// S3e adds `lineage` and the four `challenge_*` requests. The challenge lives in the Worker under its id (engine/src/experiments/assembly/lab/challenges.ts): the plant leaves it only inside
// `challenge_reveal`, and `lineage` is refused with `locked` for a run that is an unrevealed challenge (rules 2 and 3 of section 4).
//
// P3 adds `plant_run` (the plant of ADR-0021, docs/design/plant_ui.md sections 5 and 6): the checked spec and its actions are run from the start and answered as `plant_ready`, a scene plan with the
// hashes that prove what ran. The Worker keeps the truth log of the last answer it posted (`PlantKept`) for the checks of the next. An epoch names each request: the Worker answers one plant run
// at a time, a newer epoch cancels an older run that has not built its answer yet, and every message about a plant request echoes the epoch, so the page drops what is not the latest.
//
// P5a adds the progressive halls and `plant_record` (docs/design/plant_ui.md sections 5.5 and 6): the answer to `plant_run` is `plant_ready` with the plan and the record hall of the first architecture of
// the spec, as soon as the truth run and that record are built; the other architectures follow as one `plant_halls` message each, in the order of the spec, a turn of the event loop apart, so a newer
// epoch (which the Worker sees between two halls) cancels the halls still pending and nothing is posted for them. The halls that are built are kept with the truth log (`PlantKept`), and `plant_record`
// reads the rows of one card from them for the epoch asked for, with no recompute; a request for another epoch is `cancelled` and one for a hall or a sample the run does not hold is refused.
//
// P5b adds `plant_truth` (docs/design/plant_ui.md section 6, rule 8): the truth overlay, asked for on the reader's switch only. It is read from the run the Worker kept (the truth log, the halls with
// the errors the injector materialised on them) with no recompute: for a sample the lineage view's truth column and verdicts, for the halls the placeholders. A challenge open on the same run answers
// `locked` at the moment of the request; no plant_ready, plant_halls or plant_record_view carries any of it.
//
// P7b lets `plant_run` take a break-out case (docs/design/plant_ui.md section 6, rule 11): a `spec` with a `case` is checked as the `breakout` request is and answered with the same messages, `plant_ready` and one
// `plant_halls` for each other architecture; a build that bundles no SC12 file refuses it as `breakout` does. `plant_truth` answers the pick `{ breakout: true }` for a case.
//
// P5c adds `actions` to `lineage` and `breakout` (docs/design/plant_ui.md section 6, rule 9): the operator actions of the plant a drill-down was opened from, checked as `plant_run` checks them, so the
// lineage view of a sample is made from the run the plant shows. A refusal of an action arrives as `error` with code `refused`, its `reason` and its `index`. `challenge_start` refuses a list of actions.
//
// P6b adds `actions` to `run` (docs/design/lab_ui.md section 22): the plant's actions that name a unit or an analyzer, applied to every seed. The list is checked before the run is queued (the shape, the kind, a kind
// Results does not carry, the bounds), so a refusal arrives at once with its reason and index; the footer of the result repeats the list. With none, or an empty list, the run is what it was.
//
// U2 adds `fleet_check` (docs/design/lab_ui.md section 4, rule 6): the analyzer list as Setup holds it, answered at once with the problems that the engine's own check of the two lists finds
// (fleet_check.ts), as data. It runs nothing and keeps nothing; the page keeps only the answer to the newest id.
//
// createWorker holds the whole protocol and touches no global, so the unit tests drive it directly. The entry at the bottom wires it to postMessage when this file runs as a Worker.

export interface WorkerEnv {
  data: LabData;
  /** The parsed reference.json of the build; a rejection is a check that could not run. */
  fetchReference(): Promise<unknown>;
  /** A monotonic clock in milliseconds, used for the timed runs of the check and nothing else. */
  now(): number;
}

const yieldToLoop = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const PENDING: CheckDetail = { runs_ms: [], truth: [], repeats_equal: false, cells_equal: false };

export const createWorker = (post: (message: Response) => void, env: WorkerEnv) => {
  const ready = readyOf(env.data);
  const challenges = createChallenges(env.data);
  let check: { state: CheckState; detail: CheckDetail } = { state: "pending", detail: PENDING };
  /** The runs that are queued or running, and those a `cancel` named. A run is read for its flag between seeds. */
  const open = new Set<number>();
  const cancelled = new Set<number>();
  /** Runs are answered one at a time, in the order they were asked for: how many are not finished, and the last one asked for. */
  let unfinished = 0;
  let last: Promise<void> = Promise.resolve();

  const fail = (id: number | null, code: ErrorCode, message: string): void => post({ type: "error", id, code, message });

  /** Start-up: ready, then the browser check. Results may be asked for while it runs; their footer says `pending`. */
  const start = async (): Promise<void> => {
    post({ type: "ready", ...ready });
    post({ type: "check", ...check });
    try {
      const reference = await env.fetchReference();
      check = await runCheck(reference, makeDeps(env.data, env.now));
    } catch (e) {
      check = checkError(`reference.json could not be loaded (${e instanceof Error ? e.message : String(e)})`);
    }
    post({ type: "check", ...check });
  };

  const footerOf = (spec: RunSpec, inputs: ResultFooter["inputs"], actions: readonly Action[] = []): ResultFooter => ({
    kind: "simulation_result",
    scenario: spec.scenario,
    seeds: spec.seeds,
    engine_version: ready.engine_version,
    architectures: spec.architectures,
    inputs,
    ...(actions.length > 0 && { actions: canonicalActions(actions).map((n) => n.action) }),
    ...(spec.bay_profiles && { bay_profiles: spec.bay_profiles }),
    ...(spec.analyzer_profiles && { analyzer_profiles: spec.analyzer_profiles }),
    ...(spec.capture_path && { capture_path: spec.capture_path }),
    check: check.state,
  });

  /** One run, from the queue: the Home form (no architecture) or the full run, seed by seed. */
  const answer = async (id: number, spec: RunSpec, actions: readonly Action[]): Promise<void> => {
    try {
      if (cancelled.has(id)) return fail(id, "cancelled", "the run was cancelled before it started");
      if (spec.architectures.length === 0) {
        const out = homeRun(env.data, spec);
        if (!out.ok) return fail(id, "invalid_spec", out.message);
        return post({ type: "result", id, summary: out.summary, footer: footerOf(spec, []) });
      }
      const out = await runLab(env.data, spec, { onProgress: (done, total) => post({ type: "progress", id, done, total }), isCancelled: () => cancelled.has(id) }, actions);
      if (!out.ok) return fail(id, "cancelled", `the run was cancelled after ${out.done} of ${spec.seeds.length} seeds`);
      post({ type: "result", id, report: out.report, utilisation: out.utilisation, footer: footerOf(spec, out.inputs, actions) });
    } catch (e) {
      fail(id, "engine_error", e instanceof Error ? e.message : String(e));
    } finally {
      open.delete(id);
      cancelled.delete(id);
      unfinished -= 1;
    }
  };

  const run = (id: number, raw: unknown, given: unknown): Promise<void> | void => {
    const checked = checkRunSpec(raw, env.data);
    if (!checked.ok) return fail(id, "invalid_spec", checked.message);
    // the plant's actions (P6b): checked here, before the run is queued; absent is no list, and null or anything but a list is a malformed one
    let actions: Action[] = [];
    if (given !== undefined) {
      try {
        const listed = checkRunActions(env.data, checked.spec, given);
        if (!listed.ok) return refuse(id, listed);
        actions = listed.actions;
      } catch (e) {
        return fail(id, "engine_error", e instanceof Error ? e.message : String(e));
      }
    }
    open.add(id);
    // a run asked for when none is unfinished starts at once (so one asked for while the check is pending is answered with `pending`); a later one waits for the one before it
    const idle = unfinished === 0;
    unfinished += 1;
    const mine = idle ? answer(id, checked.spec, actions) : last.then(() => answer(id, checked.spec, actions));
    last = mine;
    return mine;
  };

  /** `fleet_check`: the problems of an analyzer list, answered at once; a request that names no bundled scenario or analyzer profile is `invalid_spec`. */
  const fleetCheck = (id: number, request: Record<string, unknown>): void => {
    try {
      const out = checkFleet(env.data, request.scenario, request.analyzers);
      if (out.ok) post({ type: "fleet_checked", id, problems: out.problems });
      else fail(id, "invalid_spec", out.message);
    } catch (e) {
      fail(id, "engine_error", e instanceof Error ? e.message : String(e));
    }
  };

  /** A refusal of a one-seed request: `refused` (an action a rule refuses, P5c) carries its reason and the index of the action, as it does for `plant_run`; the others are a code and a message. */
  const refuse = (id: number, r: Refusal | PlantRefusal): void =>
    r.code === "refused" ? post({ type: "error", id, code: "refused", message: r.message, reason: r.reason, index: r.index }) : fail(id, r.code, r.message);

  /** The one-seed requests (lineage, challenge_*): answered at once, in the order they arrive; an engine exception arrives as `engine_error` with its message. */
  const oneSeed = (id: number, request: Record<string, unknown>): void => {
    try {
      switch (request.type) {
        case "lineage": {
          const out = answerLineage(env.data, challenges, { spec: request.spec, seed: request.seed, pick: request.pick, actions: request.actions });
          // the key of the run of the view, its actions stripped (rule 2 of lab_ui.md section 4): the page empties the view when a challenge starts on a run of the same key
          return out.ok ? post({ type: "lineage", id, view: out.view, sample_ids: out.sample_ids, key: challenges.keyOf(request.spec as RunSpec, request.seed as number) }) : refuse(id, out);
        }
        case "challenge_start": {
          // a challenge holds a blind plant that no operator action reaches (plant_ui.md section 6, rule 9): a list of actions is refused and not ignored
          if (request.actions !== undefined) return fail(id, "invalid_spec", "a challenge takes no actions: it holds a blind plant that no operator action reaches");
          const out = challenges.start({ variant: request.variant, spec: request.spec, seed: request.seed, shown: request.shown }, (done, total) => post({ type: "progress", id, done, total }));
          return out.ok ? post({ type: "challenge_ready", id, challenge: out.challenge, announced_type: out.announced_type, record: out.record, inputs: out.inputs, key: out.key }) : refuse(id, out);
        }
        case "challenge_open": {
          const out = challenges.drillDown(request.challenge, request.sample_id);
          return "ok" in out ? refuse(id, out) : post({ type: "sample_record", id, sample: out });
        }
        default: {
          const out = challenges.finish(request.challenge, request.type === "challenge_giveup" ? null : request.target);
          return "ok" in out ? refuse(id, out) : post({ type: "challenge_reveal", id, reveal: out });
        }
      }
    } catch (e) {
      fail(id, "engine_error", e instanceof Error ? e.message : String(e));
    }
  };

  /** The `breakout` request: one case, one seed, the architectures; the answer is the report of the case over that seed. It is async (the truth log is hashed before and after the architectures). */
  const breakout = async (id: number, request: Record<string, unknown>): Promise<void> => {
    try {
      const out = await answerBreakout(env.data, { case: request.case, architectures: request.architectures, seed: request.seed, actions: request.actions });
      if (out.ok) post({ type: "breakout_result", id, result: out.result });
      else refuse(id, out);
    } catch (e) {
      fail(id, "engine_error", e instanceof Error ? e.message : String(e));
    }
  };

  /** The plant: the newest epoch asked for, what the last answer posted kept and the epoch it belongs to, and the queue (plant runs are answered one at a time, in the order they arrive). */
  let plantLatest = -1;
  let plantKept: PlantKept | undefined;
  let keptEpoch = -1;
  let plantQueue: Promise<void> = Promise.resolve();

  const plantAnswer = async (id: number, epoch: number, raw: unknown): Promise<void> => {
    const stale = (): boolean => epoch !== plantLatest;
    const cancelled = (): void => post({ type: "error", id, epoch, code: "cancelled", message: "the plant run was replaced by a newer one before its answer was drawn" });
    try {
      // one turn of the event loop first: a newer request that is already waiting is handled before this one builds anything
      await yieldToLoop();
      if (stale()) return cancelled();
      const out = await answerPlantStart(env.data, challenges, { spec: raw }, plantKept);
      if (stale()) return cancelled();
      if (!out.ok) return post({ type: "error", id, epoch, code: out.code, message: out.message, ...(out.code === "refused" && { reason: out.reason, index: out.index }) });
      plantKept = out.kept;
      keptEpoch = epoch;
      // the key of the truth of the run, its actions stripped; a break-out case has no run spec and no challenge can be opened on it, so its key is that of its own truth log (plant_ui.md section 6, rule 11)
      post({ type: "plant_ready", id, epoch, ...out.answer, key: out.kept.run === null ? truthKeyOf(out.kept.events) : challenges.keyOf(out.kept.run, out.kept.seed) });
      // the other halls, one at a time, a turn of the event loop between them; a newer epoch stops the ones still pending and nothing is posted for them (section 5.5)
      for (const build of out.halls) {
        await yieldToLoop();
        if (stale()) return;
        const hall = await build();
        if (stale()) return;
        post({ type: "plant_halls", id, epoch, ...hall });
      }
    } catch (e) {
      post({ type: "error", id, epoch, code: "engine_error", message: e instanceof Error ? e.message : String(e) });
    }
  };

  /** `plant_record`: the rows one architecture holds for one card, read from the halls the Worker kept for that epoch. Answered at once; the epoch is echoed on every message about it. */
  const plantRecord = (id: number, message: Record<string, unknown>): void => {
    const { epoch, architecture, sample_id } = message;
    if (typeof epoch !== "number" || !Number.isInteger(epoch) || epoch < 0) return fail(id, "invalid_spec", "a plant_record request needs a whole epoch, 0 or more");
    if (typeof architecture !== "string" || typeof sample_id !== "string") return post({ type: "error", id, epoch, code: "invalid_spec", message: "a plant_record request needs an architecture and a sample_id, both strings" });
    // the record is read from the run of the epoch asked for: when the Worker holds another run (a newer one was posted, or none was) the request is stale and the page drops the answer anyway
    if (plantKept === undefined || epoch !== keptEpoch) return post({ type: "error", id, epoch, code: "cancelled", message: `the Worker holds no plant run of epoch ${epoch}` });
    const out = answerPlantRecord(plantKept, architecture, sample_id);
    if (!out.ok) return post({ type: "error", id, epoch, code: "refused", reason: "unknown_target", message: out.message });
    post({ type: "plant_record_view", id, epoch, sample: out.sample });
  };

  /**
   * `plant_truth`: what the simulation knows and no record can hold, for the run the Worker kept (plant_truth.ts). The order of the checks: a malformed request, then the epoch (another one is
   * `cancelled`), then the lock of a challenge on the same run, asked at this moment, then the sample. Answered at once; the epoch is echoed on every message about it.
   */
  const plantTruth = (id: number, message: Record<string, unknown>): void => {
    const { epoch, pick } = message;
    if (typeof epoch !== "number" || !Number.isInteger(epoch) || epoch < 0) return fail(id, "invalid_spec", "a plant_truth request needs a whole epoch, 0 or more");
    const checked = checkTruthPick(pick);
    if (!checked.ok) return post({ type: "error", id, epoch, code: "invalid_spec", message: checked.message });
    if (plantKept === undefined || epoch !== keptEpoch) return post({ type: "error", id, epoch, code: "cancelled", message: `the Worker holds no plant run of epoch ${epoch}` });
    const out = answerPlantTruth(plantKept, challenges, checked.pick);
    if (!out.ok) return post(out.code === "locked" ? { type: "error", id, epoch, code: "locked", message: out.message } : { type: "error", id, epoch, code: "refused", reason: out.reason, message: out.message });
    post({ type: "plant_truth_view", id, epoch, view: out.view });
  };

  const plantRun = (id: number, message: Record<string, unknown>): Promise<void> | void => {
    const epoch = message.epoch;
    if (typeof epoch !== "number" || !Number.isInteger(epoch) || epoch < 0) return fail(id, "invalid_spec", "a plant_run request needs a whole epoch, 0 or more");
    if (epoch <= plantLatest) return post({ type: "error", id, epoch, code: "invalid_spec", message: `the epoch ${epoch} is not larger than the last epoch seen (${plantLatest})` });
    plantLatest = epoch;
    plantQueue = plantQueue.then(() => plantAnswer(id, epoch, message.spec));
    return plantQueue;
  };

  const onMessage = (message: unknown): Promise<void> | void => {
    if (typeof message !== "object" || message === null || Array.isArray(message)) return fail(null, "invalid_spec", "a request must be an object with a type");
    const { type, id, spec, actions } = message as { type?: unknown; id?: unknown; spec?: unknown; actions?: unknown };
    const requestId = typeof id === "number" ? id : null;
    if (type === "run" && requestId !== null) return run(requestId, spec, actions);
    if (type === "run") return fail(null, "invalid_spec", "a run request needs a numeric id");
    if (type === "cancel" && requestId !== null) {
      // a cancel for a run that is not queued or running has nothing to stop
      if (open.has(requestId)) cancelled.add(requestId);
      return;
    }
    if (type === "cancel") return fail(null, "invalid_spec", "a cancel request needs a numeric id");
    if (type === "fleet_check") return requestId === null ? fail(null, "invalid_spec", "a fleet_check request needs a numeric id") : fleetCheck(requestId, message as Record<string, unknown>);
    if (type === "lineage" || type === "challenge_start" || type === "challenge_open" || type === "challenge_guess" || type === "challenge_giveup") {
      if (requestId === null) return fail(null, "invalid_spec", `a ${type} request needs a numeric id`);
      return oneSeed(requestId, message as Record<string, unknown>);
    }
    if (type === "breakout") return requestId === null ? fail(null, "invalid_spec", "a breakout request needs a numeric id") : breakout(requestId, message as Record<string, unknown>);
    if (type === "plant_run") return requestId === null ? fail(null, "invalid_spec", "a plant_run request needs a numeric id") : plantRun(requestId, message as Record<string, unknown>);
    if (type === "plant_record") return requestId === null ? fail(null, "invalid_spec", "a plant_record request needs a numeric id") : plantRecord(requestId, message as Record<string, unknown>);
    if (type === "plant_truth") return requestId === null ? fail(null, "invalid_spec", "a plant_truth request needs a numeric id") : plantTruth(requestId, message as Record<string, unknown>);
    return fail(requestId, "invalid_spec", `unknown request type ${JSON.stringify(type)}`);
  };

  return { start, onMessage };
};

// The entry, only inside a Worker: a window has `document`, and Node (the unit tests) has no `self`.
if (typeof document === "undefined" && typeof self !== "undefined") {
  const scope = self as unknown as { postMessage(message: Response): void; addEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void };
  const worker = createWorker((message) => scope.postMessage(message), {
    data: LAB_DATA,
    now: () => performance.now(),
    // the build puts reference.json beside index.html; the Worker chunk is in assets/
    fetchReference: async () => {
      const response = await fetch(new URL(/* @vite-ignore */ "../reference.json", import.meta.url));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    },
  });
  scope.addEventListener("message", (event) => void worker.onMessage(event.data));
  void worker.start();
}
