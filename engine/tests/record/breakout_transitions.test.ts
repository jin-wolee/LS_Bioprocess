import { describe, expect, it } from "vitest";
import { MACHINES, transit } from "../../src/record/transitions.ts";
import type { Entity, Role } from "../../src/record/transitions.ts";

// Break-out batch 3: the state machines of data_model 15.2 as a guard, next to those of section 6. The states and the order of the steps are typed by hand from the text of 15.2; the roles are the
// batch's own default (the text draws no diagram, so every step is basis `default` in the dictionary): a step that follows from a fact takes the automatic actor, a step a person decides takes a role.
//   material_lot  "prepared, available, in use, consumed or discarded; side states on hold and quarantined while a quality_hold covers it"
//   equipment     "in service; side states on hold and quarantined while a quality_hold covers it"
//   quality_hold  "placed, under test (confirming requests open), then released or converted to quarantine and rejected; closed with its deviation"
//   deviation     "opened, contained (the holds of the investigation are placed), concluded (all confirming results are in), closed"

const NEW = ["material_lot", "equipment", "quality_hold", "deviation"] as const satisfies readonly Entity[];
const states = (m: Entity): string[] => [...new Set(MACHINES[m].flatMap((t) => [t.from, t.to]))].sort();
const pairs = (m: Entity): string[] => MACHINES[m].map((t) => `${t.from}>${t.to}`).sort();

describe("the machines of data_model 15.2 have exactly the states of the text", () => {
  it("Then each of the four has its states and nothing else", () => {
    expect(states("material_lot")).toEqual(["available", "consumed", "discarded", "in_use", "on_hold", "prepared", "quarantined"]);
    expect(states("equipment")).toEqual(["in_service", "on_hold", "quarantined"]);
    expect(states("quality_hold")).toEqual(["closed", "placed", "quarantined", "rejected", "released", "under_test"]);
    expect(states("deviation")).toEqual(["closed", "concluded", "contained", "opened"]);
  });

  it("Then the steps are the ones the text lists, in order, and the side states are entered from a live state", () => {
    expect(pairs("material_lot")).toEqual(["available>in_use", "available>on_hold", "in_use>consumed", "in_use>discarded", "in_use>on_hold", "on_hold>available", "on_hold>in_use", "on_hold>quarantined", "prepared>available"]);
    expect(pairs("equipment")).toEqual(["in_service>on_hold", "on_hold>in_service", "on_hold>quarantined"]);
    expect(pairs("quality_hold")).toEqual(["placed>under_test", "quarantined>rejected", "rejected>closed", "released>closed", "under_test>quarantined", "under_test>released"]);
    expect(pairs("deviation")).toEqual(["concluded>closed", "contained>concluded", "opened>contained"]);
  });

  it("Then no machine of the new four lets a step jump a state of the text", () => {
    const refused: [Entity, string, string, Role][] = [
      ["material_lot", "prepared", "in_use", "rule"], // it becomes available first
      ["material_lot", "consumed", "available", "rule"], // an end state
      ["material_lot", "available", "quarantined", "rule"], // through on_hold
      ["equipment", "in_service", "quarantined", "rule"], // through on_hold
      ["quality_hold", "placed", "released", "reviewer"], // it is under test first
      ["quality_hold", "under_test", "rejected", "reviewer"], // quarantine first, then rejected
      ["quality_hold", "closed", "placed", "rule"], // closed with its deviation: final
      ["deviation", "opened", "closed", "reviewer"], // contained and concluded first
      ["deviation", "closed", "opened", "rule"],
    ];
    for (const [entity, from, to, by] of refused) expect(() => transit(entity, from, to, by), `${entity} ${from} -> ${to}`).toThrow(/not in the table/);
  });

  it("Then a role the table does not name may not cause a step, and the refusal names the role", () => {
    expect(() => transit("material_lot", "available", "in_use", "reviewer")).toThrow(/role reviewer may not cause material_lot available -> in_use/);
    expect(() => transit("material_lot", "on_hold", "available", "rule")).toThrow(/role rule may not cause material_lot on_hold -> available/); // a person releases a hold
    expect(() => transit("deviation", "concluded", "closed", "rule")).toThrow(/role rule may not cause deviation concluded -> closed/); // a person closes the written record
  });

  it("Then a lot goes from prepared to consumed by the steps of the text, each by its role", () => {
    expect(transit("material_lot", "prepared", "available", "administrator")).toBe("available");
    expect(transit("material_lot", "available", "in_use", "rule")).toBe("in_use");
    expect(transit("material_lot", "in_use", "on_hold", "rule")).toBe("on_hold");
    expect(transit("material_lot", "on_hold", "in_use", "reviewer")).toBe("in_use");
    expect(transit("material_lot", "in_use", "consumed", "rule")).toBe("consumed");
  });

  it("Then the new machines are in the table beside the four of section 6 and 16.5, and only those", () => {
    expect(Object.keys(MACHINES).sort()).toEqual(["alarm_event", "batch_phase_record", "deviation", "equipment", "material_lot", "quality_hold", "sample", "result"].sort());
    for (const m of NEW) expect(MACHINES[m].length).toBeGreaterThan(0);
  });
});
