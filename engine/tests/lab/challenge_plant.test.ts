import { describe, expect, it } from "vitest";
import { announceType, offeredTypes, pickSamplePlant } from "../../src/experiments/assembly/lab/challenge_plant.ts";
import type { Architecture } from "../../src/record/architecture.ts";
import { canonicalKey, createRng, streamSeed } from "../../src/rng.ts";
import type { StreamKey } from "../../src/rng.ts";
import type { ScenarioRun } from "../../src/run.ts";
import { CONFIGS } from "../support/cells.ts";

// S3e, the plant of the sample variant (docs/design/lab_ui.md section 9, "How the planted error is drawn"). Two keyed draws, both with the canonical tuple (run_seed, id, analyte, attempt,
// purpose): the type, key (seed, "challenge", "-", 0, "challenge:type"), an index into the types the shown architecture does not prevent in catalogue order; and one draw per eligible
// sample, key (seed, sample_id, "-", 0, "challenge:pick"), where the smallest u is planted. The expected values are typed by hand from those two sentences and from the flag table
// (spec section 5): what an architecture prevents is read off its flags, never off the function under test.

const arch = (name: string): Architecture => (CONFIGS.find((c) => c.name === name) as NonNullable<(typeof CONFIGS)[number]>).config;
const events = (...e: Record<string, unknown>[]): ScenarioRun["events"] => e as unknown as ScenarioRun["events"];
const drawn = (sample_id: string, t: number, unit_id: string): Record<string, unknown> => ({ type: "sample_drawn", t, sample_id, unit_id, batch_id: `B-${unit_id}`, operator_id: "OP-1", volume_ul: 200, true_state: {} });
const measured = (request_id: string, t: number): Record<string, unknown> => ({ type: "result_measured", t, request_id, attempt: 1, visit: 1, analyzer: "AN-1", analyte: "glucose", value: 1, true_value: 1, noise: 0 });
const inoculation = (unit_id: string): Record<string, unknown> => ({ type: "inoculation", t: 0, unit_id, batch_id: `B-${unit_id}`, density_e6_per_ml: 1 });

// units U1 and U2; S4 is drawn but never measured (not eligible, though it is the neighbour that S3 and S5 can be read as)
const WORLD = events(
  inoculation("U1"), inoculation("U2"),
  drawn("S1", 100, "U1"), measured("S1", 150), drawn("S2", 200, "U1"), measured("S2", 250), drawn("S3", 300, "U2"), measured("S3", 350),
  drawn("S4", 400, "U2"), drawn("S5", 500, "U1"), measured("S5", 550),
);
const u = (seed: number, id: string, purpose: string): number => createRng().stream([seed, id, "-", 0, purpose]).float();

describe("The types a shown architecture can be asked to hide (catalogue order, not prevented)", () => {
  it("Given the flags of A, B, C and the ablations Then the offered types are those the flag table does not prevent", () => {
    // typed from the flag table: system_issued_id prevents the label error, write_time_keys the re-key, ingest_idempotency the replay
    expect(offeredTypes(arch("A"))).toEqual(["label_error", "unit_rekey", "duplicate_replay"]);
    expect(offeredTypes(arch("B"))).toEqual(["unit_rekey"]); // B has system_issued_id and ingest_idempotency, not write_time_keys
    expect(offeredTypes(arch("C"))).toEqual([]); // every drawn type is prevented in C
    expect(offeredTypes(arch("C-system_issued_id"))).toEqual(["label_error"]);
    expect(offeredTypes(arch("C-write_time_keys"))).toEqual(["unit_rekey"]);
    expect(offeredTypes(arch("C-ingest_idempotency"))).toEqual(["duplicate_replay"]);
    expect(offeredTypes(arch("C-two_clocks"))).toEqual([]);
  });
});

describe("The announced type", () => {
  it("Given a seed Then one stream is asked for, keyed (seed, challenge, -, 0, challenge:type), and the type is the one at index floor(u times n) of the offered types", () => {
    const keys: StreamKey[] = [];
    const type = announceType(41, arch("A"), createRng((k) => keys.push(k)));
    expect(keys).toEqual([[41, "challenge", "-", 0, "challenge:type"]]);
    const index = Math.floor(createRng().stream([41, "challenge", "-", 0, "challenge:type"]).float() * 3);
    expect(type).toBe((["label_error", "unit_rekey", "duplicate_replay"] as const)[index]);
  });

  it("Given the same seed twice Then the same type (it is a function of the seed alone), and over many seeds every offered type occurs", () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      expect(announceType(seed, arch("A"))).toBe(announceType(seed, arch("A")));
      seen.add(announceType(seed, arch("A")) as string);
    }
    expect([...seen].sort()).toEqual(["duplicate_replay", "label_error", "unit_rekey"]);
  });

  it("Given an architecture that prevents every drawn type (C) Then there is no type to announce", () => {
    expect(announceType(41, arch("C"))).toBeNull();
  });

  it("Given an architecture that leaves one type Then it is that type whatever the seed", () => {
    for (const seed of [1, 2, 3, 99]) expect(announceType(seed, arch("B"))).toBe("unit_rekey");
  });
});

describe("The planted sample (one keyed draw per eligible sample, the smallest u)", () => {
  it("Given a label error Then eligible are the samples that were drawn, were measured and have a neighbouring draw; the id the label reads is the next draw, else the previous one", () => {
    const keys: StreamKey[] = [];
    const plant = pickSamplePlant(7, "label_error", WORLD, createRng((k) => keys.push(k)));
    expect(keys.map((k) => k[1]).sort()).toEqual(["S1", "S2", "S3", "S5"]); // S4 has no result
    for (const k of keys) expect([k[0], k[2], k[3], k[4]]).toEqual([7, "-", 0, "challenge:pick"]);
    const smallest = ["S1", "S2", "S3", "S5"].sort((a, b) => u(7, a, "challenge:pick") - u(7, b, "challenge:pick") || (a < b ? -1 : 1))[0] as string;
    const neighbour: Record<string, string> = { S1: "S2", S2: "S3", S3: "S4", S5: "S4" }; // S5 is the last draw: the previous one, S4
    expect(plant).toEqual({ type: "label_error", sample_id: smallest, detail: { as_id: neighbour[smallest] } });
  });

  it("Given a re-key Then the target unit is one more keyed draw on the planted sample (purpose challenge:rekey_unit) among the other units in plain order", () => {
    const keys: StreamKey[] = [];
    const plant = pickSamplePlant(7, "unit_rekey", WORLD, createRng((k) => keys.push(k)));
    const smallest = ["S1", "S2", "S3", "S5"].sort((a, b) => u(7, a, "challenge:pick") - u(7, b, "challenge:pick") || (a < b ? -1 : 1))[0] as string;
    const unitOf: Record<string, string> = { S1: "U1", S2: "U1", S3: "U2", S5: "U1" };
    const others = ["U1", "U2"].filter((x) => x !== unitOf[smallest]);
    const to = others[Math.floor(u(7, smallest, "challenge:rekey_unit") * others.length)];
    expect(plant).toEqual({ type: "unit_rekey", sample_id: smallest, detail: { to_unit: to } });
    expect(keys.filter((k) => k[4] === "challenge:rekey_unit").map((k) => k[1])).toEqual([smallest]);
  });

  it("Given a replay Then the plant is a sample with no detail, and a run with one unit has no re-key to plant", () => {
    expect(pickSamplePlant(7, "duplicate_replay", WORLD)).toEqual({ type: "duplicate_replay", sample_id: expect.stringMatching(/^S[1235]$/) });
    const oneUnit = events(inoculation("U1"), drawn("S1", 100, "U1"), measured("S1", 150), drawn("S2", 200, "U1"), measured("S2", 250));
    expect(pickSamplePlant(7, "unit_rekey", oneUnit)).toBeNull();
  });

  it("Given an added sample Then no other sample's draw moves: the draw is a function of its own key (spec section 3, rule 3)", () => {
    const bigger = events(...(WORLD as unknown as Record<string, unknown>[]), drawn("S6", 600, "U2"), measured("S6", 650));
    const keysOf = (world: ScenarioRun["events"]): Map<string, number> => {
      const m = new Map<string, number>();
      pickSamplePlant(7, "duplicate_replay", world, createRng((k) => m.set(k[1], u(7, k[1], k[4]))));
      return m;
    };
    const before = keysOf(WORLD);
    const after = keysOf(bigger);
    for (const [id, draw] of before) expect(after.get(id), id).toBe(draw);
    expect([...after.keys()].sort()).toEqual(["S1", "S2", "S3", "S5", "S6"]);
  });

  it("Given the same seed and world twice Then the same plant, and another seed can plant another sample", () => {
    expect(pickSamplePlant(7, "label_error", WORLD)).toEqual(pickSamplePlant(7, "label_error", WORLD));
    const planted = new Set<string>();
    for (let seed = 1; seed <= 30; seed++) planted.add(pickSamplePlant(seed, "label_error", WORLD)?.sample_id as string);
    expect(planted.size).toBeGreaterThan(1);
  });

  it("Given a world with no measured sample Then there is nothing to plant", () => {
    expect(pickSamplePlant(7, "label_error", events(inoculation("U1"), drawn("S1", 100, "U1"), drawn("S2", 200, "U1")))).toBeNull();
  });

  it("Given the plant Then the only free part of a key is a sample id of the world (no key carries a label text)", () => {
    const keys: StreamKey[] = [];
    pickSamplePlant(7, "label_error", WORLD, createRng((k) => keys.push(k)));
    for (const k of keys) expect(["S1", "S2", "S3", "S5"]).toContain(k[1]);
  });
});

describe("The keys of the plant (as rng_collision.test.ts does for a run)", () => {
  it.each(["label_error", "unit_rekey", "duplicate_replay"] as const)("Given 200 seeds and a %s Then no stream is asked for twice and no two keys hash to the same stream seed", (type) => {
    const keys: StreamKey[] = [];
    const rng = createRng((k) => keys.push(k));
    for (let seed = 1; seed <= 200; seed++) {
      announceType(seed, arch("A"), rng);
      pickSamplePlant(seed, type, WORLD, rng);
    }
    // per seed: the type draw, the pick of each of the four eligible samples, and for a re-key the draw of its target
    expect(keys).toHaveLength(200 * (1 + 4 + (type === "unit_rekey" ? 1 : 0)));
    expect(new Set(keys.map(canonicalKey)).size).toBe(keys.length);
    expect(new Set(keys.map(streamSeed)).size).toBe(keys.length);
  });
});
