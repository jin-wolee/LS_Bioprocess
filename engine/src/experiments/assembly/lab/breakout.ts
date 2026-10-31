import { breakoutMetrics } from "../../../evaluate/breakout_metrics.ts";
import type { BreakoutMetrics } from "../../../evaluate/breakout_metrics.ts";
import { evaluationSettings } from "../../../evaluate/config.ts";
import type { BreakoutReport } from "../../../generated/breakout_report.schema";
import { loadProfile } from "../../../profiles.ts";
import type { ProfileLookup } from "../../../profiles.ts";
import { investigate, signalsOf } from "../../../record/investigate/investigate.ts";
import type { Investigation, InvestigationConfig, Reach } from "../../../record/investigate/investigate.ts";
import { runScenario } from "../../../run.ts";
import { loadScenario } from "../../../scenario.ts";
import { ENGINE_VERSION, logHash } from "../../../trace.ts";
import { blockOf, breakoutCase } from "../breakout.ts";
import { parseBreakoutConfig } from "../breakout_config.ts";
import { MYCOPLASMA_NOTE, buildBreakoutReport } from "../breakout_report.ts";
import { rosterOf, seedInputFromRun } from "../from_run.ts";
import type { ReviewUsed } from "../open_loop.ts";
import { runSeed } from "../run_seed.ts";
import { checkSeed } from "./challenges.ts";
import type { Refusal } from "./challenges.ts";
import { architecturesNamed } from "./seed_setup.ts";
import type { LabData } from "./setup.ts";
import { ablationBaseId, architectureIds } from "./spec.ts";

// 2026-10-31 S3g (docs/design/lab_ui.md sections 3, 4 and 12): the `breakout` request. One SC12 case (one of the five bundled scenarios), one seed, the chosen architectures. The truth is run once
// and recorded under every architecture, each record is investigated from the first signal (rule S9) and scored (rule S10), exactly as the experiment SC12 does it for one seed
// (assembly/breakout.ts `runBreakoutSeed`; the investigations are kept here because the screen shows the walk-back and the holds and `runBreakoutSeed` returns only the cells). The numbers
// and their words are the report's: the result is built from `buildBreakoutReport` over this one seed, so the screen cannot differ from the report in a status, a denominator or a reason.
// Plain data only: the truth log, the answer key and the hidden script stay here (spec section 3, rule 2). What leaves is what the report prints of a case as a simulation result.

const DAY = 86400;

/** The flags that decide what direction 3 can read (rule S8): lots and the seed parent need the first, equipment the second. The page names them from here and types no flag. */
export const BREAKOUT_NEEDS = { lots: "material_lot_links", equipment: "equipment_links" } as const;

export interface BreakoutCaseInfo {
  /** The scenario id, which is the id of the case. */
  id: string;
  event_type: string;
  origin_kind: string;
}

export interface BreakoutOffer {
  cases: BreakoutCaseInfo[];
  /** The seed list of the SC12 config (A103, neutral integers). */
  seed_list: number[];
  needs: { lots: string; equipment: string };
}

type Case = BreakoutReport["cases"][number];
type Row = Case["architectures"][number]["rows"][number];

export interface RowView {
  /** The path of the metric in the report: `containment.batch.contained`, `identification.direction_3.recall`, `retro_flag_completeness`, ... */
  metric: string;
  status: Row["status"];
  /** The value of this seed (a share, or seconds for a time); null when undefined or not reachable. */
  value: number | null;
  /** The count behind a share and its denominator; null for a time and for a row that is not reachable (the walk-back could not look). */
  num: number | null;
  den: number | null;
  /** The denominator in words (an engine string); null for a row that has none. */
  denominator: string | null;
  /** Why the row is not a plain value (an engine string): not reachable from this record, a zero denominator, what a time is over; null otherwise. */
  reason: string | null;
}

export interface WalkItemView {
  kind: string;
  id: string;
  path: string;
}

export interface InvestigationEventView {
  type: "hold_placed" | "hold_quarantined" | "hold_released" | "hold_rejected" | "result_reflagged" | "deviation_closed";
  t: number;
  hold_id?: string;
  /** The item a hold is on. */
  target_kind?: string;
  target_id?: string;
  /** The result a retro-flag created a version of. */
  result_id?: string;
  deviation_id?: string;
}

export type ObservedView =
  | { type: "signal_observed"; t: number; unit_id: string; signal: string; limit: string }
  | { type: "deviation_opened"; t: number; deviation_id: string; unit_id: string }
  | { type: "unit_stopped"; t: number; unit_id: string }
  | { type: "confirm_sample_drawn"; t: number; sample_id: string; unit_id: string; tests: string[] }
  | { type: "confirm_result"; t: number; sample_id: string; test: string; outcome: "detected" | "not_detected" };

export interface BreakoutArchitectureView {
  architecture: string;
  reach: Reach;
  /** The walk-back of the first signal, the one the identification metrics score (rule S10). */
  walk: {
    estimated_onset: number;
    decision_at: number;
    direction_1: WalkItemView[];
    /** Null when the record cannot read direction 3 (neither link flag): not reachable from this record, which is not an empty set. An empty list is a walk-back that looked and returned nothing. */
    direction_3: WalkItemView[] | null;
  };
  /** What the investigation did, in time order: the holds, their end, the retro-flags and the close of the deviation. */
  events: InvestigationEventView[];
  rows: RowView[];
  /** VR-022 when the architecture lacks a flag it needs (rule S11): a released result under a hold stays released. */
  not_evaluable: { rule: string; reason: string }[];
}

export interface BreakoutResult {
  kind: "simulation_result";
  case: string;
  scenario: string;
  seed: number;
  engine_version: string;
  architectures: string[];
  truth_log_hash: string;
  /** The scripted event as the report prints it: type, origin, horizon (A189) and the instant the origin became contaminated (A157). */
  event: Case["event"];
  /** Every input the ledger gives no number for, with its id and where it comes from (A176, the inputs of the event type, the assumed lag, ...). */
  inputs: Case["inputs"];
  topology: Case["topology"];
  /** What the plant showed, the same for every architecture (observable events), in time order. */
  observed: ObservedView[];
  needs: { lots: string; equipment: string };
  /** The sentence of the author's ruling on C29 for the mycoplasma type (spec 11.8.12 C40); null for the other types. */
  c29: string | null;
  per_architecture: BreakoutArchitectureView[];
}

export type BreakoutAnswer = { ok: true; result: BreakoutResult } | Refusal;

const invalid = (message: string): Refusal => ({ ok: false, code: "invalid_spec", message });

interface ScenarioDoc {
  scenario_id: string;
  profiles: { staff: string };
  breakout: { profile: string; origin: { kind: string } };
}

/** What the build offers on the Break-out screen, or null when it bundles no break-out data. */
export const breakoutOffer = (data: LabData): BreakoutOffer | null => {
  const b = data.breakout;
  if (b === undefined) return null;
  const profile = (id: string) => b.profiles.find((p) => (p as { profile_id?: string }).profile_id === id) as { contamination_type: string };
  return {
    cases: Object.entries(b.scenarios).map(([id, doc]) => {
      const { breakout } = doc as ScenarioDoc;
      return { id, event_type: profile(breakout.profile).contamination_type, origin_kind: breakout.origin.kind };
    }),
    seed_list: parseBreakoutConfig(b.experiment, evaluationSettings(data.evaluation).min_seeds).seeds,
    needs: { ...BREAKOUT_NEEDS },
  };
};

type Share = { num: number; den: number };
const isShare = (v: unknown): v is Share => typeof v === "object" && v !== null && "num" in v && "den" in v && "value" in v;
const sharesOf = (node: unknown, path = ""): [string, Share][] =>
  isShare(node) ? [[path, node]] : node && typeof node === "object" && !Array.isArray(node) ? Object.entries(node).flatMap(([k, v]) => sharesOf(v, path === "" ? k : `${path}.${k}`)) : [];

/** The rows of one architecture: the report's status, denominator and reason, with the count behind each share taken from the cell of the seed. */
const rowsOf = (rows: readonly Row[], cell: BreakoutMetrics): RowView[] => {
  const shares = new Map(sharesOf({ containment: cell.containment, identification: cell.identification, released_before_containment: cell.released_before_containment, retro_flag_completeness: cell.retro_flag_completeness }));
  return rows.map((r) => {
    const share = r.status === "not_reachable" ? undefined : shares.get(r.metric);
    return { metric: r.metric, status: r.status, value: r.median, num: share?.num ?? null, den: share?.den ?? null, denominator: r.denominator, reason: r.reason };
  });
};

const observedOf = (events: readonly { type: string }[]): ObservedView[] =>
  (events as Parameters<typeof signalsOf>[0]).flatMap((e): ObservedView[] => {
    switch (e.type) {
      case "signal_observed": return [{ type: e.type, t: e.t, unit_id: e.unit_id, signal: e.signal, limit: e.limit }];
      case "deviation_opened": return [{ type: e.type, t: e.t, deviation_id: e.deviation_id, unit_id: e.unit_id }];
      case "confirm_sample_drawn": return [{ type: e.type, t: e.t, sample_id: e.sample_id, unit_id: e.unit_id, tests: e.tests.map((x) => x.test) }];
      case "confirm_result": return [{ type: e.type, t: e.t, sample_id: e.sample_id, test: e.test, outcome: e.outcome }];
      case "process_event": return e.kind === "unit_stopped" ? [{ type: "unit_stopped", t: e.t, unit_id: e.unit_id }] : [];
      default: return [];
    }
  });

const eventsOf = (inv: Investigation): InvestigationEventView[] => {
  const holds = new Map((inv.dataset.quality_hold ?? []).map((h) => [h.hold_id, h]));
  return inv.events.map((e): InvestigationEventView => {
    if (e.type === "result_reflagged") return { type: e.type, t: e.t, result_id: e.result_id, hold_id: e.hold_id };
    if (e.type === "deviation_closed") return { type: e.type, t: e.t, deviation_id: e.deviation_id };
    const h = holds.get(e.hold_id);
    return { type: e.type, t: e.t, hold_id: e.hold_id, ...(h && { target_kind: h.target_kind, target_id: h.target_id }) };
  });
};

const viewOf = (inv: Investigation, cell: BreakoutMetrics, rows: readonly Row[]): BreakoutArchitectureView => {
  const walk = inv.walks[0];
  if (walk === undefined) throw new Error("break-out: the investigation made no walk-back (no signal)");
  const items = (direction: 1 | 3): WalkItemView[] => walk.items.filter((i) => i.direction === direction).map(({ kind, id, path }) => ({ kind, id, path }));
  return {
    architecture: cell.architecture,
    reach: { ...walk.reachable },
    walk: { estimated_onset: walk.estimated_onset, decision_at: walk.decision_at, direction_1: items(1), direction_3: walk.reachable.direction3 ? items(3) : null },
    events: eventsOf(inv),
    rows: rowsOf(rows, cell),
    not_evaluable: inv.not_evaluable.map((x) => ({ ...x })),
  };
};

/**
 * The `breakout` request as the Worker receives it. The case, the architectures and the seed are user input and are checked (a link carries them); a scenario that fails the engine's own validation
 * throws with the engine's message, and the Worker reports it as `engine_error`.
 */
export const answerBreakout = async (data: LabData, raw: { case: unknown; architectures: unknown; seed: unknown }): Promise<BreakoutAnswer> => {
  const offer = data.breakout;
  if (offer === undefined) return invalid("this build does not offer the Break-out screen");
  const ids = Object.keys(offer.scenarios);
  if (typeof raw.case !== "string" || !Object.hasOwn(offer.scenarios, raw.case)) return invalid(`unknown case ${JSON.stringify(raw.case)} (offered: ${ids.join(", ")})`);
  if (!Array.isArray(raw.architectures) || raw.architectures.length === 0) return invalid("architectures must be a list that names at least one architecture");
  const offered = architectureIds(data);
  for (const [i, id] of raw.architectures.entries()) {
    if (typeof id !== "string" || !offered.includes(id)) return invalid(`unknown architecture ${JSON.stringify(id)} (offered: ${offered.join(", ")})`);
    if (raw.architectures.indexOf(id) !== i) return invalid(`architecture "${id}" is repeated`);
  }
  const seed = checkSeed(raw.seed);
  if (!seed.ok) return invalid(seed.message);

  const doc = offer.scenarios[raw.case] as ScenarioDoc;
  const lookup: ProfileLookup = (kind, id) =>
    kind === "breakout" ? (offer.profiles.find((p) => (p as { profile_id?: string }).profile_id === id) ?? ((): never => { throw new Error(`no bundled breakout profile ${id}`); })()) : data.lookup(kind, id);
  const c = breakoutCase({ case_id: raw.case, scenario: doc.scenario_id, set: {} }, loadScenario(structuredClone(doc), lookup));
  const b = blockOf(c);
  const evaluation = evaluationSettings(data.evaluation);
  const architectures = architecturesNamed(data, raw.architectures as string[]);
  const review: ReviewUsed = { timing: "next_shift_start", reject_also: [] };

  const run = runScenario({ ...c.scenario, seed: seed.seed });
  const truth_log_hash = await logHash(run.events);
  const input = seedInputFromRun(run, {
    scenario_id: c.scenario.scenario_id, staff: loadProfile(lookup("staff", doc.profiles.staff), "staff").params, evaluation, architectures, days: c.scenario.process.horizon_s / DAY,
    review: { roster: rosterOf(c.scenario.sampling), timing: review.timing, reject_also: review.reject_also }, breakout: b,
  });
  const out = runSeed(input);
  const cfg: InvestigationConfig = { decision_delay_s: b.signal_to_response_s, conclusion_delay_s: b.positive_to_hold_s, assumed_lag_s: c.assumed_lag.seconds, review: input.review };
  const signals = signalsOf(input.events);
  const investigations = architectures.map((a) => investigate(out.datasets[a.id] as NonNullable<(typeof out.datasets)[string]>, signals, cfg));
  const cells = architectures.map((a, i) => breakoutMetrics({ truth: input.truth, investigation: investigations[i] as Investigation, key_text: out.key_text, architecture: a.id }));
  const after = await logHash(run.events);
  if (after !== truth_log_hash) throw new Error(`break-out: the truth log of seed ${seed.seed} changed while the architectures were recorded and investigated (${truth_log_hash} before, ${after} after)`);

  const report = buildBreakoutReport(
    { engine_version: ENGINE_VERSION, seeds: [seed.seed], review, cases: [{ case: c, outcomes: [{ seed: seed.seed, truth_log_hash, cells }] }] },
    { experiment_id: "lab", min_seeds: evaluation.min_seeds, ablations_of: ablationBaseId(data) },
  );
  const reported = report.cases[0] as Case;
  return {
    ok: true,
    result: {
      kind: "simulation_result", case: raw.case, scenario: doc.scenario_id, seed: seed.seed, engine_version: ENGINE_VERSION, architectures: architectures.map((a) => a.id), truth_log_hash,
      event: reported.event, inputs: reported.inputs, topology: reported.topology, observed: observedOf(input.events), needs: { ...BREAKOUT_NEEDS },
      c29: reported.event.type === "mycoplasma" ? MYCOPLASMA_NOTE : null,
      per_architecture: architectures.map((a, i) => viewOf(investigations[i] as Investigation, cells[i] as BreakoutMetrics, reported.architectures.find((x) => x.id === a.id)?.rows ?? [])),
    },
  };
};
