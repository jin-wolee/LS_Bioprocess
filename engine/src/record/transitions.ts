// The state machines of data_model section 6 as a guard (S2d, Step 9). The recorder, the validation rules and the review change a row's state only through `transit`, which refuses a
// transition that is not in the table and a role that may not cause it. The table is the same as `state_machines` in docs/design/data_dictionary.yaml; tests/test_data_dictionary.py
// compares the two, so the dictionary and the code cannot drift apart.
//
// Roles are the five of section 6 (sampler, analyst, reviewer, approver, administrator) plus `rule`, the actor kind of a step that no person causes: the import of an instrument
// result, a validation rule (section 8) and the volume budget (VR-016). A step that section 6 draws without a label takes the role of the neighbouring labelled step
// (S2d default, recorded in the dictionary as basis `default`; the diagram's own labels are basis `diagram`).
//
// A result row with `state` null is in `measured`, the initial state (section 6): no transition has acted on it. `under_review` has no duration in the simulator (section 7, "Review
// step"): the review performs both steps of the diagram at one instant.

export const ROLES = ["sampler", "analyst", "reviewer", "approver", "administrator", "rule"] as const;
export type Role = (typeof ROLES)[number];
export type Entity = "sample" | "result";

export interface Edge {
  from: string;
  to: string;
  /** The roles allowed to cause the transition. */
  by: readonly Role[];
}

export interface Transition {
  entity: Entity;
  from: string;
  to: string;
  by: Role;
}

export const MACHINES: Readonly<Record<Entity, readonly Edge[]>> = {
  // data_model section 6, first diagram
  sample: [
    { from: "planned", to: "drawn", by: ["sampler"] },
    { from: "planned", to: "skipped", by: ["rule"] },
    { from: "drawn", to: "in_transit", by: ["sampler"] },
    { from: "in_transit", to: "received", by: ["analyst"] },
    { from: "received", to: "aliquoted", by: ["analyst"] },
    { from: "aliquoted", to: "closed", by: ["analyst"] },
    { from: "drawn", to: "quarantined", by: ["rule"] },
    { from: "received", to: "quarantined", by: ["rule"] },
    { from: "quarantined", to: "received", by: ["reviewer"] },
    { from: "quarantined", to: "discarded", by: ["reviewer"] },
  ],
  // data_model section 6, second diagram, plus measured -> rejected (VR-014 rejects at ingest, section 7 "Result state")
  result: [
    { from: "measured", to: "held", by: ["rule"] },
    { from: "measured", to: "quarantined", by: ["rule"] },
    { from: "measured", to: "rejected", by: ["rule"] },
    { from: "measured", to: "under_review", by: ["reviewer"] },
    { from: "held", to: "under_review", by: ["reviewer"] },
    { from: "quarantined", to: "under_review", by: ["reviewer"] },
    { from: "under_review", to: "released", by: ["approver"] },
    { from: "under_review", to: "rejected", by: ["reviewer"] },
    { from: "released", to: "superseded", by: ["approver"] },
  ],
};

/**
 * Performs one transition: returns the new state, or throws when the table does not list it or the role may not cause it. `log` collects what was performed (a test reads it).
 */
export const transit = (entity: Entity, from: string, to: string, by: Role, log?: Transition[]): string => {
  const edge = MACHINES[entity].find((e) => e.from === from && e.to === to);
  if (!edge) throw new Error(`transition refused: ${entity} ${from} -> ${to} is not in the table (data_model section 6)`);
  if (!edge.by.includes(by)) throw new Error(`transition refused: role ${by} may not cause ${entity} ${from} -> ${to} (allowed: ${edge.by.join(", ")})`);
  log?.push({ entity, from, to, by });
  return to;
};
