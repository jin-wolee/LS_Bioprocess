import { beforeAll, describe, expect, it } from "vitest";
import { createChallenges } from "../../src/experiments/assembly/lab/challenges.ts";
import { runLineage } from "../../src/experiments/assembly/lab/lineage.ts";
import { answerLineage } from "../../src/experiments/assembly/lab/lineage_request.ts";
import type { LineageAnswer } from "../../src/experiments/assembly/lab/lineage_request.ts";
import { runPlant } from "../../src/experiments/assembly/lab/plant.ts";
import type { PlantKept, PlantSpec } from "../../src/experiments/assembly/lab/plant.ts";
import { answerPlantTruth } from "../../src/experiments/assembly/lab/plant_truth.ts";
import { canonicalJson, sha256Hex } from "../../src/trace.ts";
import { labData } from "../support/lab_data.ts";
import { readJson } from "../support/paths.ts";
import { SMALL, patched, rawScenario } from "../support/scenarios.ts";
import type { Json } from "../support/schemas.ts";

// P5c (docs/design/plant_ui.md section 6, rule 9): the `actions` field of the `lineage` request. With none, or an empty list, the answer is byte for byte the answer of the code before P5c (the pins below
// were taken from HEAD a32d9a7 with a script kept outside the repository: the SHA-256 of the canonical JSON of the whole answer). With actions, the lineage view of a sample is made from the run the
// plant shows: it equals the truth overlay of the same sample for the same plant run, and it equals the lab's own lineage path on a scenario with the action written in by hand (the fixture
// tests/fixtures/plant/add_feed.json: a feed on U03 on day 3 at 09:00, 291,600 s, which the sample U03-D03-1 drawn at 305,626 s sees as one feed more in its true context). Expected values are typed.

const data = labData();
const HALLS = ["a_manual", "b_lims_lite", "c_context"];
const run = { schema_version: "1" as const, scenario: "default", settings: {}, architectures: HALLS, seeds: [1] };
const small = { ...run, settings: SMALL };
const FEED = { kind: "add_feed", at: 291600, unit_id: "U03" };

const PIN_DEFAULT = "09770ca95857d70b01c1d57199e9f0637ea2b0f544c8102cde9e9b26cf53e0dd"; // default scenario, seed 1, A, B and C, the sample U10-D03-1
const PIN_RULE = "66ae6d9a4e7e52172a995ce9c97934f9cfa482662b6891c242b1f0db99a4e1f2"; // sc03_feed_in_gap, seed 1, A, B and C, the pick rule

const digest = (a: unknown): Promise<string> => sha256Hex(canonicalJson(a));
const ask = (extra: Record<string, unknown>, spec: unknown = small, challenges = createChallenges(data), pick: unknown = { sample_id: "U03-D03-1" }, seed = 1): LineageAnswer =>
  answerLineage(data, challenges, { spec, seed, pick, ...extra } as Parameters<typeof answerLineage>[2]);
const view = (a: LineageAnswer) => {
  if (!a.ok) throw new Error(`refused: ${a.code} ${a.message}`);
  return a.view;
};

describe("no actions: the answer is the answer of the code before P5c, byte for byte", () => {
  it.each([["absent", {}], ["an empty list", { actions: [] }]])("Given %s Then the default scenario's view of U10-D03-1 and the SC3 rule's view hash to the pins", async (_n, extra) => {
    expect(await digest(ask(extra, run, undefined, { sample_id: "U10-D03-1" }))).toBe(PIN_DEFAULT);
    expect(await digest(ask(extra, { ...run, scenario: "sc03_feed_in_gap" }, undefined, { rule: "sc3" }))).toBe(PIN_RULE);
  }, 120_000);
});

describe("with actions the view is made from the run the plant shows", () => {
  const hand = readJson<{ actions: unknown[]; hand: { scenario_fields: Json } }>("tests", "fixtures", "plant", "add_feed.json");
  let truthOnly: PlantKept;
  let fed: PlantKept;
  beforeAll(async () => {
    const a = await runPlant(data, { run: small, seed: 1, actions: [] } as unknown as PlantSpec);
    const b = await runPlant(data, { run: small, seed: 1, actions: [FEED] } as unknown as PlantSpec);
    if (!a.ok || !b.ok) throw new Error("the reference runs were refused");
    truthOnly = a.kept;
    fed = b.kept;
  }, 120_000);

  it("Given the feed on U03 Then the sample drawn after it has one feed more in its true context than in the run without it (typed: 0 and 1)", () => {
    expect(view(ask({})).truth.context).toEqual({ feed_epoch: 0, batch_phase: "before_shift" });
    expect(view(ask({ actions: [FEED] })).truth.context).toEqual({ feed_epoch: 1, batch_phase: "before_shift" });
  }, 120_000);

  it("Given the feed Then the view equals the lab's own lineage path on the scenario with the feed written in by hand, deep", () => {
    const handData = { ...data, scenarios: { ...data.scenarios, default: patched(rawScenario("default"), { fields: hand.hand.scenario_fields }) } };
    const byHand = runLineage({ data: handData, spec: small, seed: 1, pick: { sample_id: "U03-D03-1" } });
    if (!byHand.ok) throw new Error(byHand.message);
    const got = ask({ actions: hand.actions });
    expect(got).toEqual({ ok: true, view: byHand.view, sample_ids: byHand.sample_ids });
  }, 120_000);

  it.each([["an actionless run", () => truthOnly, [] as unknown[]], ["a run with a feed", () => fed, [FEED]]])("Given %s Then the lineage view of a sample equals the truth overlay of that sample for the same plant run (the sample, the truth, and per hall the answers and the materialised errors)", (_n, kept, actions) => {
    const overlay = answerPlantTruth(kept(), createChallenges(data), { sample_id: "U03-D03-1" });
    if (!overlay.ok || overlay.view.kind !== "sample") throw new Error("a sample overlay expected");
    const lineage = view(ask({ actions }));
    expect(overlay.view.sample).toEqual(lineage.sample);
    expect(overlay.view.truth).toEqual(lineage.truth);
    expect(overlay.view.columns).toEqual(lineage.columns.map(({ architecture, answers, realised_errors }) => ({ architecture, answers, realised_errors })));
  }, 120_000);

});

describe("the checks of the list, in the order of plant_run", () => {
  const refused = (actions: unknown, extra: Record<string, unknown> = {}) => ask({ actions, ...extra });

  it.each([
    ["a list that is not a list", "feed", "actions must be a list"],
    ["an entry that is not an object", [5], "actions[0] must be an object"],
    ["a feed with an instant that is not a whole minute", [{ kind: "add_feed", at: 61, unit_id: "U03" }], "actions[0].at must be a whole minute"],
    ["a key the kind does not have", [{ kind: "add_feed", at: 291600, unit_id: "U03", extra: 1 }], 'actions[0]: unknown key "extra" for add_feed'],
  ])("Given %s Then it is invalid_spec naming the entry", (_n, actions, message) => {
    const got = refused(actions);
    expect(got).toMatchObject({ ok: false, code: "invalid_spec" });
    if (!got.ok) expect(got.message).toContain(message);
  });

  it("Given a kind outside the table Then it is refused as unknown_target with the index of the entry, and a kind that acts on a recorded result as closed_loop", () => {
    expect(refused([FEED, { kind: "place_contamination", at: 291600, unit_id: "U03" }])).toMatchObject({ ok: false, code: "refused", reason: "unknown_target", index: 1 });
    expect(refused([{ kind: "hold", at: 291600 }])).toMatchObject({ ok: false, code: "refused", reason: "closed_loop", index: 0 });
  });

  it("Given a duplicate and a seventeenth action Then both are refused as limit, at their own index", () => {
    expect(refused([FEED, FEED])).toMatchObject({ ok: false, code: "refused", reason: "limit", index: 1 });
    const many = Array.from({ length: 17 }, (_, i) => ({ kind: "add_feed", at: 291600 + 60 * i, unit_id: "U03" }));
    expect(refused(many)).toMatchObject({ ok: false, code: "refused", reason: "limit", index: 16 });
  });

  it("Given an action a rule of the run refuses Then it is refused with the reason and the index as entered: a unit the run does not have, a feed at the end of the run, an analyzer it does not have, a hall it does not have", () => {
    expect(refused([{ kind: "add_feed", at: 291600, unit_id: "U99" }])).toMatchObject({ ok: false, code: "refused", reason: "unknown_target", index: 0 });
    expect(refused([FEED, { kind: "add_feed", at: 8 * 86400, unit_id: "U03" }])).toMatchObject({ ok: false, code: "refused", reason: "outside_window", index: 1 });
    expect(refused([{ kind: "analyzer_down", at: 291600, analyzer: "AN-9", from: 306000, length_min: 120 }])).toMatchObject({ ok: false, code: "refused", reason: "unknown_target", index: 0 });
    expect(refused([{ kind: "set_flag", at: 291600, architecture: "d_unknown", flag: "audit_trail", on: false }])).toMatchObject({ ok: false, code: "refused", reason: "unknown_target", index: 0 });
    const got = refused([{ kind: "add_feed", at: 291600, unit_id: "U99" }]);
    if (!got.ok && got.code === "refused") expect(got.message).toContain("actions[0]");
  });

  it("Given a challenge open on the run Then a valid list is locked, a list that breaks a bound is locked too (the lock is asked before the bounds), and a malformed list is still invalid_spec (the shape is asked first)", () => {
    const challenges = createChallenges(data);
    const started = challenges.start({ variant: "sample", spec: { ...small, architectures: [], seeds: [41] }, seed: 41, shown: "a_manual" });
    if (!started.ok) throw new Error(started.message);
    const locked = (actions: unknown) => ask({ actions }, small, challenges, { sample_id: "U01-D06-1" }, 41);
    expect(locked([FEED])).toMatchObject({ ok: false, code: "locked" });
    expect(locked([{ kind: "add_feed", at: 291600, unit_id: "U99" }])).toMatchObject({ ok: false, code: "locked" });
    expect(locked("feed")).toMatchObject({ ok: false, code: "invalid_spec" });
    challenges.finish(started.challenge, null);
    expect(locked([FEED])).not.toMatchObject({ code: "locked" });
  }, 120_000);

  it("Given a sample the run does not hold Then the answer is the same refusal as without actions", () => {
    const a = ask({ actions: [FEED] }, small, undefined, { sample_id: "U99-D99-9" });
    const b = ask({}, small, undefined, { sample_id: "U99-D99-9" });
    expect(a).toEqual(b);
    expect(a).toMatchObject({ ok: false, code: "invalid_spec" });
  }, 120_000);
});
