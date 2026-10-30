import { describe, expect, it } from "vitest";
import { runScenario } from "../../src/run.ts";
import { canonicalJson, canonicalJsonl, ENGINE_VERSION, logHash, sha256Hex } from "../../src/trace.ts";
import { configOf } from "../support/scenarios.ts";

describe("Contract: log identity", () => {
  it("canonical JSON sorts keys at every depth and writes integers without a fraction", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { z: 1, y: 2 }] } })).toBe('{"a":{"c":[3,{"y":2,"z":1}],"d":2},"b":1}');
  });

  it("canonical JSONL is one canonical object per line, in log order, with a final newline", () => {
    expect(canonicalJsonl([{ t: 2, type: "b" }, { type: "a", t: 1 }])).toBe('{"t":2,"type":"b"}\n{"t":1,"type":"a"}\n');
  });

  it("sha256 comes from Web Crypto and matches the published vector", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("the same events give the same log_hash; a different seed in the header gives a different one", async () => {
    const a = [{ type: "log_header", seed: 1, t: 0 }, { type: "run_started", t: 5 }];
    const b = [{ type: "log_header", seed: 2, t: 0 }, { type: "run_started", t: 5 }];
    expect(await logHash(a)).toBe(await logHash(structuredClone(a)));
    expect(await logHash(a)).not.toBe(await logHash(b));
    expect(await logHash(a)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("Given the default scenario When it runs Then the log opens with a log_header that carries engine_version 0.2.0 (spec section 3, rule 3: ADR-0019 changed the bytes of every log, so the version moved from 0.1.0)", () => {
    const first = runScenario({ ...configOf("default"), seed: 1 }).events[0];
    expect(ENGINE_VERSION).toBe("0.2.0");
    expect(first).toMatchObject({ type: "log_header", engine_version: "0.2.0", seed: 1 });
  });
});
