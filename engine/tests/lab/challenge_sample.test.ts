import { beforeAll, describe, expect, it } from "vitest";
import { openSample, revealSample, startSampleChallenge } from "../../src/experiments/assembly/lab/challenge_sample.ts";
import type { SampleChallenge } from "../../src/experiments/assembly/lab/challenge_sample.ts";
import type { RecordView, Reveal } from "../../src/experiments/assembly/lab/challenge_types.ts";
import type { RunSpec } from "../../src/experiments/assembly/lab/spec.ts";
import { DRAWN_TYPES } from "../../src/inject/types.ts";
import { labData } from "../support/lab_data.ts";
import { LABEL_CELLS, REKEY_CELLS, REPLAY_CELLS } from "../support/cell_tables.ts";
import { SMALL } from "../support/scenarios.ts";

// S3e, the sample variant of the challenge (docs/design/lab_ui.md section 9). The world is the small variant of the default scenario (6 reactors, 8 days). The expected outcomes of the
// reveal are the hand-typed cells of S2 (cell_tables.ts: A, B, C, then C minus a flag, in the order of the flag table); the scoring rules and the leaks are typed from section 9.

const data = labData();
const spec: RunSpec = { schema_version: "1", scenario: "default", settings: SMALL, architectures: [], seeds: [41] };
const SEED = 41;

const started = (shown: string, seed = SEED): { challenge: SampleChallenge; announced_type: string; record: RecordView } => {
  const out = startSampleChallenge(data, spec, seed, shown);
  if (!out.ok) throw new Error(`refused: ${out.message}`);
  return out;
};
const names = (reveal: Reveal): string[] => reveal.per_architecture.map((p) => p.architecture);
const outcomes = (reveal: Reveal): string[] => reveal.per_architecture.map((p) => p.outcome + (p.evidence.length ? `:${p.evidence.join("+")}` : ""));

// every key at any depth of a plain value
const keysDeep = (v: unknown): string[] => (Array.isArray(v) ? v.flatMap(keysDeep) : typeof v === "object" && v !== null ? Object.entries(v).flatMap(([k, x]) => [k, ...keysDeep(x)]) : []);

describe("A label error shown in C minus system_issued_id (the only type that record does not prevent)", () => {
  const SHOWN = "c_context_minus_system_issued_id";
  let s: ReturnType<typeof started>;
  beforeAll(() => {
    s = started(SHOWN);
  }, 120_000);

  it("Given the start Then the announced type is a label error and the record is the shown architecture's rows only", () => {
    expect(s.announced_type).toBe("label_error");
    expect(s.record.architecture).toBe(SHOWN);
    expect(s.record.samples.length).toBeGreaterThan(20);
    expect(s.record.results.length).toBeGreaterThan(s.record.samples.length);
    expect(s.record.flags_on).not.toContain("system_issued_id");
    expect(s.record.flags_on).toHaveLength(9);
  });

  it("Given the same seed twice Then the same plant and the same record (the plant is a function of the seed)", () => {
    const again = started(SHOWN);
    expect(again.challenge.plant).toEqual(s.challenge.plant);
    expect(again.record).toEqual(s.record);
  }, 60_000);

  it("Then the run holds the planted error and no other drawn error (forced mode reads no rate); the structural errors stay as they are", () => {
    const realised = s.challenge.materialised.filter((m) => (DRAWN_TYPES as readonly string[]).includes(m.type));
    expect(realised).toEqual([{ type: "label_error", sample_id: s.challenge.plant.sample_id, detail: { as_id: s.challenge.plant.detail?.as_id } }]);
  });

  it("Then nothing the page receives before the guess names the plant: no planted, reveal, affected, detail, realised or materialised key, and every row of a table has the same keys", () => {
    const keys = keysDeep({ announced_type: s.announced_type, record: s.record });
    for (const forbidden of ["planted", "reveal", "affected", "detail", "realised_errors", "materialised", "plant", "score"]) expect(keys, forbidden).not.toContain(forbidden);
    for (const table of [s.record.samples, s.record.results, s.record.findings, s.record.audit_events]) {
      const shapes = new Set(table.map((row) => Object.keys(row).join(",")));
      expect(shapes.size).toBeLessThanOrEqual(1);
    }
  });

  it("Given a sample to open Then the drill-down is that record's column of section 8 with no truth, no verdict and no realised error", () => {
    const column = openSample(s.challenge, s.challenge.plant.sample_id);
    expect(column && Object.keys(column).sort()).toEqual(["architecture", "edges", "flags_on", "labelling", "nodes"]);
    expect(column?.architecture).toBe(SHOWN);
    expect(column?.nodes.some((n) => n.table === "sample")).toBe(true);
    expect(openSample(s.challenge, "U99-D99-9")).toBeNull();
  });

  it("Given a guess of the planted sample Then it is a hit, and the reveal names the type, the two samples (the planted and the neighbour whose id the label read) and the id the label read", () => {
    const reveal = revealSample(s.challenge, s.challenge.plant.sample_id);
    expect(reveal.score).toEqual({ result: "hit" });
    expect(reveal.planted).toEqual({ type: "label_error", affected: [s.challenge.plant.sample_id, s.challenge.plant.detail?.as_id], detail: { as_id: s.challenge.plant.detail?.as_id } });
  });

  it("Given a guess of the neighbour whose id the label read Then it is a hit too (the mixed-up pair is the affected set)", () => {
    expect(revealSample(s.challenge, s.challenge.plant.detail?.as_id as string).score).toEqual({ result: "hit" });
  });

  it("Given a guess of a sample that is not affected and has no structural error Then it is a miss", () => {
    const structural = new Set(s.challenge.materialised.filter((m) => !(DRAWN_TYPES as readonly string[]).includes(m.type)).map((m) => m.sample_id));
    const affected = new Set([s.challenge.plant.sample_id, s.challenge.plant.detail?.as_id]);
    const other = s.record.samples.find((x) => !structural.has(x.sample_id) && !affected.has(x.sample_id));
    expect(other).toBeDefined();
    expect(revealSample(s.challenge, (other as { sample_id: string }).sample_id).score).toEqual({ result: "miss" });
  });

  it("Given a give-up Then the reveal comes with no score", () => {
    const reveal = revealSample(s.challenge, null);
    expect(reveal.score).toBeNull();
    expect(reveal.planted.type).toBe("label_error");
  });

  it("Then the reveal covers A, B, C and the shown ablation, and the outcomes equal the hand-typed cells of the label error (A, B, C, C minus system_issued_id)", () => {
    const reveal = revealSample(s.challenge, null);
    expect(names(reveal)).toEqual(["a_manual", "b_lims_lite", "c_context", SHOWN]);
    expect(outcomes(reveal)).toEqual([LABEL_CELLS[0], LABEL_CELLS[1], LABEL_CELLS[2], LABEL_CELLS[3]]);
    expect(reveal.per_architecture.map((p) => p.reading)).toEqual(["flag.system_issued_id.off", "flag.system_issued_id.on", "flag.system_issued_id.on", "flag.system_issued_id.off"]);
  });

  it("Then the reveal's lineage is the three-column view of the planted sample with the truth column and the verdicts", () => {
    const reveal = revealSample(s.challenge, null);
    expect(reveal.lineage.sample).toEqual({ sample_id: s.challenge.plant.sample_id, unit_id: expect.any(String), picked_by: "challenge" });
    expect(reveal.lineage.columns.map((c) => c.architecture)).toEqual(names(reveal));
    expect(reveal.lineage.columns[0]?.answers.map((a) => a.verdict)).toEqual(expect.arrayContaining(["correct"]));
    expect(reveal.decisions).toBeUndefined();
  });
});

// The author's ruling of 2026-10-30 (docs/design/lab_ui.md section 9, "모든 시료에 있는 유형은 빼기"): a structural type that the shown record carries on every one of its samples tells no sample from
// another, so it is not `background`; the record names it once (`RecordView.ubiquitous`). The expectations are typed from the flag table: with audit_trail off (A) the operator is absent for every
// sample, so every sample carries the type unattributable_record; B stores a plan for each sample, so each carries planned_vs_actual; a record with every flag of C but one has no structural type
// on every sample.
const structuralOf = (s: ReturnType<typeof started>, id: string): string[] => s.challenge.materialised.filter((m) => m.sample_id === id && !(DRAWN_TYPES as readonly string[]).includes(m.type)).map((m) => m.type);
const unaffected = (s: ReturnType<typeof started>, id: string): boolean => id !== s.challenge.plant.sample_id && id !== s.challenge.plant.detail?.as_id;

describe("A guess on a structural error of the shown record", () => {
  it("Given A shown (audit_trail is off, so every sample is unattributable) Then the record names that one type as on every sample", () => {
    expect(started("a_manual").record.ubiquitous).toEqual(["unattributable_record"]);
  }, 60_000);

  it("Given A and a guess that is not affected on a sample whose only structural error is the unattributable record Then it is a miss, not background", () => {
    const s = started("a_manual");
    const plain = s.record.samples.find((x) => unaffected(s, x.sample_id) && structuralOf(s, x.sample_id).join() === "unattributable_record");
    expect(plain, "a sample with only the by-construction error of A").toBeDefined();
    expect(revealSample(s.challenge, (plain as { sample_id: string }).sample_id).score).toEqual({ result: "miss" });
  }, 60_000);

  it("Given A and a guess that is not affected on a sample that also carries a lost rerun (a type not on every sample) Then it is background and the reveal names the lost rerun", () => {
    const s = started("a_manual");
    const rerun = s.record.samples.find((x) => unaffected(s, x.sample_id) && structuralOf(s, x.sample_id).includes("lost_rerun"));
    expect(rerun, "a sample of A with a lost rerun").toBeDefined();
    expect(revealSample(s.challenge, (rerun as { sample_id: string }).sample_id).score).toEqual({ result: "background", background_type: "lost_rerun" });
  }, 60_000);

  it("Given B shown (a plan is stored for every sample) Then the record names planned_vs_actual, a sample with only that is a miss, and a sample with a lost rerun is background", () => {
    const s = started("b_lims_lite");
    expect(s.record.ubiquitous).toEqual(["planned_vs_actual"]);
    const only = s.record.samples.find((x) => unaffected(s, x.sample_id) && structuralOf(s, x.sample_id).join() === "planned_vs_actual");
    expect(only, "a sample of B with only the plan").toBeDefined();
    expect(revealSample(s.challenge, (only as { sample_id: string }).sample_id).score).toEqual({ result: "miss" });
    const rerun = s.record.samples.find((x) => unaffected(s, x.sample_id) && structuralOf(s, x.sample_id).includes("lost_rerun"));
    expect(rerun, "a sample of B with a lost rerun").toBeDefined();
    expect(revealSample(s.challenge, (rerun as { sample_id: string }).sample_id).score).toEqual({ result: "background", background_type: "lost_rerun" });
  }, 60_000);

  it("Given C minus a flag shown (its structural errors are prevented or on some samples only) Then the record names no type as on every sample", () => {
    expect(started("c_context_minus_system_issued_id").record.ubiquitous).toEqual([]);
    expect(started("c_context_minus_ingest_idempotency").record.ubiquitous).toEqual([]);
  }, 60_000);
});

describe("The other drawn types", () => {
  it("Given a re-key shown in B Then A, B and C read invisible, invisible, prevented (typed cells), and the sample is on a unit the record names differently", () => {
    const s = started("b_lims_lite");
    expect(s.announced_type).toBe("unit_rekey");
    const reveal = revealSample(s.challenge, null);
    expect(names(reveal)).toEqual(["a_manual", "b_lims_lite", "c_context"]);
    expect(outcomes(reveal)).toEqual([REKEY_CELLS[0], REKEY_CELLS[1], REKEY_CELLS[2]]);
    expect(reveal.planted.type).toBe("unit_rekey");
    expect(reveal.planted.affected).toEqual([s.challenge.plant.sample_id]);
    expect(Object.keys(reveal.planted.detail).sort()).toEqual(["from_unit", "to_unit"]);
    const row = s.record.samples.find((x) => x.sample_id === s.challenge.plant.sample_id);
    expect(row?.unit_id).toBe(reveal.planted.detail.to_unit); // the record holds the unit the label named
  }, 60_000);

  it("Given a replay shown in C minus ingest_idempotency Then A, B and C read invisible, prevented, prevented and the ablation invisible (typed cells)", () => {
    const s = started("c_context_minus_ingest_idempotency");
    expect(s.announced_type).toBe("duplicate_replay");
    const reveal = revealSample(s.challenge, null);
    expect(outcomes(reveal)).toEqual([REPLAY_CELLS[0], REPLAY_CELLS[1], REPLAY_CELLS[2], REPLAY_CELLS[9]]);
    expect(reveal.per_architecture[3]?.reading).toBe("flag.ingest_idempotency.off");
    const twice = s.record.results.filter((r) => r.request_id === s.challenge.plant.sample_id);
    expect(twice.length).toBeGreaterThan(new Set(twice.map((r) => `${r.analyte}/${r.version}`)).size); // the record holds a result row twice
  }, 60_000);

  it("Given C itself Then there is nothing to plant and the start is refused with the reason", () => {
    const out = startSampleChallenge(data, spec, SEED, "c_context");
    expect(out).toEqual({ ok: false, message: expect.stringMatching(/every drawn type is prevented/) });
  });
});
