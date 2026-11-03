import type { ScenarioRun } from "../../../run.ts";
import type { Challenges } from "./challenges.ts";
import { unitIdOf } from "../../../process.ts";
import type { BreakoutResult } from "./breakout.ts";
import { lineageView } from "./lineage.ts";
import type { LineageColumn, LineageView } from "./lineage.ts";
import { sampleTruth } from "./pick.ts";
import type { PlantKept } from "./plant.ts";

// The `plant_truth` request (docs/design/plant_ui.md sections 3.3 and 6, rule 8): what the simulation knows and no record can hold, on the reader's switch. It reads what the Worker kept for the
// epoch and recomputes nothing. For a sample it is the lineage view's own truth column and verdicts (`lineageView` over the kept datasets, with the errors the injector materialised on each
// record), so it equals the lineage screen's view of the run the plant shows; for the halls it is the placeholders, the planned samples a hall holds no card for. It is the only answer that
// carries a verdict, a materialised error or an absence; the plan and the halls never do (rule 2). P7b: for a break-out case the pick `{ breakout: true }` answers the event as the Break-out screen
// prints it and the units it reached (rule 8 as built in P7b).

export type TruthPick = { sample_id: string } | { halls: true } | { breakout: true };

export interface Placeholder {
  /** The index into the plan's `samples`. */
  sample: number;
  /** `skipped`: the draw was refused by the volume budget, so no sample exists for any record to hold. `not_recorded`: the sample was drawn and this record holds no run and no result row of it. */
  why: "skipped" | "not_recorded";
}

export type TruthOverlay =
  | {
      kind: "sample";
      sample: LineageView["sample"];
      truth: LineageView["truth"];
      /** One column for each hall built when the request arrived, in the order of the spec: the answers and the errors of the lineage column, without the rows of the record (`plant_record` has them). */
      columns: Pick<LineageColumn, "architecture" | "answers" | "realised_errors">[];
    }
  | { kind: "halls"; halls: { architecture: string; placeholders: Placeholder[] }[] }
  | {
      kind: "breakout";
      /** The event as the Break-out screen prints it after a run: type, profile, origin kind and id, horizon, and the instant the origin became contaminated. */
      event: BreakoutResult["event"];
      /** The units the event reached, by unit: an index into the plan's `units` and the instant that unit became contaminated. */
      affected: { unit: number; onset_s: number }[];
    };

const NOT_OFFERED = "not offered yet";

/** A `plant_truth` pick as a link or a page may send it: a sample id, the halls or the break-out. The pick of a unit waits (plant_ui.md section 12, item 12) and is refused like a malformed one. */
export const checkTruthPick = (raw: unknown): { ok: true; pick: TruthPick } | { ok: false; message: string } => {
  const bad = (message: string): { ok: false; message: string } => ({ ok: false, message });
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return bad("a plant_truth request needs a pick: {\"sample_id\": \"<id>\"}, {\"halls\": true} or {\"breakout\": true}");
  const pick = raw as Record<string, unknown>;
  const keys = Object.keys(pick);
  if (keys.length === 1 && keys[0] === "unit_id") return bad(`the pick of a unit is ${NOT_OFFERED}: no lab function gives the truth of a unit`);
  if (keys.length === 1 && keys[0] === "breakout" && pick.breakout === true) return { ok: true, pick: { breakout: true } };
  if (keys.length === 1 && keys[0] === "sample_id" && typeof pick.sample_id === "string") return { ok: true, pick: { sample_id: pick.sample_id } };
  if (keys.length === 1 && keys[0] === "halls" && pick.halls === true) return { ok: true, pick: { halls: true } };
  return bad("the pick must be {\"sample_id\": \"<id>\"}, {\"halls\": true} or {\"breakout\": true}");
};

export type PlantTruthResult =
  | { ok: true; view: TruthOverlay }
  | { ok: false; code: "locked"; message: string }
  | { ok: false; code: "refused"; reason: "unknown_target"; message: string };

/** The draws of the run by the truth log: the samples drawn, and the draws the volume budget refused. */
const drawsOf = (kept: PlantKept): { drawn: Set<string>; skipped: Set<string> } => {
  const drawn = new Set<string>();
  const skipped = new Set<string>();
  for (const e of kept.events) {
    if (e.type === "sample_drawn") drawn.add(e.sample_id);
    else if (e.type === "draw_skipped_volume_budget") skipped.add(e.sample_id);
  }
  return { drawn, skipped };
};

/** Each hall built so far: a placeholder for every skipped draw and every drawn sample the hall holds no card for, in the order of the plan's samples. */
const hallsOf = (kept: PlantKept): Extract<TruthOverlay, { kind: "halls" }> => {
  const { drawn, skipped } = drawsOf(kept);
  return {
    kind: "halls",
    halls: [...kept.halls].map(([architecture, hall]) => ({
      architecture,
      placeholders: kept.samples.flatMap((id, sample): Placeholder[] =>
        hall.cards.has(id) ? [] : skipped.has(id) ? [{ sample, why: "skipped" }] : drawn.has(id) ? [{ sample, why: "not_recorded" }] : []),
    })),
  };
};

/** The break-out case's truth: the event as the screen prints it, and the units its `contamination_onset` events name (the truth log is the Worker's own; the plan never carries these). Null for any other run. */
const breakoutOf = (kept: PlantKept): Extract<TruthOverlay, { kind: "breakout" }> | null => {
  if (kept.breakout === undefined) return null;
  const unit = (id: string): number => Number(id.slice(1)) - 1;
  const affected = kept.events.flatMap((e) => (e.type === "contamination_onset" && unitIdOf(unit(e.unit_id)) === e.unit_id ? [{ unit: unit(e.unit_id), onset_s: e.t }] : []));
  return { kind: "breakout", event: kept.breakout.event, affected: affected.sort((a, b) => a.unit - b.unit || a.onset_s - b.onset_s) };
};

/**
 * The truth about one sample, as the lineage view gives it, over the halls built so far. `sampleTruth` reads the events of the truth log only, so the kept log stands in for the run (the run
 * itself, with its sensor series, is not kept).
 */
const sampleOf = (kept: PlantKept, sample_id: string): Extract<TruthOverlay, { kind: "sample" }> | null => {
  const truth = sampleTruth({ events: kept.events } as unknown as ScenarioRun, sample_id);
  if (truth === null) return null;
  const halls = [...kept.halls.values()];
  const view = lineageView(truth, "reader", halls.map((h) => h.dataset), Object.fromEntries([...kept.halls].map(([id, h]) => [id, h.materialised])));
  return { kind: "sample", sample: view.sample, truth: view.truth, columns: view.columns.map(({ architecture, answers, realised_errors }) => ({ architecture, answers, realised_errors })) };
};

/**
 * The answer to a checked pick, for the run the Worker holds. A challenge open on the run answers `locked` at this moment, so a challenge opened after the plan was posted locks the overlay of
 * that plan (rule 2); a sample the run did not draw is refused as `unknown_target`.
 */
export const answerPlantTruth = (kept: PlantKept, challenges: Challenges, pick: TruthPick): PlantTruthResult => {
  // a break-out case has no run spec: no challenge can be opened on it
  if (kept.run !== null && challenges.locked(kept.run, kept.seed)) {
    return { ok: false, code: "locked", message: "this run is a challenge that has not been revealed; the simulation's view of it opens after the guess or the give-up" };
  }
  if ("breakout" in pick) {
    const view = breakoutOf(kept);
    return view === null ? { ok: false, code: "refused", reason: "unknown_target", message: "this plant run is not a break-out case, so the simulation has no break-out event to show" } : { ok: true, view };
  }
  if ("halls" in pick) return { ok: true, view: hallsOf(kept) };
  const view = sampleOf(kept, pick.sample_id);
  if (view === null) return { ok: false, code: "refused", reason: "unknown_target", message: `the run drew no sample ${JSON.stringify(pick.sample_id)}` };
  return { ok: true, view };
};
