import { afterEach, describe, expect, it, vi } from "vitest";
import { BREAKOUT_PUBLIC } from "./generated/breakout_public.ts";
import { gradeOf, isProvisional, knownId, rangeOf } from "./ledger.ts";

// The ledger view of a build (lab_ui.md sections 6 and 20; ADR-0013). A build that refuses the Break-out screen bundles none of its files, and so none of the ids that only those files name: its view
// is src/generated/ledger_view_public.json. A build that offers the screen (the public one once the sources are re-read, or a local one, VITE_LAB_LOCAL=1) has the full view. The read happens at call
// time, so that this test can stub the variable; a bundler folds the condition and drops the other JSON file.

// Typed by hand from docs/research/assumptions.yaml (the extension rows A138 to A226) and from section 20, item 7 of the lab note: the ids that only the Break-out files name, and the sources below
// main-reread that only those ids follow to among the ids the lab names. S099, which item 7 lists too, is not one of them: A095, A198 and A199 follow to it, and the default scenario and the
// dictionaries of the rest of the lab name those.
const SCREEN_ONLY = [
  "A138", "A139", "A141", "A142", "A143", "A144", "A145", "A146", "A148", "A157", "A158", "A176", "A177", "A197", "A219", "A220", "A221", "A222", "A223", "A224", "A225", "A226",
];
const SCREEN_ONLY_SOURCES = ["S049", "S058", "S059", "S060", "S061", "S062", "S063", "S064", "S065", "S066", "S068", "S069", "S071", "S072", "S073", "S082", "S083"];

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the ledger view of a build that refuses the Break-out screen", () => {
  it("Given the public build (no VITE_LAB_LOCAL) Then it knows an id that only the Break-out files name, and a source behind it, exactly when the screen is offered", () => {
    vi.stubEnv("VITE_LAB_LOCAL", "");
    expect(SCREEN_ONLY.filter(knownId)).toEqual(BREAKOUT_PUBLIC ? SCREEN_ONLY : []);
    expect(SCREEN_ONLY_SOURCES.filter(knownId)).toEqual(BREAKOUT_PUBLIC ? SCREEN_ONLY_SOURCES : []);
  });

  it("Given the public build Then the ids the rest of the lab names are still known, with their grade, range and provisional chip", () => {
    vi.stubEnv("VITE_LAB_LOCAL", "");
    // A001 (grade A, no source, [5, 100] reactors), A004 (grade S on S017, main-reread, and S019, which is not: provisional), A189 (the horizon, named by the default scenario and by the SC12
    // scenarios: grade A, no source, [14, 42] d). The ids are typed from docs/research/assumptions.yaml.
    expect(["A001", "A004", "A189", "A095", "S099"].filter((id) => !knownId(id))).toEqual([]);
    expect(gradeOf(["A001"])).toBe("A");
    expect(rangeOf("A001")).toEqual([5, 100]);
    expect(isProvisional("A001")).toBe(false);
    expect(gradeOf(["A004"])).toBe("S");
    expect(isProvisional("A004")).toBe(true);
    expect(rangeOf("A189")).toEqual([14, 42]);
    expect(isProvisional("A189")).toBe(false);
    expect(isProvisional("S099")).toBe(true); // below main-reread, and followed to by A095 (the controller deadband), which the lab names
  });

  it("Given the public build Then an id that only the Break-out files name has no grade (A176 is grade A in the ledger)", () => {
    vi.stubEnv("VITE_LAB_LOCAL", "");
    expect(gradeOf(["A176"])).toBe(BREAKOUT_PUBLIC ? "A" : null);
  });
});

describe("the ledger view of a local build", () => {
  it("Given VITE_LAB_LOCAL=1 Then it knows every id that only the Break-out files name and every source behind them", () => {
    vi.stubEnv("VITE_LAB_LOCAL", "1");
    expect(SCREEN_ONLY.filter((id) => !knownId(id))).toEqual([]);
    expect(SCREEN_ONLY_SOURCES.filter((id) => !knownId(id))).toEqual([]);
    expect(gradeOf(["A157"])).toBe("A");
    expect(isProvisional("A157")).toBe(true);
  });

  it.each(["0", "true", "yes", ""])("Given VITE_LAB_LOCAL=%j Then it is not a local build: only 1 is", (value) => {
    vi.stubEnv("VITE_LAB_LOCAL", value);
    expect(knownId("A176")).toBe(BREAKOUT_PUBLIC);
  });
});
