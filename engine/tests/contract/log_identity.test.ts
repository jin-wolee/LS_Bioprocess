import { describe, expect, it } from "vitest";
import { canonicalJson, canonicalJsonl, logHash, sha256Hex } from "../../src/trace.ts";

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
});
