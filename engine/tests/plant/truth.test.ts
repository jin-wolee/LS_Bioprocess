import { beforeAll, describe, expect, it } from "vitest";
import { createChallenges } from "../../src/experiments/assembly/lab/challenges.ts";
import { runLineage } from "../../src/experiments/assembly/lab/lineage.ts";
import { runPlant } from "../../src/experiments/assembly/lab/plant.ts";
import type { PlantKept, PlantSpec } from "../../src/experiments/assembly/lab/plant.ts";
import type { ScenePlan } from "../../src/experiments/assembly/lab/plant_plan.ts";
import { answerPlantTruth, checkTruthPick } from "../../src/experiments/assembly/lab/plant_truth.ts";
import type { TruthOverlay } from "../../src/experiments/assembly/lab/plant_truth.ts";
import { labData } from "../support/lab_data.ts";
import { SMALL } from "../support/scenarios.ts";

// P5b (docs/design/plant_ui.md sections 3.3 and 6, rule 8): the truth overlay of the Worker, `plant_truth`, on the kept run. The overlay of a sample is the lineage view's own truth column and verdicts
// for the run the plant shows, with no recompute; the placeholders are the planned samples a hall holds no card for. The default scenario (seed 1, 24 reactors, A, B and C): 394 samples, A holds a
// card for 391 of them and none for U06-D09-1 (drawn at 807849 s), U13-D03-2 (297173 s) and U18-D03-1 (289110 s), where a label error keyed the rows of the sample to another sample; B and C hold
// a card for every one (the checks of P5a, engine/tests/plant/halls.test.ts). The run with a skipped draw is the small scenario in one bay of the mini-parallel profile (seed 1, 6 reactors, 8 days),
// which skips 9 of 45 draws on the volume cap (the profile's 4.8 % draw against a cap of 33 % of 12.5 mL, A057 and A207: six draws fit).

const HALLS = ["a_manual", "b_lims_lite", "c_context"];
const run = { schema_version: "1" as const, scenario: "default", settings: {}, architectures: HALLS, seeds: [1] };
const data = labData();
const challenges = createChallenges(data);
const NO_CARD = ["U06-D09-1", "U13-D03-2", "U18-D03-1"];

let whole: { plan: ScenePlan; kept: PlantKept };
let capped: { plan: ScenePlan; kept: PlantKept };
beforeAll(async () => {
  const a = await runPlant(data, { run, seed: 1, actions: [] } as unknown as PlantSpec);
  const b = await runPlant(data, { run: { ...run, settings: SMALL, bay_profiles: ["micro_mini_parallel"] }, seed: 1, actions: [] } as unknown as PlantSpec);
  if (!a.ok || !b.ok) throw new Error("the reference runs were refused");
  whole = { plan: a.answer.plan, kept: a.kept };
  capped = { plan: b.answer.plan, kept: b.kept };
}, 120_000);

const halls = (kept: PlantKept) => {
  const out = answerPlantTruth(kept, challenges, { halls: true });
  if (!out.ok || out.view.kind !== "halls") throw new Error(`halls expected, got ${JSON.stringify(out).slice(0, 200)}`);
  return out.view.halls;
};
const sampleView = (kept: PlantKept, sample_id: string): Extract<TruthOverlay, { kind: "sample" }> => {
  const out = answerPlantTruth(kept, challenges, { sample_id });
  if (!out.ok || out.view.kind !== "sample") throw new Error(`sample expected, got ${JSON.stringify(out).slice(0, 200)}`);
  return out.view;
};

describe("the overlay of a sample is the lineage view of the run the plant shows", () => {
  it.each(["U18-D03-1", "U07-D06-1", "U10-D03-1"])("Given %s Then the truth column, the three answers with their verdicts and the materialised errors equal the lineage view's, for A, B and C, deep", (id) => {
    const view = sampleView(whole.kept, id);
    const lineage = runLineage({ data, spec: run, seed: 1, pick: { sample_id: id } });
    if (!lineage.ok) throw new Error(lineage.message);
    expect(view.sample).toEqual(lineage.view.sample);
    expect(view.truth).toEqual(lineage.view.truth);
    expect(view.columns).toEqual(lineage.view.columns.map(({ architecture, answers, realised_errors }) => ({ architecture, answers, realised_errors })));
    expect(view.columns.map((c) => c.architecture)).toEqual(HALLS);
  }, 60_000);

  it("Given U18-D03-1, which A holds no card for Then the truth is U18 drawn at 289110 s; A answers the unit from its sample row (a sample row has no write stamp, so no card) and cannot answer the other two (preset A stores no sampled_at and holds no result to join a context to); A's list holds the label error that read the sample as U10-D03-1 (typed by hand)", () => {
    const view = sampleView(whole.kept, "U18-D03-1");
    expect(view.sample).toEqual({ sample_id: "U18-D03-1", unit_id: "U18", picked_by: "reader" });
    expect(view.truth.unit_id).toBe("U18");
    expect(view.truth.sampled_at).toBe(289110);
    const a = view.columns[0];
    expect(a?.answers.map((x) => [x.question, x.verdict])).toEqual([["unit", "correct"], ["sampled_at", "unanswerable"], ["process_context", "unanswerable"]]);
    expect(a?.realised_errors).toContainEqual({ type: "label_error", detail: { as_id: "U10-D03-1" } });
  });

  it("Given the overlay of a sample Then it carries no node and no edge of the record (plant_record has them) and no key but the lineage view's", () => {
    const view = sampleView(whole.kept, "U07-D06-1");
    expect(Object.keys(view).sort()).toEqual(["columns", "kind", "sample", "truth"]);
    expect(Object.keys(view.columns[0] as object).sort()).toEqual(["answers", "architecture", "realised_errors"]);
  });

  it("Given only the halls built so far Then the overlay answers for those (the order of the spec) and the others are simply not in it", () => {
    const some: PlantKept = { ...whole.kept, halls: new Map([...whole.kept.halls].slice(0, 2)) };
    expect(sampleView(some, "U07-D06-1").columns.map((c) => c.architecture)).toEqual(["a_manual", "b_lims_lite"]);
  });
});

describe("the placeholders: the planned samples a hall holds no card for", () => {
  it("Given the default run Then A has a placeholder for each of the three samples it holds no card for, as not recorded, in the order of the plan; B and C have none", () => {
    const got = halls(whole.kept);
    expect(got.map((h) => h.architecture)).toEqual(HALLS);
    const index = (id: string) => whole.plan.samples.findIndex((s) => s.id === id);
    expect(got[0]?.placeholders).toEqual(NO_CARD.map((id) => ({ sample: index(id), why: "not_recorded" })));
    expect(got[1]?.placeholders).toEqual([]);
    expect(got[2]?.placeholders).toEqual([]);
  });

  it("Given every hall of the default run Then a placeholder stands exactly where the plant drew a sample and the plan has no card for it, none where it has one, read from the plan and from the rows of the dataset", () => {
    const got = halls(whole.kept);
    for (const hall of got) {
      const record = whole.plan.records.find((r) => r.architecture === hall.architecture);
      const cards = new Set(record?.cards.map((c) => c.sample));
      const ds = whole.kept.halls.get(hall.architecture)?.dataset;
      const expected = whole.plan.samples.flatMap((s, i) => (s.drawn_s !== null && !cards.has(i) ? [i] : []));
      expect(hall.placeholders.map((p) => p.sample), hall.architecture).toEqual(expected);
      for (const p of hall.placeholders) {
        const id = whole.plan.samples[p.sample]?.id;
        expect(cards.has(p.sample), `${hall.architecture} ${id}`).toBe(false);
        // the record really holds no run and no result of it
        expect(ds?.run.some((r) => r.request_id === id) || ds?.result.some((r) => r.request_id === id), `${hall.architecture} ${id}`).toBe(false);
      }
    }
  });

  it("Given a run that skips 9 of 45 draws on the volume cap Then every hall has a placeholder for each skipped draw, as skipped, and none for the 36 samples it holds a card of", () => {
    const skipped = capped.plan.samples.flatMap((s, i) => (s.skipped ? [i] : []));
    expect(skipped).toHaveLength(9);
    expect(capped.kept.events.filter((e) => e.type === "draw_skipped_volume_budget")).toHaveLength(9); // the truth log says the same
    expect(capped.plan.samples.filter((s) => s.skipped).map((s) => s.id)).toEqual([
      "U01-D05-1", "U02-D04-1", "U02-D05-1", "U03-D05-1", "U04-D05-1", "U05-D04-1", "U05-D05-1", "U06-D05-1", "U06-D06-1",
    ]);
    for (const hall of halls(capped.kept)) {
      expect(hall.placeholders, hall.architecture).toEqual(skipped.map((sample) => ({ sample, why: "skipped" })));
      expect(capped.plan.records.find((r) => r.architecture === hall.architecture)?.cards, hall.architecture).toHaveLength(36);
    }
  });

  it("Given a placeholder Then the instant it stands at is the plant's draw of that sample (the plan's drawn_s), always known", () => {
    for (const hall of halls(capped.kept)) for (const p of hall.placeholders) expect(capped.plan.samples[p.sample]?.drawn_s).not.toBeNull();
    expect(capped.plan.samples[capped.plan.samples.findIndex((s) => s.id === "U01-D05-1")]?.drawn_s).toBe(464165);
  });
});

describe("the request is checked", () => {
  it.each([
    ["no pick", undefined],
    ["a pick of no kind", {}],
    ["a sample id that is not a string", { sample_id: 3 }],
    ["halls that is not true", { halls: false }],
    ["a pick of the sample and the halls together", { sample_id: "U01-D06-1", halls: true }],
    ["a pick of a unit (not offered yet: no lab function gives the truth of a unit)", { unit_id: "U01" }],
    ["a break-out that is not true (P7b offers the pick of a case)", { breakout: false }],
    ["a pick of the break-out and the halls together", { breakout: true, halls: true }],
  ])("Given %s Then checkTruthPick refuses it as invalid", (_, pick) => {
    const out = checkTruthPick(pick);
    expect(out.ok).toBe(false);
  });

  it("Given a sample id, the halls or the break-out Then the pick is accepted", () => {
    expect(checkTruthPick({ sample_id: "U01-D06-1" })).toEqual({ ok: true, pick: { sample_id: "U01-D06-1" } });
    expect(checkTruthPick({ halls: true })).toEqual({ ok: true, pick: { halls: true } });
    expect(checkTruthPick({ breakout: true })).toEqual({ ok: true, pick: { breakout: true } });
  });

  it("Given the pick of the break-out on a run that is not a break-out case Then it is refused as unknown_target (P7b): there is no event to show", () => {
    const out = answerPlantTruth(whole.kept, challenges, { breakout: true });
    expect(out).toMatchObject({ ok: false, code: "refused", reason: "unknown_target" });
  });

  it("Given a sample the run did not draw, or a draw that was skipped Then it is refused as unknown_target", () => {
    for (const [kept, id] of [[whole.kept, "U99-D99-9"], [capped.kept, "U01-D05-1"]] as const) {
      const out = answerPlantTruth(kept, challenges, { sample_id: id });
      expect(out.ok).toBe(false);
      if (!out.ok) expect(out).toMatchObject({ code: "refused", reason: "unknown_target" });
    }
  });

  it("Given a challenge open on the run of the plan Then both picks are locked; once it is revealed they are answered", async () => {
    const small = await runPlant(data, { run: { ...run, settings: SMALL }, seed: 41, actions: [] } as unknown as PlantSpec);
    if (!small.ok) throw new Error("refused");
    const own = createChallenges(data);
    expect(answerPlantTruth(small.kept, own, { halls: true }).ok).toBe(true);
    const started = own.start({ variant: "sample", spec: { ...run, settings: SMALL, architectures: [], seeds: [41] }, seed: 41, shown: "a_manual" });
    if (!started.ok) throw new Error(started.message);
    for (const pick of [{ halls: true as const }, { sample_id: "U01-D06-1" }]) expect(answerPlantTruth(small.kept, own, pick)).toMatchObject({ ok: false, code: "locked" });
    own.finish(started.challenge, null);
    expect(answerPlantTruth(small.kept, own, { halls: true }).ok).toBe(true);
  }, 120_000);

  it("Given a challenge on another seed Then the overlay of this run is not locked", async () => {
    const own = createChallenges(data);
    const started = own.start({ variant: "sample", spec: { ...run, settings: SMALL, architectures: [], seeds: [43] }, seed: 43, shown: "a_manual" });
    if (!started.ok) throw new Error(started.message);
    expect(answerPlantTruth(whole.kept, own, { halls: true }).ok).toBe(true);
  }, 120_000);
});
