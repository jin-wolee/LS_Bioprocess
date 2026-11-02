import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACTION_CLASS, ACTION_DRAWS, ACTION_KINDS, MAX_ACTIONS, applyActions, canonicalActions, parseActions, resultsActions } from "../../src/experiments/assembly/lab/actions.ts";
import type { Action, PlantBase } from "../../src/experiments/assembly/lab/actions.ts";
import { scenarioDocument } from "../../src/experiments/assembly/lab/setup.ts";
import { ablate, parseArchitecture } from "../../src/record/architecture.ts";
import { canonicalJson } from "../../src/trace.ts";
import { labData } from "../support/lab_data.ts";
import { ROOT, listFiles, readJson } from "../support/paths.ts";
import { SMALL, patched, rawScenario } from "../support/scenarios.ts";
import type { Json } from "../support/schemas.ts";

// P2 (docs/design/plant_ui.md section 5): the action list. The hand fixtures under tests/fixtures/plant/ are the mapping of section 5.2 typed by hand: for each action the fields of the scenario
// that must result, the capture path and the record halls. The code under test never writes a fixture.

const data = labData();
const FIXTURES = ["add_feed", "raise_alarm", "move_draw", "analyzer_down", "change_lot", "set_labelling", "set_capture_path", "set_flag_c", "set_flag_b", "three_together"];
interface Fixture { description: string; actions: Action[]; hand: { scenario_fields: Json; capture_path?: string; architectures: (string | Json)[] } }
const fixture = (name: string): Fixture => readJson<Fixture>("tests", "fixtures", "plant", `${name}.json`);

const HALLS = ["a_manual", "b_lims_lite", "c_context"];
const base = (): PlantBase => ({ scenario: scenarioDocument(data, "default", SMALL), capture_path: undefined, architectures: HALLS.map((id) => parseArchitecture(readJson("scenarios", "architectures", `${id}.json`))) });
/** The record halls a fixture writes by hand: an id names a bundled record, an object is a document typed in the fixture. */
const handHalls = (hand: Fixture["hand"]) => hand.architectures.map((a) => (typeof a === "string" ? readJson("scenarios", "architectures", `${a}.json`) : a));

describe("The action kinds are the rows of plant_ui.md section 5.2", () => {
  const text = readFileSync(join(ROOT, "docs", "design", "plant_ui.md"), "utf8");
  const section = text.slice(text.indexOf("### 5.2 The actions"), text.indexOf("### 5.3"));

  it("Given the table of section 5.2 Then its first column lists exactly the kinds of the code, and a kind of the type union is in the table", () => {
    const rows = [...section.matchAll(/^\| `([a-z_]+)` \| (?:Plant|Lab setting)/gm)].map((m) => m[1]);
    expect(rows).toEqual([...ACTION_KINDS]);
    const union = [...section.matchAll(/\{ kind: "([a-z_]+)";/g)].map((m) => m[1]);
    expect(union).toEqual([...ACTION_KINDS]);
  });

  it("Given the eight kinds Then five are plant actions and three are lab settings, as the table says", () => {
    const plant = ACTION_KINDS.filter((k) => ACTION_CLASS[k] === "plant");
    expect(plant).toEqual(["add_feed", "raise_alarm", "move_draw", "analyzer_down", "change_lot"]);
    expect(ACTION_KINDS.filter((k) => ACTION_CLASS[k] === "lab")).toEqual(["set_flag", "set_capture_path", "set_labelling"]);
  });

  it("Given place_contamination Then it is not a kind (the author did not offer it)", () => {
    expect((ACTION_KINDS as readonly string[]).includes("place_contamination")).toBe(false);
  });

  it("Given the keys of section 5.4 Then no action takes a random draw of its own", () => {
    expect(ACTION_DRAWS).toEqual([]);
  });
});

describe("parseActions: a list in a link is user input", () => {
  const add = { kind: "add_feed", at: 291600, unit_id: "U03" };

  it("Given a good list Then it is returned as entered, in a copy", () => {
    const list = [add, { kind: "set_labelling", at: 600, method: "handwritten" }];
    const out = parseActions(list);
    expect(out).toEqual({ ok: true, actions: list });
    expect(out.ok && out.actions[0]).not.toBe(list[0]);
  });

  it.each([
    ["not a list", { kind: "add_feed" }],
    ["an entry that is not an object", [7]],
    ["an entry with no kind", [{ at: 60, unit_id: "U03" }]],
    ["an instant that is not a whole minute", [{ ...add, at: 291601 }]],
    ["a negative instant", [{ ...add, at: -60 }]],
    ["an instant with a fraction", [{ ...add, at: 60.5 }]],
    ["a missing field", [{ kind: "add_feed", at: 60 }]],
    ["an unknown key", [{ ...add, volume: 3 }]],
    ["an id with a space", [{ ...add, unit_id: "U 03" }]],
    ["a target that is not a whole minute", [{ kind: "move_draw", at: 60, sample_id: "U03-D03-1", to: 90 }]],
    ["a window of zero minutes", [{ kind: "analyzer_down", at: 60, analyzer: "AN-1", from: 120, length_min: 0 }]],
    ["a flag value that is not a boolean", [{ kind: "set_flag", at: 60, architecture: "c_context", flag: "audit_trail", on: "no" }]],
    ["a capture path that does not exist", [{ kind: "set_capture_path", at: 60, path: "fax" }]],
    ["a labelling method that does not exist", [{ kind: "set_labelling", at: 60, method: "tattoo" }]],
  ])("Given %s Then the request is invalid_spec", (_name, list) => {
    expect(parseActions(list)).toMatchObject({ ok: false, code: "invalid_spec" });
  });

  it("Given place_contamination Then it is refused as unknown_target, whatever its fields", () => {
    const out = parseActions([add, { kind: "place_contamination", at: 60, origin: { kind: "seed_lot", item_id: "SL-1" }, contaminated_at: 120 }]);
    expect(out).toMatchObject({ ok: false, code: "refused", reason: "unknown_target", index: 1 });
  });

  it.each(["hold", "release", "reject", "readjust", "stop_unit"])("Given the action %s on a recorded result Then it is refused as closed_loop", (kind) => {
    expect(parseActions([{ kind, at: 60, request_id: "U03-D03-1" }])).toMatchObject({ ok: false, code: "refused", reason: "closed_loop", index: 0 });
  });

  it("Given a list of 16 Then it is accepted, and the seventeenth action is refused as limit at index 16", () => {
    const list = Array.from({ length: MAX_ACTIONS + 1 }, (_, i) => ({ ...add, at: 60 * (i + 1) }));
    expect(parseActions(list.slice(0, MAX_ACTIONS))).toMatchObject({ ok: true });
    expect(parseActions(list)).toMatchObject({ ok: false, code: "refused", reason: "limit", index: 16 });
  });

  it("Given a duplicate (same kind, target and instant) Then it is refused as limit at the later index; another instant or another target is not a duplicate", () => {
    expect(parseActions([add, { ...add }])).toMatchObject({ ok: false, code: "refused", reason: "limit", index: 1 });
    expect(parseActions([add, { ...add, at: 291660 }, { ...add, unit_id: "U04" }])).toMatchObject({ ok: true });
    const flag = { kind: "set_flag", at: 60, architecture: "c_context", flag: "audit_trail", on: false };
    expect(parseActions([flag, { ...flag, flag: "two_clocks" }])).toMatchObject({ ok: true });
  });
});

describe("canonicalActions: one order whatever the order of entry (section 5.4)", () => {
  const list: Action[] = [
    { kind: "set_labelling", at: 100 * 60, method: "preprinted_barcode" },
    { kind: "move_draw", at: 200 * 60, sample_id: "U03-D03-1", to: 300 * 60 },
    { kind: "add_feed", at: 200 * 60, unit_id: "U04" },
    { kind: "add_feed", at: 200 * 60, unit_id: "U03" },
    { kind: "analyzer_down", at: 50 * 60, analyzer: "AN-1", from: 60 * 60, length_min: 30 },
    { kind: "set_flag", at: 10 * 60, architecture: "c_context", flag: "audit_trail", on: false },
  ];
  // plant before lab; then the instant; then the kind; then the target id (hand-sorted)
  const ORDER = ["analyzer_down AN-1", "add_feed U03", "add_feed U04", "move_draw U03-D03-1", "set_flag c_context:audit_trail", "set_labelling "];
  const label = (a: Action): string => {
    const t = a.kind === "set_flag" ? `${a.architecture}:${a.flag}` : a.kind === "move_draw" ? a.sample_id : a.kind === "add_feed" || a.kind === "raise_alarm" ? a.unit_id : a.kind === "analyzer_down" ? a.analyzer : "";
    return `${a.kind} ${t}`;
  };

  it("Given a list entered in one order Then the canonical order is plant actions first, by instant, kind and target, named act-1 to act-6", () => {
    const named = canonicalActions(list);
    expect(named.map((n) => label(n.action))).toEqual(ORDER);
    expect(named.map((n) => n.name)).toEqual(["act-1", "act-2", "act-3", "act-4", "act-5", "act-6"]);
  });

  it("Given every permutation of three actions Then the canonical order, the scenario and the halls are one", () => {
    const three = [list[2], list[3], list[1]] as Action[];
    const orders = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]].map((p) => p.map((i) => three[i] as Action));
    const results = orders.map((o) => canonicalJson(applyActions(base(), o)));
    expect(new Set(results).size).toBe(1);
    expect(new Set(orders.map((o) => canonicalJson(canonicalActions(o)))).size).toBe(1);
  });

  it("Given the canonical order Then an action applied out of it would differ: two feeds of one unit at one instant keep their listed order", () => {
    const out = applyActions(base(), [list[2] as Action, list[3] as Action]);
    expect((out.scenario.scripted_events as { unit_id: string }[]).map((e) => e.unit_id)).toEqual(["U03", "U04"]);
  });
});

describe("applyActions: the mapping of section 5.2 against the hand fixtures", () => {
  it.each(FIXTURES)("Given the fixture %s Then the scenario, the capture path and the halls are the ones written by hand, and the base is untouched", (name) => {
    const f = fixture(name);
    const before = canonicalJson(base());
    const b = base();
    const out = applyActions(b, f.actions);
    expect(canonicalJson(out.scenario)).toBe(canonicalJson(patched(scenarioDocument(data, "default", SMALL) as Json, { fields: f.hand.scenario_fields })));
    expect(out.capture_path).toBe(f.hand.capture_path);
    expect(canonicalJson(out.architectures)).toBe(canonicalJson(handHalls(f.hand)));
    expect(canonicalJson(b)).toBe(before);
  });

  it("Given no action Then the scenario, the capture path and the halls come back as they were", () => {
    expect(canonicalJson(applyActions(base(), []))).toBe(canonicalJson(base()));
  });

  it("Given the fixtures Then there is one for every kind and the directory holds nothing else but the folder of the settings sweep (P6c: its list is not an action fixture)", () => {
    expect(listFiles("tests", "fixtures", "plant").filter((f) => f !== "sweep").map((f) => f.replace(/\.json$/, "")).sort()).toEqual([...FIXTURES].sort());
    expect(listFiles("tests", "fixtures", "plant", "sweep")).toEqual(["specs.json"]);
    const kinds = new Set(FIXTURES.flatMap((n) => fixture(n).actions.map((a) => a.kind)));
    expect([...kinds].sort()).toEqual([...ACTION_KINDS].sort());
  });

  it("Given one flag of C switched off Then the derived document is the existing ablation of the engine, id and all", () => {
    const out = applyActions(base(), fixture("set_flag_c").actions);
    expect(out.architectures[2]).toEqual(ablate(base().architectures[2] as ReturnType<typeof parseArchitecture>, "audit_trail"));
  });

  it("Given two switches of one flag Then the later instant wins and the id is made from the net change", () => {
    const flag = (at: number, on: boolean): Action => ({ kind: "set_flag", at, architecture: "c_context", flag: "audit_trail", on });
    const off = applyActions(base(), [flag(600, false), flag(1200, true)]);
    expect(off.architectures.map((a) => a.id)).toEqual(HALLS);
    const two = applyActions(base(), [flag(600, false), { kind: "set_flag", at: 600, architecture: "c_context", flag: "two_clocks", on: false }]);
    expect(two.architectures[2]?.id).toBe("c_context_minus_two_clocks_minus_audit_trail");
  });

  it("Given a switch of a flag or a record that does not exist Then applyActions throws, and a switch that makes two halls equal throws", () => {
    expect(() => applyActions(base(), [{ kind: "set_flag", at: 60, architecture: "zzz", flag: "audit_trail", on: false }])).toThrow(/no record zzz/);
    expect(() => applyActions(base(), [{ kind: "set_flag", at: 60, architecture: "c_context", flag: "no_such_flag", on: false }])).toThrow(/no record c_context with a flag no_such_flag/);
    const two = { ...base(), architectures: [...base().architectures, parseArchitecture({ ...(readJson("scenarios", "architectures", "c_context.json") as Json), id: "c_context_minus_audit_trail", flags: { ...(readJson<{ flags: Json }>("scenarios", "architectures", "c_context.json").flags), audit_trail: false } })] };
    expect(() => applyActions(two, [{ kind: "set_flag", at: 60, architecture: "c_context", flag: "audit_trail", on: false }])).toThrow(/would both be c_context_minus_audit_trail/);
  });

  it("Given every instant of a scenario field Then its ref is a ledger id (A228 for an instant the reader chose, A096 for a window length)", () => {
    const out = applyActions(base(), fixture("three_together").actions).scenario;
    const refs = [...JSON.stringify([out.scripted_events, out.maintenance]).matchAll(/"ref":"(A\d{3})"/g)].map((m) => m[1]);
    expect(refs).toEqual(["A228", "A228", "A228", "A228", "A096"]);
  });
});

describe("resultsActions: Results over many seeds (section 7)", () => {
  const every: Action[] = [
    { kind: "add_feed", at: 60, unit_id: "U03" },
    { kind: "raise_alarm", at: 60, unit_id: "U03" },
    { kind: "move_draw", at: 60, sample_id: "U03-D03-1", to: 120 },
    { kind: "analyzer_down", at: 60, analyzer: "AN-1", from: 120, length_min: 60 },
    { kind: "change_lot", at: 60, analyzer: "AN-1", effective: 120 },
    { kind: "set_flag", at: 60, architecture: "c_context", flag: "audit_trail", on: false },
    { kind: "set_capture_path", at: 60, path: "adapter_ingest" },
    { kind: "set_labelling", at: 60, method: "handwritten" },
  ];

  it("Given one action of every kind Then Results carries the four that name a unit or an analyzer and never the one that names a sample", () => {
    expect(resultsActions(every).map((a) => a.kind)).toEqual(["add_feed", "raise_alarm", "analyzer_down", "change_lot"]);
    expect(resultsActions(every).some((a) => a.kind === "move_draw")).toBe(false);
  });

  it("Given the full default scenario Then the document Results builds from the carried actions has no move_draw even when the plant had one", () => {
    const doc = applyActions({ ...base(), scenario: patched(rawScenario("default")) as PlantBase["scenario"] }, resultsActions(every)).scenario;
    expect(JSON.stringify(doc.scripted_events)).not.toContain("move_draw");
    expect((doc.scripted_events as unknown[]).length).toBe(2);
  });
});
