import { describe, expect, it } from "vitest";
import { loadScenario } from "../../src/scenario.ts";
import { runScenario } from "../../src/run.ts";
import { logHash } from "../../src/trace.ts";
import { readJson } from "../support/paths.ts";
import { SMALL, configOf, lookup, patched, rawScenario } from "../support/scenarios.ts";
import { isValid, makeAjv } from "../support/schemas.ts";
import type { Json } from "../support/schemas.ts";

// P2 (docs/design/plant_ui.md sections 5.2 and 5.8; docs/design/simulation_spec.md section 2.2): the scripted event `move_draw`. The numbers of the hand fixture are calendar arithmetic on
// the base run of the small default scenario, seed 1, typed here from that run (the unmodified engine, pinned below): sample U03-D03-1 is planned at 305421 s (day 3, 12:50:21), is drawn 205 s
// later (305626 s, by OP-02, before the 13:00 shift change at 46800 s of the day) and reaches the bench 1144 s after that (306770 s). The reader acts on day 3 at 09:00 (4860 min = 291600 s)
// and moves the draw to 10:30 (4950 min = 297000 s). The keyed draws of the sample stay, so the plan is 297000 s, the draw 297000 + 205 = 297205 s and the receipt 297205 + 1144 = 298349 s.

const AT = { value: 4860, unit: "min", ref: "A228" };
const TO = { value: 4950, unit: "min", ref: "A228" };
const move = (extra: Json = {}): Json => ({ type: "move_draw", sample_id: "U03-D03-1", at: AT, to: TO, ...extra });
const withMoves = (...moves: Json[]) => ({ settings: SMALL, fields: { scripted_events: moves } });
const sample = (run: ReturnType<typeof runScenario>, id: string) => run.samples.find((s) => s.sample_id === id);

const base = runScenario({ ...configOf("default", { settings: SMALL }), seed: 1 });
const moved = runScenario({ ...configOf("default", withMoves(move())), seed: 1 });

describe("move_draw: a hand fixture of one moved draw", () => {
  it("Given the base run Then the sample is planned at 305421 s, drawn at 305626 s and received at 306770 s (the fixture's starting point)", () => {
    expect(sample(base, "U03-D03-1")).toMatchObject({ planned_s: 305421, drawn_s: 305626, arrived_s: 306770, operator_id: "OP-02" });
  });

  it("Given the move to 297000 s When the run is made Then the planned instant is 297000 s and the keyed delay (205 s) and transport (1144 s) are added to it", () => {
    expect(sample(moved, "U03-D03-1")).toMatchObject({ planned_s: 297000, drawn_s: 297205, arrived_s: 298349, operator_id: "OP-02" });
  });

  it("Given the move Then the events of the sample are at the moved instants and no other instant of it is left behind", () => {
    const own = moved.events.filter((e) => "sample_id" in e && e.sample_id === "U03-D03-1").map((e) => [e.type, e.t]);
    expect(own).toContainEqual(["sample_planned", 297000]);
    expect(own).toContainEqual(["label_bound", 297205]);
    expect(own).toContainEqual(["sample_drawn", 297205]);
    expect(own).toContainEqual(["sample_received", 298349]);
    expect(own).not.toContainEqual(["sample_planned", 305421]);
    expect(own).not.toContainEqual(["sample_drawn", 305626]);
  });

  it("Given the move Then every other sample keeps its planned instant and its draw (every keyed draw is keyed by the sample id alone)", () => {
    expect(moved.samples).toHaveLength(base.samples.length);
    for (const s of base.samples.filter((x) => x.sample_id !== "U03-D03-1")) {
      expect(sample(moved, s.sample_id), s.sample_id).toMatchObject({ planned_s: s.planned_s, drawn_s: s.drawn_s, arrived_s: s.arrived_s, operator_id: s.operator_id });
    }
  });

  it("Given the move at 291600 s Then the events before that instant are identical to the base run (the past is not rewritten)", () => {
    const before = (run: typeof base) => run.events.filter((e) => e.t < 291600);
    expect(before(moved).length).toBeGreaterThan(300);
    expect(before(moved)).toEqual(before(base));
  });

  it("Given the same move twice Then the log hash is one value, and it differs from the base run's", async () => {
    const again = runScenario({ ...configOf("default", withMoves(move())), seed: 1 });
    expect(await logHash(again.events)).toBe(await logHash(moved.events));
    expect(await logHash(moved.events)).not.toBe(await logHash(base.events));
  });
});

describe("move_draw: what the run refuses, with a message that names the sample", () => {
  const run = (...moves: Json[]) => () => runScenario({ ...configOf("default", withMoves(...moves)), seed: 1 });
  const at = (min: number) => ({ value: min, unit: "min", ref: "A228" });

  it("Given a sample the run does not draw When it is moved Then the run is refused", () => {
    expect(run(move({ sample_id: "U03-D77-1" }))).toThrow(/move_draw.*U03-D77-1.*does not draw/);
  });

  it("Given a sample already planned at the instant of the action (planned 204249 s, action 291600 s) Then the run is refused", () => {
    expect(run(move({ sample_id: "U03-D02-1", to: at(4950 - 1440) }))).toThrow(/move_draw.*U03-D02-1.*already planned/);
  });

  it("Given a target before the action Then the run is refused", () => {
    expect(run(move({ to: at(4800) }))).toThrow(/move_draw.*U03-D03-1.*before the action/);
  });

  it("Given a target on another day (day 4, 10:30) Then the run is refused", () => {
    expect(run(move({ to: at(4950 + 1440) }))).toThrow(/move_draw.*U03-D03-1.*same day/);
  });

  it("Given a target at 07:00 (before the window opens at 08:00) Then the run is refused", () => {
    expect(run(move({ at: at(4680), to: at(4740) }))).toThrow(/move_draw.*U03-D03-1.*staffed window/);
  });

  it("Given a target at 19:00 (after 18:00 on a weekday) Then the run is refused", () => {
    expect(run(move({ to: at(4320 + 1140) }))).toThrow(/move_draw.*U03-D03-1.*staffed window/);
  });

  it("Given a target that is not a whole minute (4950.5 min) Then the run is refused", () => {
    expect(run(move({ to: at(4950.5) }))).toThrow(/move_draw.*U03-D03-1.*whole minute/);
  });

  it("Given two moves of one sample Then the run is refused", () => {
    expect(run(move(), move({ to: at(4960) }))).toThrow(/move_draw.*U03-D03-1.*more than once/);
  });
});

describe("move_draw: the scenario schema", () => {
  const ajv = makeAjv();
  const scenario = (): Json => structuredClone(readJson<Json>("tests", "fixtures", "schemas", "valid", "scenario.json"));
  const feed = { type: "feed", unit_id: "U01", at: AT };

  it("Given a scenario with a feed, an alarm and a move_draw Then it is valid, and a scenario with the two old events only is valid as before", () => {
    expect(isValid(ajv, "scenario", { ...scenario(), scripted_events: [feed, { ...feed, type: "alarm" }, move()] })).toBe(true);
    expect(isValid(ajv, "scenario", { ...scenario(), scripted_events: [feed] })).toBe(true);
  });

  it.each([
    ["a move_draw with a unit_id", { ...move(), unit_id: "U03" }],
    ["a move_draw without a target", { type: "move_draw", sample_id: "U03-D03-1", at: AT }],
    ["a move_draw without an action instant", { type: "move_draw", sample_id: "U03-D03-1", to: TO }],
    ["a move_draw with an empty sample id", move({ sample_id: "" })],
    ["a feed with a sample id", { ...feed, sample_id: "U03-D03-1" }],
    ["a feed without a unit", { type: "feed", at: AT }],
    ["a feed with a target instant", { ...feed, to: TO }],
    ["an unknown type", { ...feed, type: "stop" }],
  ])("Given %s Then the scenario is refused", (_name, event) => {
    expect(isValid(ajv, "scenario", { ...scenario(), scripted_events: [event] })).toBe(false);
  });

  it("Given the bundled scenarios Then each one is still valid", () => {
    for (const name of ["default", "sc02_shift_burst", "sc03_feed_in_gap", "sc05_one_analyzer_down"]) expect(isValid(ajv, "scenario", rawScenario(name)), name).toBe(true);
  });
});

describe("move_draw: with none, every output stays what it was (spec section 11.1 regression rule)", () => {
  // Taken at the base commit 26e1580 with the engine as it was before P2, by a script kept outside the repository; never regenerated.
  const BEFORE: Record<string, string> = {
    default_seed_1: "9692942bf38f16b7826732e379dec3c721210c4a2c35839fd6f6e2cc5856c46d",
    default_seed_2: "b6bdf8aa6614eb54d29452abd44da2f6791fcceeafc011fe0990a67a473ee7eb",
    sc02_shift_burst_seed_1: "fae513f03dd08a5c97e3c69d6ab54f936bd62d3cc7d0fe4fe23d388552515691",
    sc02_shift_burst_seed_2: "f03756eb57f04a4b0e7032cc424c9b349923cf1b37b2bec9bf47237e97e2daf0",
    sc03_feed_in_gap_seed_1: "97701df46fdbbdf49725e5462be6b0160bbcc62fc26830173e373635dfc5925b",
    sc03_feed_in_gap_seed_2: "61a1a2cbd7ea754725fbe45bb62862757dab56230d2bd264e5c1ac34737afc0e",
    sc05_one_analyzer_down_seed_1: "fb6049759a69868944834a68253d698b93051241d43261b329d6329de5f3b855",
    sc05_one_analyzer_down_seed_2: "d8c516d2073b491845035bcc4bc1577b3dfd3cd39ce8707a64affc41e0107ded",
  };

  it.each(Object.entries(BEFORE))("Given the small scenario %s Then the strict log hash equals the one taken before P2", async (key, hash) => {
    const [, name, seed] = /^(.*)_seed_(\d)$/.exec(key) as RegExpExecArray;
    const run = runScenario({ ...configOf(name as string, { settings: SMALL }), seed: Number(seed) });
    expect(await logHash(run.events)).toBe(hash);
  });

  it("Given the full default scenario, seed 1 Then the log hash equals the one taken before P2 (and the golden of the repository)", async () => {
    const golden = readJson<{ log_hash: string }>("tests", "golden", "default_seed1.summary.json");
    const run = runScenario({ ...configOf("default"), seed: 1 });
    expect(await logHash(run.events)).toBe("4c7e71c8c1fd354624743abea6202eea5351d0bc06cbcb4bdcef8d313b89b64b");
    expect(await logHash(run.events)).toBe(golden.log_hash);
  });

  it("Given a scenario with no move_draw Then the sampling config has no `moves` key at all", () => {
    expect("moves" in configOf("default", { settings: SMALL }).sampling).toBe(false);
    expect(loadScenario(patched(rawScenario("default"), { settings: SMALL }), lookup).sampling).not.toHaveProperty("moves");
  });
});
