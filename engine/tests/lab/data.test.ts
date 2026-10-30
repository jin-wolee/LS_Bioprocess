import { describe, expect, it } from "vitest";
import { knownId } from "../../../src/ledger.ts";
import { LAB_DATA, SHIPPED } from "../../../src/worker/data.ts";
import { labData } from "../support/lab_data.ts";
import { lookup } from "../support/scenarios.ts";

// What the Worker bundles (src/worker/data.ts) is what the files say, and every ledger id those files name resolves in the ledger view of the page (lab_ui.md section 6).

const refsIn = (doc: unknown, found = new Set<string>()): Set<string> => {
  if (Array.isArray(doc)) doc.forEach((d) => refsIn(d, found));
  else if (doc && typeof doc === "object") {
    for (const [key, value] of Object.entries(doc)) {
      if (key === "ref" && typeof value === "string") found.add(value);
      else refsIn(value, found);
    }
  }
  return found;
};

describe("the bundled data", () => {
  const files = labData();

  it("Given the bundle and the files Then the scenario, the three presets and the evaluation settings are the same documents", () => {
    expect(LAB_DATA.scenarios).toEqual(files.scenarios);
    expect(LAB_DATA.architectures).toEqual(files.architectures);
    expect(LAB_DATA.evaluation).toEqual(files.evaluation);
  });

  it("Given the profiles the default scenario names Then the bundle returns the documents of the files", () => {
    for (const [kind, id] of [["bioreactor", "bench_manual"], ["analyzer", "allinone_atline"], ["staff", "experienced"]] as const) {
      expect(LAB_DATA.lookup(kind, id), `${kind}/${id}`).toEqual(lookup(kind, id));
    }
  });

  it("Given a profile the lab does not offer Then the lookup throws and says so", () => {
    expect(() => LAB_DATA.lookup("analyzer", "hplc")).toThrow(/no bundled analyzer profile hplc/);
    expect(() => LAB_DATA.lookup("controller", "ctrl_bench")).toThrow(/no bundled controller profile/);
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

  it("Given the ledger view Then an id of no ledger is not known", () => {
    expect(knownId("X001")).toBe(false);
  });
});
