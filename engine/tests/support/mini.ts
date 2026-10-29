import type { L3Input } from "../../src/analysis.ts";

/** Seconds since day 0, 00:00:00 (the engine's only clock). Test-only helper. */
export const T = (h: number, m = 0, s = 0): number => h * 3600 + m * 60 + s;

/** A one-analyzer, one-group, FIFO input with nothing else; tests override what they need. Fixture-only values. */
export const mini = (over: Partial<L3Input> = {}): L3Input => ({
  schema_version: "1",
  engine_version: "test",
  seed: 1,
  policy: "fifo",
  analyzers: [{ id: "AN-1", group: "G", initial_method: null }],
  setup: [],
  windows: [],
  requests: [],
  forced_outcomes: [],
  ...over,
});

export const req = (request_id: string, seq: number, arrive_s: number, service_s: number, extra: Record<string, unknown> = {}) => ({
  request_id,
  seq,
  arrive_s,
  ...extra,
  visits: [{ group: "G", service_s }],
});
