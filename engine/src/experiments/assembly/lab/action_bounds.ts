import { inoculationInstant, unitIdOf } from "../../../process.ts";
import { FLAG_NAMES } from "../../../record/architecture.ts";
import { createRng } from "../../../rng.ts";
import { moveFault, plannedInstant } from "../../../sampling.ts";
import type { ScenarioConfig } from "../../../scenario.ts";
import { canonicalActions, targetOf } from "./actions.ts";
import type { Action, PlantRefusal, RefusalReason } from "./actions.ts";

// The refusals of plant_ui.md section 5.6 that need the shape of the run: the units and their culture, the samples and their planned instants, the analyzers and their windows, the record halls.
// The Worker runs this before the engine, so a rule that is the plant's own arrives with its code and its place in the list; anything else the engine rejects arrives as the engine's message.
// The actions are looked at in the canonical order, so the same list is refused at the same action whatever the order of entry; `index` is the place in the list as entered.

const DAY = 86400;

/** The unit's place in the fleet, or undefined when the run has no such unit (the id must be the canonical `U01`). */
const unitIndex = (cfg: ScenarioConfig, id: string): number | undefined => {
  const m = /^U(\d+)$/.exec(id);
  const i = m ? Number(m[1]) - 1 : -1;
  return i >= 0 && i < cfg.process.reactors && unitIdOf(i) === id && inoculationInstant(cfg.process, i) < cfg.process.horizon_s ? i : undefined;
};

/** In culture from the inoculation to the harvest: the scheduled end, or the horizon when it comes first (the engine takes a scripted event strictly between the two). */
const cultureOf = (cfg: ScenarioConfig, i: number): { inoc: number; end: number } => {
  const inoc = inoculationInstant(cfg.process, i);
  return { inoc, end: Math.min(inoc + cfg.process.production_s, cfg.process.horizon_s) };
};

export const checkBounds = (cfg: ScenarioConfig, seed: number, halls: readonly string[], actions: readonly Action[]): PlantRefusal | null => {
  const horizon = cfg.process.horizon_s;
  const windows = cfg.analysis.maintenance.map((m) => ({ analyzer: m.analyzer, start: m.start_s, end: m.end_s }));
  const analyzers = cfg.analysis.instruments.map((x) => x.id);
  const moved = new Set<string>();
  const rng = createRng();

  for (const { name, action: a } of canonicalActions(actions)) {
    const index = actions.indexOf(a);
    const refuse = (reason: RefusalReason, why: string): PlantRefusal => ({ ok: false, code: "refused", reason, index, message: `actions[${index}] (${name}, ${a.kind} ${targetOf(a)}): ${why}` });
    if (a.at >= horizon) return refuse("outside_window", `the action at ${a.at} s is not before the end of the run at ${horizon} s`);

    if (a.kind === "add_feed" || a.kind === "raise_alarm") {
      const i = unitIndex(cfg, a.unit_id);
      if (i === undefined) return refuse("unknown_target", `the run has no unit ${a.unit_id}`);
      const { inoc, end } = cultureOf(cfg, i);
      if (a.at <= inoc || a.at >= end) return refuse("outside_window", `${a.unit_id} is in culture after ${inoc} s and before ${end} s (inoculation to harvest); the action is at ${a.at} s`);
    } else if (a.kind === "move_draw") {
      const m = /^(U\d+)-D(\d{2,})-([12])$/.exec(a.sample_id);
      const i = m ? unitIndex(cfg, m[1] as string) : undefined;
      const day = Number(m?.[2]);
      const n = Number(m?.[3]) as 1 | 2;
      const { inoc, end } = i === undefined ? { inoc: 0, end: 0 } : cultureOf(cfg, i);
      const planned = i === undefined || a.sample_id !== `${m?.[1]}-D${String(day).padStart(2, "0")}-${n}` || day <= Math.floor(inoc / DAY) || day * DAY >= end
        ? null
        : plannedInstant(cfg.sampling, rng, seed, { sample_id: a.sample_id, bay: Math.floor((i as number) / cfg.process.baySize) + 1, slot: (i as number) % cfg.process.baySize, day, n });
      if (planned === null) return refuse("unknown_target", `the run does not plan the sample ${a.sample_id}`);
      if (moved.has(a.sample_id)) return refuse("limit", `the sample ${a.sample_id} is already moved by another action; undo that one first`);
      const fault = moveFault(cfg.sampling, day, planned, { sample_id: a.sample_id, at_s: a.at, to_s: a.to });
      if (fault) return refuse(fault.kind, fault.message);
      moved.add(a.sample_id);
    } else if (a.kind === "analyzer_down") {
      if (!analyzers.includes(a.analyzer)) return refuse("unknown_target", `the run has no analyzer ${a.analyzer}`);
      if (a.from < a.at) return refuse("past", `the window starts at ${a.from} s, before the action at ${a.at} s`);
      if (a.from >= horizon) return refuse("outside_window", `the window starts at ${a.from} s, not before the end of the run at ${horizon} s`);
      const window = { analyzer: a.analyzer, start: a.from, end: a.from + a.length_min * 60 };
      const clash = windows.find((w) => w.analyzer === a.analyzer && w.start < window.end && window.start < w.end);
      if (clash) return refuse("limit", `${a.analyzer} already has a window from ${clash.start} s to ${clash.end} s that overlaps ${window.start} s to ${window.end} s; one window per analyzer at a time`);
      windows.push(window);
    } else if (a.kind === "change_lot") {
      if (!analyzers.includes(a.analyzer)) return refuse("unknown_target", `the run has no analyzer ${a.analyzer}`);
      if (a.effective < a.at) return refuse("past", `the lot change takes effect at ${a.effective} s, before the action at ${a.at} s`);
      if (a.effective >= horizon) return refuse("outside_window", `the lot change takes effect at ${a.effective} s, not before the end of the run at ${horizon} s`);
    } else if (a.kind === "set_flag") {
      if (!halls.includes(a.architecture)) return refuse("unknown_target", `${a.architecture} is not one of the record halls of this run (${halls.join(", ")})`);
      if (!(FLAG_NAMES as readonly string[]).includes(a.flag)) return refuse("unknown_target", `${a.flag} is not one of the ${FLAG_NAMES.length} flags (${FLAG_NAMES.join(", ")})`);
    }
  }
  return null;
};
