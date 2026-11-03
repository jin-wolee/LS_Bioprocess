import type { PlantSpec } from "../protocol.ts";
import { hashOf } from "../ui/route.ts";
import { resultsKept } from "./action_list.ts";
import { askFromQuery, plantQuery } from "./link.ts";
import type { AskLink, Known } from "./link.ts";
import { isCase } from "./spec.ts";
import type { PlantAsk } from "./spec.ts";

// The drill-downs of the plant (docs/design/plant_ui.md section 7, "As built in P5c"): the links from a panel to the S3 screens, and what a screen opened from the plant reads back from its query. A link
// holds the plant it came from as one query value, `plant=<the plant link, percent-encoded>`, beside `from=plant`; the plant link holds the spec, the actions and the instant of the clock, never a result.
// Setup's own keys (the scenario, the settings, the lists, the capture path and the halls) come first, so that Setup fills its form with the code it already has. Pure functions, no DOM.
//
// P7c: in a break-out case a panel has the link to the Break-out screen on the case, and none to Lineage or Results, which take a Setup scenario that a case is not (plant_ui.md section 7, "As built in P7c").

/** What a link needs: the plant on screen, the engine version of the build, the instant of the clock and the record architectures the Setup screen offers (the presets and the ablations of C). */
export interface DrillContext<S extends PlantAsk = PlantSpec> {
  spec: S;
  engine: string;
  t: number;
  architectures: readonly string[];
}

const encode = (value: string): string => encodeURIComponent(value).replaceAll("%2C", ",");
const plantValue = (c: DrillContext<PlantAsk>): string => encodeURIComponent(plantQuery(c.spec, { engine: c.engine, t: c.t }));

/** Lineage, on one sample of the plant's run. */
export const lineageLink = (c: DrillContext, sample_id: string): string => hashOf("lineage", `from=plant&sample=${encode(sample_id)}&plant=${plantValue(c)}`);

/** Setup, filled with the plant's run over the given halls (only those the screen offers are put in the link); `focus` names the part of Results to scroll to once there is a result. */
export const setupLink = (c: DrillContext, halls: readonly string[], focus?: string): string => {
  const { run } = c.spec;
  const pairs: [string, string][] = [["scenario", run.scenario]];
  for (const name of Object.keys(run.settings).sort()) pairs.push([`set.${name}`, String(run.settings[name])]);
  if (run.bay_profiles) pairs.push(["bays", run.bay_profiles.join(",")]);
  if (run.analyzer_profiles) pairs.push(["analyzers", run.analyzer_profiles.join(",")]);
  const offered = halls.filter((h) => c.architectures.includes(h));
  if (offered.length > 0) pairs.push(["arch", offered.join(",")]);
  if (run.capture_path) pairs.push(["capture", run.capture_path]);
  // the plant's actions that name a unit or an analyzer go with it (P6b); a draw and the lab settings stay in the plant
  const carried = resultsKept(c.spec.actions);
  if (carried.length > 0) pairs.push(["actions", JSON.stringify(carried)]);
  pairs.push(["schema", "1"], ["engine", c.engine]);
  const query = pairs.map(([k, v]) => `${k}=${encode(v)}`).join("&");
  return hashOf("setup", `${query}&from=plant&plant=${plantValue(c)}${focus ? `&focus=${encode(focus)}` : ""}`);
};

/** Notes, at the flag table (what the qualification of a record is). */
export const notesLink = (c: DrillContext<PlantAsk>): string => hashOf("notes", `from=plant&plant=${plantValue(c)}&focus=flag-table`);

/** Back to the plant at an instant: the plant link with `t`. */
export const backLink = (spec: PlantAsk, engine: string, t: number | null): string => hashOf("plant", plantQuery(spec, { engine, t }));

/** The Break-out screen, on the case of the plant: the form is filled from the plant link, and the screen asks `breakout` once with the actions of the plant. */
export const breakoutLink = (c: DrillContext<PlantAsk>): string => hashOf("breakout", `from=plant&plant=${plantValue(c)}`);

/** The links a panel offers, made when the panel is drawn: the instant they carry is the clock reading of that moment. Lineage and Results are null in a case, the Break-out link null in any other run. */
export interface Drill {
  lineage: ((sample_id: string) => string) | null;
  results: ((halls: readonly string[], focus?: string) => string) | null;
  notes(): string;
  breakout: (() => string) | null;
}

export const drillOf = (base: Omit<DrillContext<PlantAsk>, "t">, now: () => number): Drill => {
  const notes = (): string => notesLink({ ...base, t: now() });
  if (isCase(base.spec)) return { lineage: null, results: null, notes, breakout: () => breakoutLink({ ...base, t: now() }) };
  const run = base as Omit<DrillContext, "t">;
  return {
    lineage: (sample_id) => lineageLink({ ...run, t: now() }, sample_id),
    results: (halls, focus) => setupLink({ ...run, t: now() }, halls, focus),
    notes,
    breakout: null,
  };
};

/** What a screen opened from the plant finds in its query: the plant (read like any plant link, with its notes), the sample of a Lineage link and the part of the page to scroll to. Null for a query that did not come from the plant. */
export const drillFromQuery = (query: string, known: Known): { link: AskLink; sample: string | null; focus: string | null } | null => {
  const q = new URLSearchParams(query);
  const plant = q.get("plant");
  if (q.get("from") !== "plant" || plant === null) return null;
  return { link: askFromQuery(plant, known), sample: q.get("sample"), focus: q.get("focus") };
};
