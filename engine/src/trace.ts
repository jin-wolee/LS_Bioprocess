import type { L3Input, L3Run } from "./analysis.ts";
import type { Trace } from "./generated/trace.schema";
import type { TraceResult } from "./generated/trace_result.schema";

// Export and log identity: the trace a core loop reads, the result it returns, and the canonical form the log hash covers.

export const ENGINE_VERSION = "0.1.0";

const byCode = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const sortKeys = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).sort(([a], [b]) => byCode(a, b)).map(([k, x]) => [k, sortKeys(x)]));
  return v;
};

/** Canonical JSON: keys sorted at every depth; times are integers, so no float appears in a time field. */
export const canonicalJson = (value: unknown, indent?: number): string => JSON.stringify(sortKeys(value), null, indent);

/** Canonical JSONL: one canonical object per line in log order, newline-terminated. */
export const canonicalJsonl = (events: readonly unknown[]): string => events.map((e) => `${canonicalJson(e)}\n`).join("");

/** SHA-256 hex digest with Web Crypto (asynchronous by nature; the engine itself never awaits). */
export const sha256Hex = async (text: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
};

export const logHash = (events: readonly unknown[]): Promise<string> => sha256Hex(canonicalJsonl(events));

/** The trace of an L3 input: engine-only extras (sampled_s, noise, kind, dilution_factor, ...) are dropped. */
export const exportTrace = (input: L3Input, expected?: TraceResult, source?: Trace["source"]): Trace => {
  const trace: Trace = {
    schema_version: "1",
    engine_version: input.engine_version,
    seed: input.seed,
    policy: input.policy,
    analyzers: input.analyzers.map((a) => ({ id: a.id, group: a.group, initial_method: a.initial_method })),
    setup: input.setup.map((s) => ({ from_method: s.from_method, to_method: s.to_method, seconds: s.seconds })),
    windows: input.windows.map((w) => ({ analyzer: w.analyzer, start_s: w.start_s, end_s: w.end_s })),
    requests: input.requests.map((r) => ({
      request_id: r.request_id,
      seq: r.seq,
      arrive_s: r.arrive_s,
      ...(r.deadline_s !== undefined && { deadline_s: r.deadline_s }),
      // the schema's minItems 1 makes the generated type a non-empty tuple; runL3 rejects empty visit lists
      visits: r.visits.map((v) => ({
        group: v.group,
        service_s: v.service_s,
        ...(v.method_id !== undefined && { method_id: v.method_id }),
        ...(v.transfer_s !== undefined && { transfer_s: v.transfer_s }),
      })) as Trace["requests"][number]["visits"],
    })),
    forced_outcomes: input.forced_outcomes.map((f) => ({ request_id: f.request_id, attempt: f.attempt, visit: f.visit, outcome: f.outcome })),
  };
  if (expected) trace.expected_result = expected;
  if (source) trace.source = source;
  return trace;
};

/** The trace_result of a run: sorted by (start_s, analyzer, request_id, attempt); engine_version and seed come from the input. */
export const toTraceResult = (input: { engine_version: string; seed: number }, runs: readonly L3Run[]): TraceResult => ({
  schema_version: "1",
  engine_version: input.engine_version,
  seed: input.seed,
  runs: [...runs].sort((a, b) => a.start_s - b.start_s || byCode(a.analyzer, b.analyzer) || byCode(a.request_id, b.request_id) || a.attempt - b.attempt),
});
