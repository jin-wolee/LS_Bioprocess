import { checkError, makeDeps, runCheck } from "../../engine/src/experiments/assembly/lab/check.ts";
import { homeRun } from "../../engine/src/experiments/assembly/lab/home.ts";
import { readyOf } from "../../engine/src/experiments/assembly/lab/ready.ts";
import type { LabData } from "../../engine/src/experiments/assembly/lab/setup.ts";
import type { CheckDetail, CheckState, ErrorCode, Response } from "../protocol.ts";
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

  const run = (id: number, spec: unknown): void => {
    try {
      const out = homeRun(env.data, spec);
      if (!out.ok) return fail(id, "invalid_spec", out.message);
      post({
        type: "result",
        id,
        summary: out.summary,
        footer: { kind: "simulation_result", scenario: out.spec.scenario, seeds: out.spec.seeds, engine_version: ready.engine_version, architectures: out.spec.architectures, inputs: [], check: check.state },
      });
    } catch (e) {
      fail(id, "engine_error", e instanceof Error ? e.message : String(e));
    }
  };

  const onMessage = (message: unknown): void => {
    if (typeof message !== "object" || message === null || Array.isArray(message)) return fail(null, "invalid_spec", "a request must be an object with a type");
    const { type, id, spec } = message as { type?: unknown; id?: unknown; spec?: unknown };
    const requestId = typeof id === "number" ? id : null;
    if (type === "run" && requestId !== null) return run(requestId, spec);
    if (type === "run") return fail(null, "invalid_spec", "a run request needs a numeric id");
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
  scope.addEventListener("message", (event) => worker.onMessage(event.data));
  void worker.start();
}
