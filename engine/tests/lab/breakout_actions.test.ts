import { describe, expect, it } from "vitest";
import { answerBreakout } from "../../src/experiments/assembly/lab/breakout.ts";
import type { BreakoutAnswer } from "../../src/experiments/assembly/lab/breakout.ts";
import { canonicalJson, sha256Hex } from "../../src/trace.ts";
import { readJson } from "../support/paths.ts";
import { patched } from "../support/scenarios.ts";
import type { Json } from "../support/schemas.ts";
import { breakoutData } from "./breakout_data.ts";

// P5c (docs/design/plant_ui.md section 6, rule 9): the `actions` field of the `breakout` request. With none, or an empty list, the answer is byte for byte the answer of the code before P5c (the pin was taken
// from HEAD 48c8402 with a script kept outside the repository: the SHA-256 of the canonical JSON of the whole answer). With actions, they are applied to the scenario document of the case, so the answer
// equals the answer for the case with the action written in by hand (a maintenance window of AN-1, typed from the mapping of plant_ui.md section 5.2), and the same checks as `plant_run` refuse a bad list.

const data = breakoutData();
const SEED = 9013;
const ARCHS = ["a_manual", "b_lims_lite", "c_context", "c_context_minus_material_lot_links"];
const PIN = "233bc1e759617263ba9d5f069ffb183ca1efd8cb89b748dfe3e78af02dd16954"; // sc12_medium_lot, seed 9013, the four architectures above
// The reader takes AN-1 down on day 5 from 13:00 (478,800 s = 7,980 min) for 120 min, deciding at day 5 09:00 (464,400 s).
const DOWN = { kind: "analyzer_down", at: 464400, analyzer: "AN-1", from: 478800, length_min: 120 };
const HAND: Json = { maintenance: [{ analyzer: "AN-1", start: { value: 7980, unit: "min", ref: "A228" }, length: { value: 2, unit: "h", ref: "A096" } }] };

const digest = (a: unknown): Promise<string> => sha256Hex(canonicalJson(a));
const ask = (extra: Record<string, unknown> = {}, architectures: string[] = ARCHS, from = data): Promise<BreakoutAnswer> =>
  answerBreakout(from, { case: "sc12_medium_lot", architectures, seed: SEED, ...extra } as Parameters<typeof answerBreakout>[1]);

describe("no actions: the answer is the answer of the code before P5c, byte for byte", () => {
  it.each([["absent", {}], ["an empty list", { actions: [] }]])("Given %s Then the answer hashes to the pin", async (_n, extra) => {
    expect(await digest(await ask(extra))).toBe(PIN);
  }, 120_000);
});

describe("with actions they are applied to the scenario of the case", () => {
  it("Given a maintenance window of AN-1 Then the answer is not the answer without it, and equals the answer for the case with the window written in by hand, deep", async () => {
    const withAction = await ask({ actions: [DOWN] });
    const handData = { ...data, breakout: { ...data.breakout!, scenarios: { ...data.breakout!.scenarios, sc12_medium_lot: patched(readJson<Json>("data", "scenarios", "sc12_medium_lot.json"), { fields: HAND }) } } };
    const byHand = await ask({}, ARCHS, handData);
    expect(withAction).toEqual(byHand);
    expect(await digest(withAction)).not.toBe(PIN);
  }, 180_000);

  it("Given a flag switched off on C Then the record of the answer is the derived architecture, named as the plant names it", async () => {
    const got = await ask({ actions: [{ kind: "set_flag", at: 464400, architecture: "c_context", flag: "audit_trail", on: false }] }, ["a_manual", "c_context"]);
    if (!got.ok) throw new Error(got.message);
    expect(got.result.architectures).toEqual(["a_manual", "c_context_minus_audit_trail"]);
    expect(got.result.per_architecture.map((a) => a.architecture)).toEqual(["a_manual", "c_context_minus_audit_trail"]);
  }, 180_000);
});

describe("the checks of the list, as plant_run makes them", () => {
  it.each([
    ["a list that is not a list", "down"],
    ["an entry that is not an object", [3]],
    ["an analyzer window with a length of zero", [{ ...DOWN, length_min: 0 }]],
  ])("Given %s Then it is invalid_spec", async (_n, actions) => {
    expect(await ask({ actions })).toMatchObject({ ok: false, code: "invalid_spec" });
  });

  it("Given a kind outside the table, a kind that acts on a record, a duplicate Then each is refused with its reason and the index of the entry", async () => {
    expect(await ask({ actions: [DOWN, { kind: "place_contamination", at: 464400, unit_id: "U01" }] })).toMatchObject({ ok: false, code: "refused", reason: "unknown_target", index: 1 });
    expect(await ask({ actions: [{ kind: "release", at: 464400 }] })).toMatchObject({ ok: false, code: "refused", reason: "closed_loop", index: 0 });
    expect(await ask({ actions: [DOWN, DOWN] })).toMatchObject({ ok: false, code: "refused", reason: "limit", index: 1 });
  });

  it("Given an action a rule of the run refuses Then it is refused with the reason and the index: an analyzer the case does not have, a window before the decision, a hall that is not named", async () => {
    expect(await ask({ actions: [{ ...DOWN, analyzer: "AN-9" }] })).toMatchObject({ ok: false, code: "refused", reason: "unknown_target", index: 0 });
    expect(await ask({ actions: [{ ...DOWN, from: 399960 }] })).toMatchObject({ ok: false, code: "refused", reason: "past", index: 0 });
    expect(await ask({ actions: [{ kind: "set_flag", at: 464400, architecture: "c_context", flag: "audit_trail", on: false }] }, ["a_manual"])).toMatchObject({ ok: false, code: "refused", reason: "unknown_target", index: 0 });
  });

  it("Given a capture path Then it is refused as unknown_target: the break-out records are made without the raw layer, and the action would be accepted and do nothing", async () => {
    const got = await ask({ actions: [{ kind: "set_capture_path", at: 464400, path: "adapter_ingest" }] });
    expect(got).toMatchObject({ ok: false, code: "refused", reason: "unknown_target", index: 0 });
    if (!got.ok) expect(got.message).toMatch(/raw layer/);
  });
});
