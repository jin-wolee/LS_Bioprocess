import { afterEach, describe, expect, it, vi } from "vitest";
import { BREAKOUT_PUBLIC } from "./generated/breakout_public.ts";
import { offerOf } from "./breakout_offer.ts";

// Whether a build offers the Break-out screen (lab_ui.md sections 6 and 20; ADR-0013; the S3a ruling, Open item 2). The rule is written by scripts/lab_ledger.py into src/generated/breakout_public.ts
// (tests/test_lab_ledger.py holds it to the ledgers, with a throwaway copy of them in which the sources read main-reread); here the page side: what a build does with the rule.

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("offerOf", () => {
  it.each([
    [true, false, "offered"],
    [true, true, "offered"],
    [false, true, "local_only"],
    [false, false, "refused"],
  ] as const)("Given public %s and local %s Then the screen is %s", (publicOk, local, offer) => {
    expect(offerOf(publicOk, local)).toBe(offer);
  });
});

describe("a build", () => {
  const load = async (local: string | undefined) => {
    vi.resetModules();
    vi.stubEnv("VITE_LAB_LOCAL", local ?? "");
    const { OFFER } = await import("./breakout_offer.ts");
    const { LAB_DATA, SHIPPED } = await import("./worker/data.ts");
    return { OFFER, LAB_DATA, SHIPPED };
  };

  it("Given the public build (no VITE_LAB_LOCAL) Then the screen is offered only if no id of it follows to a source below main-reread, and the Worker bundles its files exactly then", async () => {
    const { OFFER, LAB_DATA, SHIPPED } = await load(undefined);
    expect(OFFER).toBe(BREAKOUT_PUBLIC ? "offered" : "refused");
    expect("breakout" in LAB_DATA).toBe(BREAKOUT_PUBLIC);
    const named = JSON.stringify(SHIPPED).includes("sc12_medium_lot");
    expect(named).toBe(BREAKOUT_PUBLIC);
  });

  it("Given a local build (VITE_LAB_LOCAL=1) Then the screen is offered, marked not for publication while a source is below main-reread, and the Worker bundles the five scenarios, both profiles and the config", async () => {
    const { OFFER, LAB_DATA } = await load("1");
    expect(OFFER).toBe(BREAKOUT_PUBLIC ? "offered" : "local_only");
    expect(Object.keys(LAB_DATA.breakout?.scenarios ?? {})).toEqual(["sc12_medium_lot", "sc12_seed_lot", "sc12_sampling", "sc12_equipment", "sc12_mycoplasma"]);
    expect(LAB_DATA.breakout?.profiles).toHaveLength(2);
  });

  it.each(["0", "true", "yes", ""])("Given VITE_LAB_LOCAL=%j Then it is not a local build: only 1 is", async (value) => {
    const { OFFER } = await load(value);
    expect(OFFER).toBe(BREAKOUT_PUBLIC ? "offered" : "refused");
  });
});
