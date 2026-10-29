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
export type Entity = "sample" | "result" | "alarm_event" | "batch_phase_record";

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
  // S2e2, the controller records (data_model 16.5). The state of an instance is `to_state` of its latest record, and a controller log is append-only (K22): these tables are what the
  // adapter checks a logged transition against (VR-025), not steps that the recorder performs. The diagrams label no role among the five of section 6; a step the process causes (a
  // condition becoming active or clearing, a state that follows from the previous one) takes `rule`, and a step an operator causes (acknowledge, shelve, start, hold, restart, stop,
  // abort, reset) takes `analyst`, the person at the bench: a stand-in, because no operator role exists (basis `default` in the dictionary).
  alarm_event: [
    { from: "normal", to: "unacknowledged", by: ["rule"] },
    { from: "unacknowledged", to: "acknowledged", by: ["analyst"] },
    { from: "unacknowledged", to: "rtn_unacknowledged", by: ["rule"] },
    { from: "acknowledged", to: "normal", by: ["rule"] },
    { from: "rtn_unacknowledged", to: "normal", by: ["analyst"] },
    { from: "normal", to: "shelved", by: ["analyst"] },
    { from: "normal", to: "suppressed_by_design", by: ["rule"] },
    { from: "normal", to: "out_of_service", by: ["analyst"] },
    { from: "shelved", to: "normal", by: ["analyst"] },
    { from: "suppressed_by_design", to: "normal", by: ["rule"] },
    { from: "out_of_service", to: "normal", by: ["analyst"] },
  ],
  batch_phase_record: [
    { from: "idle", to: "running", by: ["analyst"] },
    { from: "running", to: "complete", by: ["rule"] },
    { from: "running", to: "pausing", by: ["analyst"] },
    { from: "pausing", to: "paused", by: ["rule"] },
    { from: "paused", to: "running", by: ["analyst"] },
    { from: "running", to: "holding", by: ["analyst"] },
    { from: "holding", to: "held", by: ["rule"] },
    { from: "held", to: "restarting", by: ["analyst"] },
    { from: "restarting", to: "running", by: ["rule"] },
    { from: "running", to: "stopping", by: ["analyst"] },
    { from: "paused", to: "stopping", by: ["analyst"] },
    { from: "held", to: "stopping", by: ["analyst"] },
    { from: "stopping", to: "stopped", by: ["rule"] },
    { from: "running", to: "aborting", by: ["analyst"] },
    { from: "held", to: "aborting", by: ["analyst"] },
    { from: "stopping", to: "aborting", by: ["analyst"] },
    { from: "aborting", to: "aborted", by: ["rule"] },
    { from: "complete", to: "resetting", by: ["analyst"] },
    { from: "stopped", to: "resetting", by: ["analyst"] },
    { from: "aborted", to: "resetting", by: ["analyst"] },
    { from: "resetting", to: "idle", by: ["rule"] },
  ],
};

/** Does the table list this transition, whoever causes it? The adapter asks this of a logged transition (VR-025); `transit` is what a step that this code performs goes through. */
export const isTransition = (entity: Entity, from: string, to: string): boolean => MACHINES[entity].some((e) => e.from === from && e.to === to);

/** The initial state of a machine: the state of an instance before its first record (data_model 16.5: `[*] --> normal`, `[*] --> idle`). */
export const INITIAL: Readonly<Partial<Record<Entity, string>>> = { alarm_event: "normal", batch_phase_record: "idle" };

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
