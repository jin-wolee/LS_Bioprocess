import { describe, expect, it } from "vitest";
import { reviewVersion } from "../../src/record/review.ts";
import type { Transition } from "../../src/record/transitions.ts";
import type { ResultRow } from "../../src/record/types.ts";
import { H } from "../support/breakout_streams.ts";

// Break-out batch 4: the review of a retro-flag version (data_model 15.3 item 4, section 6 state diagram; section 7, "Review step"). A quarantined version goes through under_review at the review
// point: the reviewer rejects it after a positive result (the value is kept, no available_at) and the approver releases it again after a negative one (with available_at on, available_at is the
// review point). Expected rows are typed from those rules; the transitions from the table of section 6.

const version: ResultRow = {
  result_id: "RF1", request_id: "U01-S2", analyte: "glucose", version: 2, run_id: "U01-S2/1/1", value: 5, measured_at: H(9), available_at: H(19), supersedes: "R2", ingested_at: H(19), reviewed_at: null,
  state: "quarantined", outcome: null, hold_id: "H3",
};

describe("reviewVersion", () => {
  it("Given a quarantined version When the outcome is rejected Then it is rejected with its value kept, reviewed at the point and never available; the other fields stay", () => {
    const log: Transition[] = [];
    const out = reviewVersion(version, "rejected", H(152), true, log);
    expect(out).toEqual({ ...version, state: "rejected", reviewed_at: H(152), available_at: null });
    expect(log).toEqual([{ entity: "result", from: "quarantined", to: "under_review", by: "reviewer" }, { entity: "result", from: "under_review", to: "rejected", by: "reviewer" }]);
  });

  it("Given a quarantined version When the outcome is released with available_at on Then it is released with the same value, reviewed and available at the point", () => {
    const log: Transition[] = [];
    const out = reviewVersion(version, "released", H(368), true, log);
    expect(out).toEqual({ ...version, state: "released", reviewed_at: H(368), available_at: H(368) });
    expect(log).toEqual([{ entity: "result", from: "quarantined", to: "under_review", by: "reviewer" }, { entity: "result", from: "under_review", to: "released", by: "approver" }]);
  });

  it("Given available_at off When the version is released Then available_at is left as it was", () => {
    expect(reviewVersion({ ...version, available_at: null }, "released", H(368), false).available_at).toBeNull();
  });

  it("Given a version that is not quarantined When it is reviewed Then the table refuses it", () => {
    expect(() => reviewVersion({ ...version, state: "released" }, "rejected", H(152), true)).toThrow(/transition refused/);
  });
});
