import { evaluationSettings } from "../../src/evaluate/config.ts";
import { loadProfile } from "../../src/profiles.ts";
import type { ProfileLookup } from "../../src/profiles.ts";
import { loadScenario } from "../../src/scenario.ts";
import { breakoutCase, investigateBreakoutSeed } from "../../src/experiments/assembly/breakout.ts";
import type { BreakoutSeedRun } from "../../src/experiments/assembly/breakout.ts";
import { architecturesNamed } from "../../src/experiments/assembly/lab/seed_setup.ts";
import type { LabData } from "../../src/experiments/assembly/lab/setup.ts";
import { canonicalJson, sha256Hex } from "../../src/trace.ts";

// The Break-out screen's own run of one case at one seed under chosen architectures, with no operator action and no plant module (docs/design/plant_ui.md section 6, rule 11): the scenario file of
// the case loaded as the screen loads it, the staff profile and the evaluation settings of the lab, the review at its default, and `investigateBreakoutSeed`, which the screen and the experiment SC12 run. Its
// answer is the reference that a case run by the plant is compared with: the strict hash of the truth log and the digest (SHA-256 of the canonical JSON) of each architecture's cell. The reference CLI
// of the plant and the tests read it from here.

interface CaseDoc {
  scenario_id: string;
  profiles: { staff: string };
}

export interface ScreenRun {
  /** The strict hash of the truth log of the seed (`truth_log_hash` of the Break-out screen's result). */
  truth: string;
  /** The digest of the `BreakoutMetrics` cell of each architecture, by architecture id. */
  cells: Record<string, string>;
  /** The run itself: the outcome, the events and the investigations, in the order of the architectures. */
  run: BreakoutSeedRun;
}

export const screenRun = async (data: LabData, caseId: string, seed: number, architectures: readonly string[]): Promise<ScreenRun> => {
  const offer = data.breakout;
  if (offer === undefined) throw new Error("the data has no break-out files");
  const doc = offer.scenarios[caseId] as CaseDoc;
  const lookup: ProfileLookup = (kind, id) =>
    kind === "breakout" ? (offer.profiles.find((p) => (p as { profile_id?: string }).profile_id === id) as unknown) : data.lookup(kind, id);
  const c = breakoutCase({ case_id: caseId, scenario: doc.scenario_id, set: {} }, loadScenario(structuredClone(doc), lookup));
  const staff = loadProfile(lookup("staff", doc.profiles.staff), "staff").params;
  const run = await investigateBreakoutSeed(
    c, seed, { staff, evaluation: evaluationSettings(data.evaluation), architectures: architecturesNamed(data, architectures) }, { timing: "next_shift_start", reject_also: [] },
  );
  const cells = Object.fromEntries(await Promise.all(run.outcome.cells.map(async (cell) => [cell.architecture, await sha256Hex(canonicalJson(cell))] as const)));
  return { truth: run.outcome.truth_log_hash, cells, run };
};
