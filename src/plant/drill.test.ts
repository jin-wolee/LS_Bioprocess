import { describe, expect, it } from "vitest";
import type { PlantSpec } from "../protocol.ts";
import { fromQuery } from "../ui/form.ts";
import { READY } from "../ui/fixture.ts";
import { backLink, drillFromQuery, lineageLink, notesLink, setupLink } from "./drill.ts";
import type { DrillContext } from "./drill.ts";
import { plantFromQuery } from "./link.ts";
import { DEFAULT_PLANT } from "./spec.ts";

// The drill-downs of the plant (docs/design/plant_ui.md section 7, "As built in P5c"): a link to an S3 screen holds the plant it came from as one query value, `plant=<the plant link>`, with `from=plant`,
// and for Setup the Setup link of the plant's run, which the Setup screen already reads. The expected strings are typed by hand from the keys of the section.

const KNOWN = { scenarios: ["default", "small"], architectures: ["a_manual", "b_lims_lite", "c_context", "c_context_minus_audit_trail"] };
const ctx = (spec: PlantSpec = DEFAULT_PLANT): DrillContext => ({ spec, engine: "9.9.9", t: 305626, architectures: KNOWN.architectures });
const small: PlantSpec = {
  run: { schema_version: "1", scenario: "small", settings: { reactor_count: 6, bay_size: 6 }, bay_profiles: ["pilot"], capture_path: "adapter_ingest", architectures: ["a_manual", "c_context"], seeds: [41] },
  seed: 41,
  actions: [{ kind: "add_feed", at: 291600, unit_id: "U03" }],
};
// the default plant at 305,626 s as a plant link, percent-encoded as one query value
const DEFAULT_PLANT_VALUE = "scenario%3Ddefault%26arch%3Da_manual%2Cb_lims_lite%2Cc_context%26seed%3D1%26t%3D305626%26schema%3D1%26engine%3D9.9.9";

describe("the links", () => {
  it("Given a sample Then Lineage is opened with the sample and the plant", () => {
    expect(lineageLink(ctx(), "U03-D03-1")).toBe(`#/lineage?from=plant&sample=U03-D03-1&plant=${DEFAULT_PLANT_VALUE}`);
  });

  it("Given the card of a hall Then Setup is opened with the Setup link of the plant's run, over that hall, and the plant", () => {
    const setup = setupLink(ctx(small), ["c_context"]);
    expect(setup.startsWith("#/setup?scenario=small&set.bay_size=6&set.reactor_count=6&bays=pilot&arch=c_context&capture=adapter_ingest&schema=1&engine=9.9.9&from=plant&plant=")).toBe(true);
    expect(setup).not.toContain("focus=");
  });

  it("Given the analyzer Then Setup is opened over the halls of the run with the focus on the utilisation block", () => {
    const setup = setupLink(ctx(), ["a_manual", "b_lims_lite", "c_context"], "utilisation");
    expect(setup).toBe(`#/setup?scenario=default&arch=a_manual,b_lims_lite,c_context&schema=1&engine=9.9.9&from=plant&plant=${DEFAULT_PLANT_VALUE}&focus=utilisation`);
  });

  it("Given a hall that Setup does not know (one that set_flag made) Then the Setup link has no arch and Setup keeps its own", () => {
    expect(setupLink(ctx(), ["c_context_minus_audit_trail_plus_x"])).not.toContain("arch=");
  });

  it("Given the staff Then Notes is opened at the flag table with the plant", () => {
    expect(notesLink(ctx())).toBe(`#/notes?from=plant&plant=${DEFAULT_PLANT_VALUE}&focus=flag-table`);
  });

  it("Given a leave at an instant Then Back is the plant link with that instant", () => {
    expect(backLink(DEFAULT_PLANT, "9.9.9", 305626)).toBe("#/plant?scenario=default&arch=a_manual,b_lims_lite,c_context&seed=1&t=305626&schema=1&engine=9.9.9");
  });
});

describe("what a screen opened from the plant reads from its query", () => {
  const query = (hash: string): string => hash.slice(hash.indexOf("?") + 1);

  it("Given the Lineage link Then the plant, its instant and the sample come back", () => {
    const got = drillFromQuery(query(lineageLink(ctx(small), "U03-D03-1")), KNOWN);
    expect(got?.link.spec).toEqual(small);
    expect([got?.link.t, got?.sample, got?.focus]).toEqual([305626, "U03-D03-1", null]);
  });

  it("Given the Notes link Then the focus is the flag table", () => {
    expect(drillFromQuery(query(notesLink(ctx())), KNOWN)?.focus).toBe("flag-table");
  });

  it("Given a query that is not from the plant, or has no plant Then none; given a plant that fell back Then the notes say so", () => {
    expect(drillFromQuery("scenario=default", KNOWN)).toBeNull();
    expect(drillFromQuery("from=plant", KNOWN)).toBeNull();
    expect(drillFromQuery("from=plant&plant=scenario%3Dnonesuch", KNOWN)?.link.notes).toEqual([{ field: "scenario", given: "nonesuch" }]);
  });

  it("Given the Setup link Then the Setup screen's own reading of it fills the form with the plant's scenario, settings, lists, capture path and hall, and the plant is there too", () => {
    const q = query(setupLink(ctx(small), ["c_context"]));
    const { form } = fromQuery(q, READY);
    expect([form.scenario, form.n, form.baySize, form.bays, form.capture, form.archs, form.ablation]).toEqual(["small", "6", "6", ["pilot"], "adapter_ingest", ["c_context"], ""]);
    expect(drillFromQuery(q, KNOWN)?.link.spec).toEqual(small);
    expect(plantFromQuery(new URLSearchParams(q).get("plant") ?? "", KNOWN).spec).toEqual(small);
  });
});
