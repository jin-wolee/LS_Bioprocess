import { runProcess } from "../process.ts";
import type { ProcessConfig, ProcessRun } from "../process.ts";
import { createRng } from "../rng.ts";
import { runSampling } from "../sampling.ts";
import type { ScenarioConfig } from "../scenario.ts";
import type { BreakoutConfig } from "./config.ts";
import { planBreakout } from "./plan.ts";
import type { BreakoutPlan } from "./plan.ts";

// What the run needs of a break-out block before the process runs: the plan, the process settings with the stops and the seed lots added, and a check afterwards that the units ended
// where the script said.

/**
 * The plan of the run. Every origin but a named sampling draw is planned from the settings alone. A sampling origin starts at the instant of a draw, which only a run knows: the plan
 * takes it from the same scenario run without the event, on a stream factory of its own so that the keys of the real run are asked for once. The draws of a sample are keyed by its id, so
 * the named draw falls at the same instant in the real run (it is before the stop it causes).
 */
export const scriptOf = (cfg: ScenarioConfig, b: BreakoutConfig): BreakoutPlan => {
  if (b.origin.kind !== "sampling") return planBreakout(b, cfg.scenario_id, cfg.process) as BreakoutPlan;
  const probe = createRng();
  const draws = runSampling(cfg.sampling, runProcess(cfg.process, cfg.seed, probe), cfg.seed, probe).samples;
  return planBreakout(b, cfg.scenario_id, cfg.process, (id) => draws.find((s) => s.sample_id === id && s.state === "drawn")?.drawn_s) as BreakoutPlan;
};

/** The process settings of the run: the scenario's, plus one stop per affected unit and the seed lot of each unit the topology names. */
export const withScript = (c: ProcessConfig, plan: BreakoutPlan): ProcessConfig => ({
  ...c,
  scripted: [...c.scripted, ...plan.units.map((u) => ({ type: "stop" as const, unit_id: u.unit_id, at_s: u.stop_s }))],
  ...(Object.keys(plan.seedLots).length > 0 && { seedLots: plan.seedLots }),
});

/** An affected unit that ended before its stop (the harvest rule took it first) would leave a script that did not happen: the run says so instead of logging it. */
export const checkStops = (scenario: string, plan: BreakoutPlan, proc: ProcessRun): void => {
  for (const u of plan.units) {
    const end = proc.byUnit.get(u.unit_id)?.harvested_s;
    if (end !== u.stop_s) throw new Error(`scenario ${scenario}: ${u.unit_id} ended at ${String(end)} s, not at its scripted stop ${u.stop_s} s (the harvest rule ended it first)`);
  }
};
