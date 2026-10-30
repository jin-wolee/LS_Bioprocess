import { checkError, makeDeps, runCheck } from "../../engine/src/experiments/assembly/lab/check.ts";
import { homeRun } from "../../engine/src/experiments/assembly/lab/home.ts";
import { readyOf } from "../../engine/src/experiments/assembly/lab/ready.ts";
import { runLab } from "../../engine/src/experiments/assembly/lab/run.ts";
import type { LabData } from "../../engine/src/experiments/assembly/lab/setup.ts";
import { checkRunSpec } from "../../engine/src/experiments/assembly/lab/spec.ts";
import type { RunSpec } from "../../engine/src/experiments/assembly/lab/spec.ts";
import type { CheckDetail, CheckState, ErrorCode, ResultFooter, Response } from "../protocol.ts";
import { LAB_DATA } from "./data.ts";

// The Worker entry (docs/design/lab_ui.md section 4): the only file of src/ with value imports from engine/, and only from engine/src/experiments/assembly/lab/. The page sends a request of plain
// data and gets plain data back; there is no message that asks for a truth log, an event stream, the answer key or the raw quirk key. Both sides are one build, so the page trusts the Worker's
// messages; the Worker does not trust a request, because a shareable link is user input (invalid_spec).
//
// createWorker holds the whole protocol and touches no global, so the unit tests drive it directly. The entry at the bottom wires it to postMessage when this file runs as a Worker.

export interface WorkerEnv {
  data: LabData;
  /** The parsed reference.json of the build; a rejection is a check that could not run. */
  fetchReference(): Promise<unknown>;
  /** A monotonic clock in milliseconds, used for the timed runs of the check and nothing else. */
  now(): number;
}

const PENDING: CheckDetail = { runs_ms: [], truth: [], repeats_equal: false, cells_equal: false };

export const createWorker = (post: (message: Response) => void, env: WorkerEnv) => {
  const ready = readyOf(env.data);
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

  const footerOf = (spec: RunSpec, inputs: ResultFooter["inputs"]): ResultFooter => ({
    kind: "simulation_result",
    scenario: spec.scenario,
    seeds: spec.seeds,
    engine_version: ready.engine_version,
    architectures: spec.architectures,
    inputs,
    ...(spec.bay_profiles && { bay_profiles: spec.bay_profiles }),
    ...(spec.analyzer_profiles && { analyzer_profiles: spec.analyzer_profiles }),
    ...(spec.capture_path && { capture_path: spec.capture_path }),
    check: check.state,
  });

  /** One run, from the queue: the Home form (no architecture) or the full run, seed by seed. */
  const answer = async (id: number, spec: RunSpec): Promise<void> => {
    try {
      if (cancelled.has(id)) return fail(id, "cancelled", "the run was cancelled before it started");
      if (spec.architectures.length === 0) {
        const out = homeRun(env.data, spec);
        if (!out.ok) return fail(id, "invalid_spec", out.message);
        return post({ type: "result", id, summary: out.summary, footer: footerOf(spec, []) });
      }
      const out = await runLab(env.data, spec, { onProgress: (done, total) => post({ type: "progress", id, done, total }), isCancelled: () => cancelled.has(id) });
      if (!out.ok) return fail(id, "cancelled", `the run was cancelled after ${out.done} of ${spec.seeds.length} seeds`);
      post({ type: "result", id, report: out.report, utilisation: out.utilisation, footer: footerOf(spec, out.inputs) });
    } catch (e) {
      fail(id, "engine_error", e instanceof Error ? e.message : String(e));
    } finally {
      open.delete(id);
      cancelled.delete(id);
      unfinished -= 1;
    }
  };

  const run = (id: number, raw: unknown): Promise<void> | void => {
    const checked = checkRunSpec(raw, env.data);
    if (!checked.ok) return fail(id, "invalid_spec", checked.message);
    open.add(id);
    // a run asked for when none is unfinished starts at once (so one asked for while the check is pending is answered with `pending`); a later one waits for the one before it
    const idle = unfinished === 0;
    unfinished += 1;
    const mine = idle ? answer(id, checked.spec) : last.then(() => answer(id, checked.spec));
    last = mine;
    return mine;
  };

  const onMessage = (message: unknown): Promise<void> | void => {
    if (typeof message !== "object" || message === null || Array.isArray(message)) return fail(null, "invalid_spec", "a request must be an object with a type");
    const { type, id, spec } = message as { type?: unknown; id?: unknown; spec?: unknown };
    const requestId = typeof id === "number" ? id : null;
    if (type === "run" && requestId !== null) return run(requestId, spec);
    if (type === "run") return fail(null, "invalid_spec", "a run request needs a numeric id");
    if (type === "cancel" && requestId !== null) {
      // a cancel for a run that is not queued or running has nothing to stop
      if (open.has(requestId)) cancelled.add(requestId);
      return;
    }
    if (type === "cancel") return fail(null, "invalid_spec", "a cancel request needs a numeric id");
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
