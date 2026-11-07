import { describe, expect, it } from "vitest";
import type { Response } from "../../../src/protocol.ts";
import { createWorker } from "../../../src/worker/worker.ts";
import { canonicalJson, sha256Hex } from "../../src/trace.ts";
import { labData } from "../support/lab_data.ts";
import { SMALL } from "../support/scenarios.ts";

// P6b (docs/design/lab_ui.md section 22): the `run` request with the `actions` of the plant, through the Worker. Absent or empty the answer is byte for byte the answer before P6b; with actions the order of
// the checks is the shape, the kind/duplicate/limit, the kind Results does not carry, then the bounds; a refusal is `refused` with its reason and index and no epoch, and nothing runs.

const data = labData();
const FULL = { schema_version: "1", scenario: "default", settings: SMALL, architectures: ["a_manual", "c_context"], seeds: [1, 2] };
const ONE = { ...FULL, architectures: ["a_manual"], seeds: [1] };
const FEED = { kind: "add_feed", at: 291600, unit_id: "U03" };
const DOWN = { kind: "analyzer_down", at: 291600, analyzer: "AN-1", from: 306000, length_min: 120 };
const MOVE = { kind: "move_draw", at: 291600, sample_id: "U03-D03-1", to: 297000 };

const setup = () => {
  const posted: Response[] = [];
  const worker = createWorker((m) => posted.push(structuredClone(m)), { data, now: () => performance.now(), fetchReference: async () => undefined });
  const send = async (message: unknown): Promise<Response[]> => {
    const before = posted.length;
    await worker.onMessage(message);
    return posted.slice(before);
  };
  return { send, worker };
};
const run = (id: number, spec: unknown, extra: Record<string, unknown> = {}) => ({ type: "run", id, spec, ...extra });

// Taken at the base commit 408ab0c, before any change of P6b (a temporary test, removed after the pin was written down): the SHA-256 of the canonical JSON of every message the Worker posts for the run
// of the default scenario at its own size, seeds 1 and 2, A, B and C (the two `progress` messages and the `result`), with the browser check as the unit tests have it.
// A2 (2026-11-02, approved in advance; audit F4): taken again after the utilisation per staffed window followed the roster; the base commit 408ab0c's value was 411763f45c11f3cc21ddd1ffc27c0a765c6c648988c1b895199aceb66a2b504d, and the F4 value fa31e05a74b8f645e3d777a21bb624b68014ed81c9e16b7c4ac5042b512f8784 was taken again for F9 (A2, approved in advance): the report of the answer gains the three rows `hold_limit.*`.
// R6 O-01 (author approved 2026-11-07): only ten zero-denominator reason strings changed; event logs and all other response fields are byte-identical.
const PIN = "b0f2d3ff50cb738eca513f1736a5ee90a29428ffa927617d1cb1a003501a968f";

describe("no actions: the answer is the answer of the code before P6b, byte for byte", () => {
  it.each([["absent", {}], ["an empty list", { actions: [] }]])("Given %s Then the default scenario over seeds 1 and 2 hashes to the pin", async (_n, extra) => {
    const { send, worker } = setup();
    await worker.start();
    const spec = { schema_version: "1", scenario: "default", settings: {}, architectures: ["a_manual", "b_lims_lite", "c_context"], seeds: [1, 2] };
    const posted = await send(run(7, spec, extra));
    expect(posted.map((m) => m.type)).toEqual(["progress", "progress", "result"]);
    expect(await sha256Hex(canonicalJson(posted))).toBe(PIN);
  }, 300_000);
});

describe("a run with actions", () => {
  it("Given a feed and a window Then progress follows each seed and the result lists the actions in the canonical order, with their inputs", async () => {
    const { send, worker } = setup();
    await worker.start();
    const posted = await send(run(11, FULL, { actions: [DOWN, FEED] }));
    expect(posted.map((m) => m.type)).toEqual(["progress", "progress", "result"]);
    const result = posted[2];
    if (result?.type !== "result" || !result.report) throw new Error("a result with a report is expected");
    expect(result.footer.actions).toEqual([FEED, DOWN]);
    expect(result.footer.inputs.filter((i) => i.name.startsWith("act-")).map((i) => [i.name, i.value, i.unit, i.ref])).toEqual([
      ["act-1 add_feed U03 at", 4860, "min", "A228"], ["act-2 analyzer_down AN-1 from", 5100, "min", "A228"], ["act-2 analyzer_down AN-1 length", 2, "h", "A096"],
    ]);
    expect(result.footer.seeds).toEqual([1, 2]);
  }, 180_000);

  it("Given no action Then the footer has no `actions` key", async () => {
    const { send } = setup();
    const posted = await send(run(12, ONE));
    expect(JSON.stringify(posted.at(-1))).not.toContain('"actions"');
  }, 120_000);

  it("Given a list in any of its orders Then the answer is one answer", async () => {
    const { send } = setup();
    const [a, b] = [await send(run(13, ONE, { actions: [FEED, DOWN] })), await send(run(13, ONE, { actions: [DOWN, FEED] }))];
    expect(canonicalJson(b)).toBe(canonicalJson(a));
  }, 180_000);
});

describe("the checks, in the order of design: shape, kind, a kind Results does not carry, bounds", () => {
  const refusal = async (actions: unknown, spec: unknown = ONE) => {
    const { send } = setup();
    const posted = await send(run(21, spec, { actions }));
    expect(posted).toHaveLength(1);
    return posted[0] as Response;
  };

  it("Given a list that is not a list or an entry that is not an action Then invalid_spec", async () => {
    expect(await refusal("feed")).toMatchObject({ type: "error", id: 21, code: "invalid_spec" });
    expect(await refusal([FEED, { kind: "add_feed", at: 291600 }])).toMatchObject({ type: "error", id: 21, code: "invalid_spec" });
    expect(await refusal([FEED, 7])).toMatchObject({ type: "error", id: 21, code: "invalid_spec" });
  });

  it("Given a kind outside the table, a duplicate or the seventeenth action Then refused with the reason and the index, and no epoch", async () => {
    const outside = await refusal([FEED, { kind: "place_contamination", at: 60 }]);
    expect(outside).toMatchObject({ type: "error", code: "refused", reason: "unknown_target", index: 1 });
    expect(outside).not.toHaveProperty("epoch");
    expect(await refusal([FEED, { kind: "hold", at: 60 }])).toMatchObject({ code: "refused", reason: "closed_loop", index: 1 });
    expect(await refusal([FEED, FEED])).toMatchObject({ code: "refused", reason: "limit", index: 1 });
    const seventeen = Array.from({ length: 17 }, (_, i) => ({ kind: "add_feed", at: 60 * (i + 1), unit_id: "U01" }));
    expect(await refusal(seventeen)).toMatchObject({ code: "refused", reason: "limit", index: 16 });
  });

  it("Given a kind Results does not carry Then it is refused as unknown_target with its index, and not dropped: a draw, and each lab setting", async () => {
    const out = await refusal([FEED, MOVE]);
    expect(out).toMatchObject({ type: "error", code: "refused", reason: "unknown_target", index: 1 });
    expect(out.type === "error" ? out.message : "").toMatch(/move_draw.*Results carries add_feed, raise_alarm, analyzer_down and change_lot/);
    for (const lab of [{ kind: "set_flag", at: 60, architecture: "a_manual", flag: "audit_trail", on: true }, { kind: "set_capture_path", at: 60, path: "adapter_ingest" }, { kind: "set_labelling", at: 60, method: "handwritten" }]) {
      expect(await refusal([lab, FEED]), lab.kind).toMatchObject({ code: "refused", reason: "unknown_target", index: 0 });
    }
  });

  it("Given a list with a kind Results does not carry and an action that breaks a bound Then the kind is refused first, whatever the order", async () => {
    const late = { kind: "add_feed", at: 60, unit_id: "U03" };
    expect(await refusal([late, MOVE])).toMatchObject({ code: "refused", reason: "unknown_target", index: 1 });
  });

  it("Given a bound broken Then refused with its reason and the index of the action as entered: outside the culture, a window before the action, a unit the run lacks, overlapping windows", async () => {
    expect(await refusal([FEED, { kind: "add_feed", at: 60, unit_id: "U03" }])).toMatchObject({ code: "refused", reason: "outside_window", index: 1 });
    expect(await refusal([{ ...DOWN, from: 240000 }])).toMatchObject({ code: "refused", reason: "past", index: 0 });
    expect(await refusal([{ kind: "raise_alarm", at: 291600, unit_id: "U99" }])).toMatchObject({ code: "refused", reason: "unknown_target", index: 0 });
    expect(await refusal([DOWN, { ...DOWN, from: 309600, length_min: 60 }])).toMatchObject({ code: "refused", reason: "limit", index: 1 });
  });

  it("Given the setup edited so that the unit is gone (the reactors lowered to six) Then the feed on U10 is refused as unknown_target with its index, and the message names the unit", async () => {
    const out = await refusal([{ kind: "add_feed", at: 8 * 86400 + 9 * 3600, unit_id: "U10" }], { ...ONE, settings: { reactor_count: 6 } });
    expect(out).toMatchObject({ type: "error", code: "refused", reason: "unknown_target", index: 0 });
    expect(out.type === "error" ? out.message : "").toContain("U10");
  });

  it("Given a refused list over thirty seeds Then it is refused at once, before any seed (no progress)", async () => {
    const { send } = setup();
    const posted = await send(run(22, { ...ONE, seeds: Array.from({ length: 30 }, (_, i) => i + 1) }, { actions: [{ ...DOWN, analyzer: "AN-9" }] }));
    expect(posted.map((m) => m.type)).toEqual(["error"]);
    expect(posted[0]).toMatchObject({ code: "refused", reason: "unknown_target", index: 0 });
  });

  it("Given the Home form (no architecture) that carries actions Then invalid_spec: the Worker ignores no key silently", async () => {
    expect(await refusal([FEED], { ...ONE, architectures: [], seeds: [1] })).toMatchObject({ type: "error", code: "invalid_spec" });
  });

  it("Given a spec the Worker refuses and good actions Then the spec is refused first", async () => {
    expect(await refusal([FEED], { ...ONE, scenario: "nope" })).toMatchObject({ type: "error", code: "invalid_spec" });
  });
});
