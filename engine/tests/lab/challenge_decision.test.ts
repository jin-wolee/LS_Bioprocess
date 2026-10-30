import { beforeAll, describe, expect, it } from "vitest";
import { openDecisionSample, revealDecision, startDecisionChallenge } from "../../src/experiments/assembly/lab/challenge_decision.ts";
import type { DecisionChallenge } from "../../src/experiments/assembly/lab/challenge_decision.ts";
import type { DecisionRecordView, Reveal } from "../../src/experiments/assembly/lab/challenge_types.ts";
import { decisionTruth, differingDecisions } from "../../src/experiments/assembly/lab/decisions.ts";
import type { RunSpec } from "../../src/experiments/assembly/lab/spec.ts";
import { LABEL_CELLS } from "../support/cell_tables.ts";
import { DECISION_SCENARIO, DECISION_SMALL, decisionData } from "./decision_data.ts";
import { labData } from "../support/lab_data.ts";

// S3e, the decision variant of the challenge (docs/design/lab_ui.md section 9, "The decision variant"). The world is the small SC8 with the technique probability at 0.5, seed 3, the world
// whose decisions decisions.test.ts types by hand (U01@201600 reads the row of U01-D01-2, a closed sample; U03@203400 reads U03-D01-2, an open one, and skips). The plant is the function of
// the seed that S3d tested; here the rules of the batch are typed from section 9: the affected set, the score, the reveal and what the page may receive before the guess.

const data = decisionData();
const spec: RunSpec = { schema_version: "1", scenario: DECISION_SCENARIO, settings: DECISION_SMALL, architectures: [], seeds: [3] };
const SEED = 3;
const A = "a_manual";
const C_MINUS = "c_context_minus_system_issued_id";

const started = (shown: string): { challenge: DecisionChallenge; announced_type: string; record: DecisionRecordView } => {
  const out = startDecisionChallenge(data, spec, SEED, shown);
  if (!out.ok) throw new Error(`refused: ${out.message}`);
  return out;
};
const keysDeep = (v: unknown): string[] => (Array.isArray(v) ? v.flatMap(keysDeep) : typeof v === "object" && v !== null ? Object.entries(v).flatMap(([k, x]) => [k, ...keysDeep(x)]) : []);
const outcomes = (r: Reveal): string[] => r.per_architecture.map((p) => p.outcome + (p.evidence.length ? `:${p.evidence.join("+")}` : ""));

describe("The decision variant shown in A", () => {
  let s: ReturnType<typeof started>;
  beforeAll(() => {
    s = started(A);
  }, 120_000);

  it("Given the start Then the label error is announced and the record is A's decisions in time order, one per reactor and readjustment tick, with the samples that have a pH result", () => {
    expect(s.announced_type).toBe("label_error");
    expect(s.record.architecture).toBe(A);
    expect(s.record.decisions).toHaveLength(36); // six reactors, six readjustment ticks each (decisions.test.ts)
    expect(s.record.decisions.map((d) => d.t)).toEqual([...s.record.decisions.map((d) => d.t)].sort((x, y) => x - y));
    expect(s.record.decisions.every((d) => d.decision_id === `${d.unit_id}@${d.t}`)).toBe(true);
    expect(s.record.samples.length).toBeGreaterThan(10);
    for (const d of s.record.decisions) expect(d.action === "none", d.decision_id).toBe(d.read === null);
  });

  it("Then the decision list carries what the record holds and nothing of truth: no result_id, no true pH, no plant, no affected set", () => {
    const keys = keysDeep({ announced_type: s.announced_type, record: s.record });
    for (const forbidden of ["result_id", "planted", "reveal", "affected", "plant", "detail", "truth", "from_sample", "materialised", "score"]) expect(keys, forbidden).not.toContain(forbidden);
    for (const table of [s.record.decisions, s.record.samples, s.record.findings]) expect(new Set(table.map((row) => Object.keys(row).join(","))).size).toBeLessThanOrEqual(2); // read is null or an object: the keys of the row are the same
  });

  it("Given the same seed twice Then the same plant and the same record", () => {
    const again = started(A);
    expect(again.challenge.plant).toEqual(s.challenge.plant);
    expect(again.record).toEqual(s.record);
  }, 60_000);

  it("Then the plant is a label error on a sample whose row a decision of the unplanted loop reads, and the planted loop changes the decision that read it (S3d)", () => {
    expect(s.challenge.plant.type).toBe("label_error");
    const reader = s.challenge.unplanted.decisions.filter((d) => decisionTruth(s.challenge.unplanted, d.decision_id)?.from_sample === s.challenge.plant.sample_id).map((d) => d.decision_id);
    expect(reader.length).toBeGreaterThan(0);
    expect(differingDecisions(s.challenge.unplanted.decisions, s.challenge.planted.decisions)).toEqual(expect.arrayContaining(reader));
  });

  it("Then the affected set is the decisions that differ from the unplanted loop plus those that read a row of the planted sample or of the neighbour (by the id it is filed under or the sample it stands for)", () => {
    const pair = new Set([s.challenge.plant.sample_id, s.challenge.plant.detail?.as_id]);
    const differing = new Set(differingDecisions(s.challenge.unplanted.decisions, s.challenge.planted.decisions));
    const want = s.challenge.planted.decisions
      .filter((d) => differing.has(d.decision_id) || (d.read !== null && (pair.has(d.read.filed_under) || pair.has(decisionTruth(s.challenge.planted, d.decision_id)?.from_sample))))
      .map((d) => d.decision_id);
    expect(s.challenge.affected).toEqual(want);
    expect(s.challenge.affected.length).toBeGreaterThan(0);
  });

  it("Given a guess of an affected decision Then it is a hit", () => {
    expect(revealDecision(s.challenge, s.challenge.affected[0] as string).score).toEqual({ result: "hit" });
  });

  it("Given a guess of a decision that read no row Then it is a miss (nothing to rest on)", () => {
    const none = s.record.decisions.find((d) => d.action === "none" && !s.challenge.affected.includes(d.decision_id));
    expect(none).toBeDefined();
    expect(revealDecision(s.challenge, (none as { decision_id: string }).decision_id).score).toEqual({ result: "miss" });
  });

  it("Given A, where audit_trail is off and every sample is unattributable by construction Then a guess of an unaffected decision that read a row is background and the reveal names that type", () => {
    const read = s.record.decisions.find((d) => d.read !== null && !s.challenge.affected.includes(d.decision_id));
    expect(read).toBeDefined();
    expect(revealDecision(s.challenge, (read as { decision_id: string }).decision_id).score).toEqual({ result: "background", background_type: "unattributable_record" });
  });

  it("Given a give-up Then no score", () => {
    expect(revealDecision(s.challenge, null).score).toBeNull();
  });

  it("Then the reveal's decisions part has, for each affected decision that read a row, the id it was filed under, the sample it came from, the value used, the context the record gave and the real container and hold", () => {
    const reveal = revealDecision(s.challenge, null);
    const withRow = s.challenge.affected.filter((id) => s.challenge.planted.decisions.find((d) => d.decision_id === id)?.read);
    expect(reveal.decisions?.affected).toEqual(s.challenge.affected);
    expect(reveal.decisions?.rows.map((r) => r.decision_id)).toEqual(withRow);
    for (const row of reveal.decisions?.rows ?? []) {
      const d = s.challenge.planted.decisions.find((x) => x.decision_id === row.decision_id);
      const truth = decisionTruth(s.challenge.planted, row.decision_id);
      expect(row).toEqual({
        decision_id: row.decision_id, read_as: d?.read?.filed_under, from_sample: truth?.from_sample, value: d?.read?.value,
        record: { container: d?.read?.container, hold_s: d?.read?.hold_s }, truth: { container: truth?.container, hold_s: truth?.hold_s },
      });
    }
  });

  it("Then the reveal compares A, B, C and the shown architecture: the outcomes of the label error equal the typed cells, and the decision is the same only where the error did not arise", () => {
    const reveal = revealDecision(s.challenge, null);
    expect(reveal.per_architecture.map((p) => p.architecture)).toEqual([A, "b_lims_lite", "c_context"]);
    expect(outcomes(reveal)).toEqual([LABEL_CELLS[0], LABEL_CELLS[1], LABEL_CELLS[2]]);
    expect(reveal.per_architecture.map((p) => p.decision_same)).toEqual([false, true, true]);
    expect(reveal.per_architecture.map((p) => p.reading)).toEqual(["flag.system_issued_id.off", "flag.system_issued_id.on", "flag.system_issued_id.on"]);
  }, 60_000);

  it("Then the reveal's lineage is that of the planted sample over the compared records, with the truth column, and shows no pH value (the recorded structure holds placeholders)", () => {
    const reveal = revealDecision(s.challenge, null);
    expect(reveal.lineage.sample.sample_id).toBe(s.challenge.plant.sample_id);
    expect(reveal.lineage.columns.map((c) => c.architecture)).toEqual([A, "b_lims_lite", "c_context"]);
    const ph = reveal.lineage.columns.flatMap((c) => c.nodes).filter((n) => n.table === "result" && n.fields.some((f) => f.name === "analyte" && f.value === "ph"));
    for (const n of ph) expect(n.fields.find((f) => f.name === "value")?.value).toBeNull();
  }, 60_000);

  it("Given a sample to open Then the drill-down has no truth, no verdict and no pH value", () => {
    const column = openDecisionSample(s.challenge, s.record.samples[0]?.sample_id as string);
    expect(column && Object.keys(column).sort()).toEqual(["architecture", "edges", "flags_on", "labelling", "nodes"]);
    const ph = (column?.nodes ?? []).filter((n) => n.table === "result" && n.fields.some((f) => f.name === "analyte" && f.value === "ph"));
    expect(ph.length).toBeGreaterThan(0);
    for (const n of ph) expect(n.fields.find((f) => f.name === "value")?.value).toBeNull();
    expect(openDecisionSample(s.challenge, "U99-D99-9")).toBeNull();
  });
});

describe("The decision variant shown in C minus system_issued_id", () => {
  let s: ReturnType<typeof started>;
  beforeAll(() => {
    s = started(C_MINUS);
  }, 120_000);

  it("Then the record stores the hold (two_clocks is on), the plant changes a decision, and the reveal covers A, B, C and the ablation with the typed cells (I, P, P, I)", () => {
    expect(s.record.decisions.some((d) => d.read?.hold_s != null)).toBe(true);
    const reveal = revealDecision(s.challenge, null);
    expect(reveal.per_architecture.map((p) => p.architecture)).toEqual([A, "b_lims_lite", "c_context", C_MINUS]);
    expect(outcomes(reveal)).toEqual([LABEL_CELLS[0], LABEL_CELLS[1], LABEL_CELLS[2], LABEL_CELLS[3]]);
    expect(reveal.per_architecture.map((p) => p.decision_same)).toEqual([false, true, true, false]);
  }, 60_000);

  it("Given a record with no structural error (C without system_issued_id prevents each one) Then an unaffected decision on a sample whose container is really open is background by construction: a technique error", () => {
    const open = s.challenge.planted.decisions.find((d) => d.read !== null && !s.challenge.affected.includes(d.decision_id) && decisionTruth(s.challenge.planted, d.decision_id)?.container === "open");
    expect(open, "technique probability 0.5 leaves open samples read by unaffected decisions").toBeDefined();
    expect(revealDecision(s.challenge, (open as { decision_id: string }).decision_id).score).toEqual({ result: "background", background_type: "technique_error" });
  });

  it("Given an unaffected decision on a closed sample within the hold limit Then it is a miss", () => {
    const closed = s.challenge.planted.decisions.find((d) => d.read !== null && !s.challenge.affected.includes(d.decision_id) && decisionTruth(s.challenge.planted, d.decision_id)?.container === "closed" && (decisionTruth(s.challenge.planted, d.decision_id)?.hold_s as number) <= 1800);
    expect(closed).toBeDefined();
    expect(revealDecision(s.challenge, (closed as { decision_id: string }).decision_id).score).toEqual({ result: "miss" });
  });
});

describe("What the decision variant refuses", () => {
  it("Given an architecture with system_issued_id on (B, C and the other ablations) Then the start is refused with the reason", () => {
    for (const shown of ["b_lims_lite", "c_context", "c_context_minus_audit_trail"]) {
      expect(startDecisionChallenge(data, spec, SEED, shown), shown).toEqual({ ok: false, message: expect.stringMatching(/system_issued_id/) });
    }
  });

  it("Given a build without the SC8 bundle Then the variant is not offered and the start is refused", () => {
    expect(startDecisionChallenge(labData(), spec, SEED, A)).toEqual({ ok: false, message: expect.stringMatching(/not offered/) });
  });
});
