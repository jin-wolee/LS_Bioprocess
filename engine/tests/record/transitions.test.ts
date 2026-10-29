import { describe, expect, it } from "vitest";
import { MACHINES, ROLES, transit } from "../../src/record/transitions.ts";
import type { Transition } from "../../src/record/transitions.ts";
import { record } from "../../src/record/recorder.ts";
import { review } from "../../src/record/review.ts";
import { validate } from "../../src/record/validate.ts";
import { ROSTER } from "../support/review_setup.ts";
import { SENSORS, STREAM, WITH_SKIP, arch } from "../support/record_fixture.ts";
import { FLAG_NAMES } from "../../src/record/architecture.ts";

// Step 9: the state machines of data_model section 6 as a guard in the recorder, the validation rules and the review. A transition is performed through `transit`, which refuses
// one that is not in the table or whose role is not allowed to cause it; the same table is in docs/design/data_dictionary.yaml (tests/test_data_dictionary.py compares the two).
// Expected transitions are typed by hand from the state diagrams of section 6 and the review step of section 7.

const C = arch(...FLAG_NAMES);

describe("the guard refuses what the table does not list", () => {
  it("Given a transition of the table When it is performed by its role Then it returns the new state and logs it", () => {
    const log: Transition[] = [];
    expect(transit("result", "measured", "held", "rule", log)).toBe("held");
    expect(transit("result", "under_review", "released", "approver", log)).toBe("released");
    expect(transit("sample", "planned", "skipped", "rule", log)).toBe("skipped");
    expect(log).toEqual([
      { entity: "result", from: "measured", to: "held", by: "rule" },
      { entity: "result", from: "under_review", to: "released", by: "approver" },
      { entity: "sample", from: "planned", to: "skipped", by: "rule" },
    ]);
  });

  it.each([
    ["released", "held", "rule", /not in the table/], // a released row is immutable (K8): it can only be superseded
    ["rejected", "released", "approver", /not in the table/], // rejected is final
    ["held", "released", "approver", /not in the table/], // the review goes through under_review
    ["measured", "released", "approver", /not in the table/],
  ])("Given the transition %s -> %s by %s When it is performed Then it is refused: %j", (from, to, by, message) => {
    expect(() => transit("result", from, to, by as (typeof ROLES)[number])).toThrow(message);
  });

  it("Given a listed transition performed by a role the table does not allow When it is performed Then it is refused naming the role", () => {
    expect(() => transit("result", "under_review", "released", "reviewer")).toThrow(/role reviewer may not cause result under_review -> released/); // the approver releases
    expect(() => transit("sample", "planned", "drawn", "analyst")).toThrow(/role analyst may not cause sample planned -> drawn/); // the sampler draws
  });

  it("Given a state that the machine does not have When it is performed Then it is refused", () => {
    expect(() => transit("result", "measured", "frozen", "rule")).toThrow(/not in the table/);
  });

  it("Then the table has the states of data_model section 6 and nothing else", () => {
    const states = (m: keyof typeof MACHINES): string[] => [...new Set(MACHINES[m].flatMap((t) => [t.from, t.to]))].sort();
    expect(states("result")).toEqual(["held", "measured", "quarantined", "rejected", "released", "superseded", "under_review"]);
    expect(states("sample")).toEqual(["aliquoted", "closed", "discarded", "drawn", "in_transit", "planned", "quarantined", "received", "skipped"]);
  });
});

describe("the guard changes no output (ruling 3: existing review outputs stay the same)", () => {
  it("Given the same dataset When validate and review run with and without a log Then the datasets are identical, so the explicit under_review step moved no value, state, stamp or finding", () => {
    const ds = record({ events: STREAM, sensors: SENSORS }, C);
    const plain = review(validate(ds, { hold_limit_s: 1800 }).dataset, { roster: ROSTER, timing: "next_shift_start" });
    const logged = review(validate(ds, { hold_limit_s: 1800 }, []).dataset, { roster: ROSTER, timing: "next_shift_start" }, []);
    expect(logged).toEqual(plain);
    // the rows themselves are the hand-typed outcome of review.test.ts for this fixture: S1 and S3 released at their review point, both S2 attempts rejected with no available_at
    expect(plain.result.map((r) => [r.request_id, r.state, r.reviewed_at, r.available_at])).toEqual([["S1", "released", 28800, 28800], ["S2", "rejected", 28800, null], ["S2", "rejected", 28800, null], ["S3", "released", 28800, 28800]]);
  });
});

describe("the recorder, the rules and the review perform only listed transitions", () => {
  it("Given a skipped draw in C When it is recorded Then the sample row is skipped through planned -> skipped by a rule", () => {
    const log: Transition[] = [];
    const ds = record({ events: WITH_SKIP, sensors: SENSORS }, C, log);
    expect(ds.sample.find((s) => s.sample_id === "S4")?.state).toBe("skipped");
    expect(log).toEqual([{ entity: "sample", from: "planned", to: "skipped", by: "rule" }]);
  });

  it("Given C on the fixture with a hold limit When rules and review run Then each held row goes measured -> held -> under_review -> rejected by rule, reviewer, reviewer", () => {
    const log: Transition[] = [];
    const ds = record({ events: STREAM, sensors: SENSORS }, C);
    // S2's first attempt failed QC (VR-012) and its rerun was run 3500 s after the draw, beyond the limit of 1800 (VR-010); no qualification record is given, so VR-015 holds all four rows (released at review)
    const reviewed = review(validate(ds, { hold_limit_s: 1800 }, log).dataset, { roster: ROSTER, timing: "next_shift_start" }, log);
    const states = reviewed.result.map((r) => [r.request_id, r.version, r.state]);
    expect(states).toEqual([["S1", 1, "released"], ["S2", 1, "rejected"], ["S2", 2, "rejected"], ["S3", 1, "released"]]);
    const pairs = new Set(log.map((t) => `${t.from} -> ${t.to} by ${t.by}`));
    expect([...pairs].sort()).toEqual([
      "held -> under_review by reviewer", "measured -> held by rule", "under_review -> rejected by reviewer", "under_review -> released by approver",
    ]);
    expect(log.filter((t) => t.to === "released").length).toBe(2); // S1 and S3 (VR-015 only)
    expect(log.filter((t) => t.to === "rejected").length).toBe(2); // S2 version 1 (VR-012, VR-015) and version 2 (VR-010, VR-015): any rejecting rule wins
  });
});
