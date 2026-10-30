import { describe, expect, it } from "vitest";
import { canonicalKey, streamSeed } from "../../src/rng.ts";
import type { StreamKey } from "../../src/rng.ts";
import { canonicalJsonl, logHash } from "../../src/trace.ts";
import { docOf, eventsOf, fx12a, fx12e, h, runOfDoc, set } from "./support.ts";
import type { Json } from "../support/schemas.ts";

// Invariant 2 and rule S5: seeded integer PRNG only, one canonical key tuple (run_seed, physical_sample_id, analyte, attempt, purpose). The only keyed draw the break-out truth adds is the
// operator of a confirming draw, key (run_seed, confirming_sample_id, "-", 0, "confirm"); nothing else in the script is random. A draw never shifts another sample's draws (11.1 rule 5).

const keysOf = (doc: Json): StreamKey[] => {
  const keys: StreamKey[] = [];
  runOfDoc(doc, { onKey: (k) => void keys.push(k) });
  return keys;
};

describe("Determinism of the break-out truth", () => {
  it("Given the same scenario and seed When it runs twice Then the truth log is byte-identical (canonical JSONL and hash)", async () => {
    const a = runOfDoc(docOf(fx12a()));
    const b = runOfDoc(docOf(fx12a()));
    expect(canonicalJsonl(a.events)).toBe(canonicalJsonl(b.events));
    expect(await logHash(a.events)).toBe(await logHash(b.events));
    expect(canonicalJsonl(a.observable)).toBe(canonicalJsonl(b.observable));
  });

  it("Given another seed When it runs Then the log differs (the script is the same, the keyed draws are not)", async () => {
    const a = runOfDoc(docOf(fx12a()));
    const b = runOfDoc(docOf(fx12a(), {}, { seed: 2 }));
    expect(await logHash(a.events)).not.toBe(await logHash(b.events));
  });

  it("Given FX12a and FX12e and a sampling-origin scenario When every stream key of the run is enumerated Then no stream is asked for twice and no two keys hash to one stream seed", () => {
    const sampling = set(fx12a(), "origin", { kind: "sampling", sample_id: "U01-D01-1" });
    for (const doc of [docOf(fx12a()), docOf(fx12e()), docOf({ ...sampling, topology: {}, confirm: ["U01"] })]) {
      const keys = keysOf(doc);
      expect(keys.length).toBeGreaterThan(50);
      expect(new Set(keys.map(canonicalKey)).size).toBe(keys.length);
      expect(new Set(keys.map(streamSeed)).size).toBe(keys.length);
    }
  });

  it("Given two confirmed units When the keys are enumerated Then the break-out adds exactly one key per confirming sample: (seed, sample id, -, 0, confirm)", () => {
    const keys = keysOf(docOf(fx12a()));
    expect(keys.filter((k) => k[4] === "confirm")).toEqual([[1, "U01-CONF", "-", 0, "confirm"], [1, "U02-CONF", "-", 0, "confirm"]]);
    // and nothing else is new: every other key is one the run without the block asks for too (the stopped unit asks for fewer, never for others)
    const plain = new Set(keysOf(docOf()).map(canonicalKey));
    const others = keys.filter((k) => k[4] !== "confirm").map(canonicalKey);
    expect(others.length).toBeGreaterThan(50);
    expect(others.filter((k) => !plain.has(k))).toEqual([]);
  });

  it("Given one more unit in the confirm list When the run is repeated Then the draws of the units already in it do not change (a draw never shifts another)", () => {
    const one = eventsOf(runOfDoc(docOf(set(fx12a(), "confirm", ["U01"]))), "confirm_sample_drawn");
    const two = eventsOf(runOfDoc(docOf(fx12a())), "confirm_sample_drawn");
    expect(one.length).toBe(1);
    expect(two[0]).toEqual(one[0]);
  });

});

describe("Without a break-out block nothing of the extension appears", () => {
  const NEW = ["contamination_onset", "signal_observed", "deviation_opened", "confirm_sample_drawn", "confirm_result"];

  it("Given the three-reactor scenario with no block When it runs Then there is no event of the new types, no seed lot on an inoculation, no new process kind, and no breakout on the run", () => {
    const run = runOfDoc(docOf());
    expect(run.events.filter((e) => NEW.includes(e.type))).toEqual([]);
    expect(eventsOf(run, "inoculation").every((e) => !("seed_lot_id" in e))).toBe(true);
    expect(eventsOf(run, "process_event").every((e) => !["medium_addition", "equipment_use", "unit_stopped"].includes(e.kind) && !("lot_id" in e) && !("equipment_id" in e))).toBe(true);
    expect("breakout" in run).toBe(false);
  });

  it("Given d1 changed from 2 h to 3 h When it runs Then the onset and the signal stay where they were and the stop and the confirming draws move to 20 h", () => {
    const a = runOfDoc(docOf(fx12a()));
    const b = runOfDoc(docOf(set(fx12a(), "response.signal_to_response", h(3, "A176"))));
    expect(eventsOf(b, "contamination_onset")).toEqual(eventsOf(a, "contamination_onset"));
    expect(eventsOf(b, "signal_observed")).toEqual(eventsOf(a, "signal_observed"));
    expect(eventsOf(b, "process_event").filter((e) => e.kind === "unit_stopped").map((e) => e.t)).toEqual([72_000]);
    expect(eventsOf(b, "confirm_sample_drawn").map((e) => e.t)).toEqual([72_000, 72_000]);
  });
});
