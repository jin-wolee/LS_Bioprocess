import { describe, expect, it } from "vitest";
import type { PlantAction } from "../protocol.ts";
import { en } from "../i18n/en.ts";
import { ko } from "../i18n/ko.ts";
import { addressFor } from "./address.ts";
import { openingOf } from "./opening.ts";
import { REFUSAL_KEYS, refusalKey } from "./refusal.ts";
import { DEFAULT_PLANT as SPEC } from "./spec.ts";

// P6a (docs/design/plant_ui.md sections 5.5 and 5.6, "As built in P6a"): where the clock resumes, what the address holds, and the sentence for a refusal. Expected values are typed by hand.

describe("where the clock opens", () => {
  const resume = { epoch: 3, t: 291600, play: true };

  it("Given the answer of an action Then the clock resumes at resume_at and plays as it did, whatever the link or the saved view says", () => {
    expect(openingOf({ resume, epoch: 3, linkT: 100, viewT: 200, horizon: 691200 })).toEqual({ t: 291600, fault: null, play: true });
    expect(openingOf({ resume: { ...resume, play: false }, epoch: 3, linkT: null, viewT: null, horizon: 691200 })).toEqual({ t: 291600, fault: null, play: false });
  });

  it("Given a resume for another epoch than the plan on screen Then it does not apply: the link's instant wins, then the saved one", () => {
    expect(openingOf({ resume, epoch: 4, linkT: 100, viewT: 200, horizon: 691200 })).toEqual({ t: 100, fault: null, play: null });
    expect(openingOf({ resume: null, epoch: 4, linkT: null, viewT: 200, horizon: 691200 })).toEqual({ t: 200, fault: null, play: null });
    expect(openingOf({ resume: null, epoch: null, linkT: null, viewT: null, horizon: 691200 })).toEqual({ t: null, fault: null, play: null });
  });

  it("Given a link instant beyond the horizon and no resume Then it is not used and the value is given back as the fault", () => {
    expect(openingOf({ resume: null, epoch: 1, linkT: 700000, viewT: null, horizon: 691200 })).toEqual({ t: null, fault: "700000", play: null });
  });
});

describe("what the address holds", () => {
  const E = "1.2.3";
  const feed: PlantAction = { kind: "add_feed", at: 291600, unit_id: "U03" };
  const base = "#/plant?scenario=default&arch=a_manual,b_lims_lite,c_context&seed=1";
  const FEED_QUERY = "actions=%5B%7B%22kind%22%3A%22add_feed%22%2C%22at%22%3A291600%2C%22unit_id%22%3A%22U03%22%7D%5D";

  it("Given a list with an action Then the address is the plant link of the spec, with the actions and no instant", () => {
    expect(addressFor({ ...SPEC, actions: [feed] }, E, "#/plant")).toBe(`${base}&${FEED_QUERY}&schema=1&engine=1.2.3`);
  });

  it("Given the address already holds that link Then nothing is written (no write for nothing)", () => {
    const link = `${base}&${FEED_QUERY}&schema=1&engine=1.2.3`;
    expect(addressFor({ ...SPEC, actions: [feed] }, E, link)).toBeNull();
  });

  it("Given no action and an address without actions Then the address is left alone: entering the plant does not rewrite it", () => {
    expect(addressFor(SPEC, E, "#/plant")).toBeNull();
    expect(addressFor(SPEC, E, "#/plant?seed=1&t=28800")).toBeNull();
  });

  it("Given the last action undone while the address carries actions Then the address is written again without them", () => {
    expect(addressFor(SPEC, E, `${base}&${FEED_QUERY}&schema=1&engine=1.2.3`)).toBe(`${base}&schema=1&engine=1.2.3`);
  });
});

describe("the sentence for a refusal", () => {
  it("Given a refusal with a reason of section 5.6 Then its key is plant.refusal.<reason>", () => {
    for (const reason of ["past", "unknown_target", "outside_window", "closed_loop", "limit"] as const) {
      expect(refusalKey({ code: "refused", reason })).toBe(`plant.refusal.${reason}`);
    }
  });

  it("Given a locked answer Then plant.refusal.locked; given any other error or a refusal with no reason Then plant.refusal.other", () => {
    expect(refusalKey({ code: "locked" })).toBe("plant.refusal.locked");
    expect(refusalKey({ code: "engine_error" })).toBe("plant.refusal.other");
    expect(refusalKey({ code: "invalid_spec" })).toBe("plant.refusal.other");
    expect(refusalKey({ code: "refused" })).toBe("plant.refusal.other");
  });

  it("Given the keys Then there are seven, each in English and in Korean, none of them with a digit, and the causality text is there too", () => {
    expect(REFUSAL_KEYS).toEqual([
      "plant.refusal.past", "plant.refusal.unknown_target", "plant.refusal.outside_window", "plant.refusal.closed_loop", "plant.refusal.limit", "plant.refusal.locked", "plant.refusal.other",
    ]);
    for (const key of [...REFUSAL_KEYS, "plant.refusal.causality" as const]) {
      expect(en[key], key).toBeTruthy();
      expect(ko[key], key).toBeTruthy();
      expect(en[key], key).not.toMatch(/\d/);
      expect(ko[key], key).not.toMatch(/\d/);
    }
  });
});
