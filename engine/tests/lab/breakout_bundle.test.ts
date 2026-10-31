import { afterEach, describe, expect, it, vi } from "vitest";
import { knownId } from "../../../src/ledger.ts";
import { BREAKOUT_SCENARIOS, breakoutData } from "./breakout_data.ts";

// What the Worker bundles for the Break-out screen (src/worker/data.ts) is what the files say, and every ledger id those files name resolves in the ledger view of the page (lab_ui.md sections
// 6 and 20). The files are bundled only in a build that offers the screen, so the test loads the bundle as a local build does (VITE_LAB_LOCAL=1).

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

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

const localBundle = async () => {
  vi.resetModules();
  vi.stubEnv("VITE_LAB_LOCAL", "1");
  return import("../../../src/worker/data.ts");
};

describe("the bundled break-out data", () => {
  it("Given a local build Then the bundle holds the five SC12 scenarios, the two event-type profiles and the SC12 config, as the files say", async () => {
    const { LAB_DATA } = await localBundle();
    expect(LAB_DATA.breakout).toEqual(breakoutData().breakout);
    expect(Object.keys(LAB_DATA.breakout?.scenarios ?? {})).toEqual([...BREAKOUT_SCENARIOS]);
  });

  it("Given the SC12 scenarios Then they are not among the scenarios of the Setup picker", async () => {
    const { LAB_DATA } = await localBundle();
    expect(Object.keys(LAB_DATA.scenarios).filter((id) => id.startsWith("sc12"))).toEqual([]);
  });

  it("Given a local build Then every ledger id the shipped files name is known to the ledger view of the page (scripts/lab_ledger.py --write after a change)", async () => {
    const { SHIPPED } = await localBundle();
    const refs = [...refsIn(SHIPPED)].sort();
    expect(refs).toEqual(expect.arrayContaining(["A157", "A176", "A177", "A189", "A219", "A226"]));
    expect(refs.filter((r) => !knownId(r))).toEqual([]);
  });
});
