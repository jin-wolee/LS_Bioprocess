import { describe, expect, it } from "vitest";
import type { PlantSpec } from "../protocol.ts";
import { READY } from "./fixture.ts";
import { defaultLineageForm, editLineage, lineageRequest, plantLineageForm } from "./lineage_form.ts";

// P5c (docs/design/plant_ui.md section 7, "As built in P5c"): the Lineage screen opened from the plant asks `lineage` for the run the plant shows. The form is made from the plant's spec and the sample of the
// link; its request carries the plant's settings, lists, capture path and actions (the field is sent even when the list is empty); a form that was not opened from the plant makes the request it always made.

const FEED = { kind: "add_feed" as const, at: 291600, unit_id: "U03" };
const spec: PlantSpec = {
  run: { schema_version: "1", scenario: "small", settings: { reactor_count: 6, bay_size: 6 }, bay_profiles: ["pilot"], capture_path: "adapter_ingest", architectures: ["a_manual", "c_context", "c_context_minus_audit_trail"], seeds: [41] },
  seed: 41,
  actions: [FEED],
};

describe("plantLineageForm", () => {
  it("Given a plant and a sample Then the form shows the run and the sample: the scenario, the seed, the sample picked by the reader, the presets and the ablation among the halls", () => {
    expect(plantLineageForm(READY, spec, "U03-D03-1")).toEqual({
      scenario: "small", seed: "41", pick: "reader", sample: "U03-D03-1", archs: ["a_manual", "c_context"], ablation: "c_context_minus_audit_trail", plant: spec,
    });
  });
});

describe("lineageRequest from the plant", () => {
  const form = plantLineageForm(READY, spec, "U03-D03-1");

  it("Given the form Then the request is the plant's run for the one seed with the sample and the plant's actions: the settings, the lists, the capture path and the halls as the plant has them", () => {
    expect(lineageRequest(form, 9)).toEqual({
      type: "lineage", id: 9, seed: 41, pick: { sample_id: "U03-D03-1" }, actions: [FEED],
      spec: { schema_version: "1", scenario: "small", settings: { reactor_count: 6, bay_size: 6 }, bay_profiles: ["pilot"], capture_path: "adapter_ingest", architectures: ["a_manual", "c_context", "c_context_minus_audit_trail"], seeds: [41] },
    });
  });

  it("Given a plant with no action Then the field is sent all the same, as an empty list", () => {
    expect(lineageRequest(plantLineageForm(READY, { ...spec, actions: [] }, "U03-D03-1"), 9)).toMatchObject({ actions: [] });
  });

  it("Given the reader picks another sample of the same run Then the request is for that sample and still the plant's", () => {
    expect(lineageRequest(editLineage(form, { sample: " U03-D04-1 " }), 9)).toMatchObject({ pick: { sample_id: "U03-D04-1" }, actions: [FEED], seed: 41 });
  });

  it("Given no sample Then no request is made", () => {
    expect(lineageRequest(editLineage(form, { sample: "" }), 9)).toBeNull();
  });

  it("Given a form that was not opened from the plant Then the request has no actions field at all, as before", () => {
    const own = lineageRequest(defaultLineageForm(READY), 9);
    expect(own).not.toBeNull();
    expect(own).not.toHaveProperty("actions");
  });
});

describe("editLineage: the plant stays while the run is the plant's", () => {
  const form = plantLineageForm(READY, spec, "U03-D03-1");

  it.each([["the sample", { sample: "U03-D04-1" }], ["the way the sample is picked", { pick: "reader" as const }]])("Given %s changed Then the form is still the plant's", (_n, patch) => {
    expect(editLineage(form, patch).plant).toEqual(spec);
  });

  it.each([["the scenario", { scenario: "default" }], ["the seed", { seed: "42" }], ["the records", { archs: ["a_manual"] }], ["the ablation", { ablation: "" }]])("Given %s changed Then the run is not the plant's any more and the form is its own", (_n, patch) => {
    const edited = editLineage(form, patch);
    expect(edited).not.toHaveProperty("plant");
    expect(lineageRequest(edited, 9)).not.toHaveProperty("actions");
  });
});
