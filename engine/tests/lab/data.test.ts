import { describe, expect, it } from "vitest";
import { knownId } from "../../../src/ledger.ts";
import { LAB_DATA, SHIPPED } from "../../../src/worker/data.ts";
import { LAB_PROFILES, labData } from "../support/lab_data.ts";
import { readJson } from "../support/paths.ts";
import { lookup } from "../support/scenarios.ts";

// What the Worker bundles (src/worker/data.ts) is what the files say, and every ledger id those files name resolves in the ledger view of the page (lab_ui.md section 6).

/** The ids a document names: the `ref` of every parameter ({value, unit, ref}, ADR-0012) and the `bundle` of a profile. */
const refsIn = (doc: unknown, found = new Set<string>()): Set<string> => {
  if (Array.isArray(doc)) doc.forEach((d) => refsIn(d, found));
  else if (doc && typeof doc === "object") {
    for (const [key, value] of Object.entries(doc)) {
      if ((key === "ref" || key === "bundle") && typeof value === "string") found.add(value);
      else refsIn(value, found);
    }
  }
  return found;
};

describe("the bundled data", () => {
  const files = labData();

  it("Given the bundle and the files Then the scenarios, profiles, dialects, presets, evaluation settings, seed list and raw-layer inputs are the same documents", () => {
    expect(LAB_DATA.scenarios).toEqual(files.scenarios);
    expect(LAB_DATA.profiles).toEqual(files.profiles);
    expect(LAB_DATA.dialects).toEqual(files.dialects);
    expect(LAB_DATA.architectures).toEqual(files.architectures);
    expect(LAB_DATA.evaluation).toEqual(files.evaluation);
    expect(LAB_DATA.experiment).toEqual(files.experiment);
    expect(LAB_DATA.rawLayer).toEqual(files.rawLayer);
  });

  it("Given the decision variant Then the bundle holds SC8 and the experiment 2 config as the files say, and SC8 is not among the scenarios of the Setup picker", () => {
    expect(LAB_DATA.decision).toEqual({ scenario: readJson("scenarios", "sc08_ph_restandardisation.json"), experiment: readJson("scenarios", "experiments", "experiment2.json") });
    expect(Object.keys(LAB_DATA.scenarios)).not.toContain("sc08_ph_restandardisation");
  });

  it("Given each bundled profile Then the bundle returns the document of the file", () => {
    for (const [kind, id] of LAB_PROFILES) expect(LAB_DATA.lookup(kind, id), `${kind}/${id}`).toEqual(lookup(kind, id));
  });

  it("Given a profile the lab does not offer Then the lookup throws and says so", () => {
    expect(() => LAB_DATA.lookup("controller", "ctrl_bench")).toThrow(/no bundled controller profile/);
    expect(() => LAB_DATA.lookup("analyzer", "no_such")).toThrow(/no bundled analyzer profile no_such/);
    expect(() => LAB_DATA.lookup("staff", "hplc")).toThrow(/no bundled staff profile hplc/);
  });
});

describe("every shipped ref resolves", () => {
  const refs = [...refsIn(SHIPPED)].sort();

  it("Given the files the Worker bundles Then they name ledger ids, all of the shape A### or S###", () => {
    expect(refs.length).toBeGreaterThan(20);
    expect(refs.every((r) => /^[AS]\d{3}$/.test(r))).toBe(true);
  });

  it("Given each id Then the ledger view of the page knows it (scripts/lab_ledger.py --write after a change)", () => {
    expect(refs.filter((r) => !knownId(r))).toEqual([]);
  });

  it("Given the bundle ids and the zone of the raw layer Then they are among the ids (A065 to A073 and A161)", () => {
    for (const id of ["A065", "A067", "A068", "A069", "A070", "A071", "A072", "A073", "A161"]) expect(refs, id).toContain(id);
  });

  it("Given the decision variant Then the inputs of its loop are among the ids (A041 to A043, A046, A051, A064, A108)", () => {
    for (const id of ["A041", "A042", "A043", "A046", "A051", "A064", "A108"]) expect(refs, id).toContain(id);
  });

  it("Given the ledger view Then an id of no ledger is not known", () => {
    expect(knownId("X001")).toBe(false);
  });
});
