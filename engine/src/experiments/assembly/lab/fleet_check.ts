import { fleetProblems } from "../../../fleet.ts";
import type { FleetProblem } from "../../../fleet.ts";
import { profileInfos } from "./catalogue.ts";
import { scenarioDoc } from "./setup.ts";
import type { LabData } from "./setup.ts";

// `fleet_check` (docs/design/lab_ui.md section 4, rule 6; U2): the Setup page asks whether an analyzer list would load, so that it can say so before a run, and the answer is the engine's own check of
// the two lists, `fleetProblems` of engine/src/fleet.ts, which the loader of a scenario throws from too. The page imports no engine module, so this is where the check reaches it. Nothing runs here:
// the entries are the stages of the bundled analyzer profiles (the catalogue of `ready`) and the menu is the analyzer profile the bundled scenario names. A request is user input like a spec is, so the
// scenario and the ids are checked first and refused with a message, as `checkRunSpec` refuses.

export type FleetCheck = { ok: true; problems: FleetProblem[] } | { ok: false; message: string };

const refuse = (message: string): FleetCheck => ({ ok: false, message });

export const checkFleet = (data: LabData, scenario: unknown, analyzers: unknown): FleetCheck => {
  const bundled = Object.keys(data.scenarios);
  if (typeof scenario !== "string" || !Object.hasOwn(data.scenarios, scenario)) return refuse(`unknown scenario ${JSON.stringify(scenario)} (bundled: ${bundled.join(", ")})`);
  if (!Array.isArray(analyzers)) return refuse("analyzers must be a list");
  if (analyzers.length === 0) return refuse("analyzers must name at least one profile");
  const catalogue = profileInfos(data).filter((p) => p.kind === "analyzer");
  const entries = new Map(catalogue.map((p) => [p.id, { id: p.id, stages: p.stages ?? [] }]));
  const listed = [];
  for (const [i, id] of analyzers.entries()) {
    const entry = typeof id === "string" ? entries.get(id) : undefined;
    if (entry === undefined) return refuse(`analyzers[${i}] names ${JSON.stringify(id)}, which is not a bundled analyzer profile (bundled: ${[...entries.keys()].join(", ")})`);
    listed.push(entry);
  }
  const menu = entries.get(scenarioDoc(data, scenario).profiles.analyzer ?? "");
  if (menu === undefined) return refuse(`scenario ${scenario} names an analyzer profile that is not bundled`);
  return { ok: true, problems: fleetProblems(listed, menu) };
};
