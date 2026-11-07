import type { Event } from "../../../generated/event.schema";
import { checkSeeds } from "../config.ts";
import { evaluationRefs } from "./catalogue.ts";
import type { RefValue } from "./catalogue.ts";
import { decisionScenarioId, hasDecision, openDecisionSample, revealDecision, startDecisionChallenge, withDecisionScenario } from "./challenge_decision.ts";
import type { DecisionChallenge } from "./challenge_decision.ts";
import { hasSample, openSample, revealSample, startSampleChallenge } from "./challenge_sample.ts";
import type { SampleChallenge } from "./challenge_sample.ts";
import type { DecisionRecordView, RecordView, Reveal } from "./challenge_types.ts";
import type { SampleRecord } from "./lineage.ts";
import { inputsOf } from "./run.ts";
import { scenarioDoc } from "./setup.ts";
import type { LabData } from "./setup.ts";
import { checkRunSpec } from "./spec.ts";
import type { RunSpec } from "./spec.ts";
import { truthKey, truthKeyOf } from "./truth_key.ts";

/** How many truth keys the Worker keeps: a bound of its memory, not a domain number. */
const KEYS_KEPT = 16;

// 2026-10-30 S3e (docs/design/lab_ui.md sections 4 and 9): what the Worker holds for the challenge. A challenge lives here under its id from `challenge_start` until the guess or the give-up; the
// plant, the truth run and the injector's list never leave this module except inside the reveal. A run that is an unrevealed challenge is locked: the lineage view is refused for it (rule 2
// of section 4), so the lineage screen cannot be used to read the truth of a challenge in progress. Requests are checked here, because a link is user input.

export type Refusal = { ok: false; code: "invalid_spec" | "locked"; message: string };

export interface ChallengeStarted {
  ok: true;
  challenge: string;
  announced_type: string;
  record: RecordView | DecisionRecordView;
  /** The inputs the record was made under, each with its ledger id (section 6). */
  inputs: RefValue[];
  /** The key of the challenge's run (truth_key.ts): the page empties what it holds of a run with the same key (rule 2 of section 4). */
  key: string;
}

type State = SampleChallenge | DecisionChallenge;

/** A seed of a one-seed request: a neutral integer under the rules of the experiment config (non-negative integer, not date-shaped). */
export const checkSeed = (seed: unknown): { ok: true; seed: number } | { ok: false; message: string } => {
  try {
    return { ok: true, seed: checkSeeds([seed], 1)[0] as number };
  } catch (e) {
    return { ok: false, message: (e as Error).message.replace(/^experiment config: /, "") };
  }
};

/** The inputs of the loop of the decision variant (section 6): the readjustment switch and interval, the technique probability, the hold limit and the stability effects of pH. */
export const decisionInputs = (data: LabData, spec: RunSpec): RefValue[] => {
  const withSc8 = withDecisionScenario(data);
  if (!withSc8) return [];
  const doc = scenarioDoc(withSc8, decisionScenarioId(data));
  const setting = (name: string): RefValue[] => {
    const s = doc.settings[name];
    return s ? [{ name, value: spec.settings[name] ?? s.value, unit: s.unit, ref: s.ref }] : [];
  };
  const effects = (doc.stability as { analyte: string; container: string; [k: string]: unknown }[] | undefined) ?? [];
  const phEffects = effects.filter((e) => e.analyte === "ph").flatMap((e) =>
    Object.entries(e).flatMap(([key, v]): RefValue[] => {
      const p = v as { value?: number; unit?: string; ref?: string };
      return key !== "valid_to" && typeof p === "object" && p !== null && typeof p.value === "number" ? [{ name: `ph_${e.container}_${key}`, value: p.value, unit: p.unit ?? "", ref: p.ref ?? "" }] : [];
    }),
  );
  const hold = evaluationRefs(data).filter((r) => r.name === "hold_limit_min");
  return [...setting("ph_probe_readjust_on"), ...setting("ph_probe_readjust_interval_h"), ...setting("technique_error_probability"), ...hold, ...phEffects];
};

export const createChallenges = (data: LabData) => {
  const open = new Map<string, { state: State; key: string }>();
  let counter = 0;
  const invalid = (message: string): Refusal => ({ ok: false, code: "invalid_spec", message });
  // the truth key of the specs asked last (truth_key.ts): a lineage view, a plant and its truth overlay ask the same run again and again, and a key costs one truth run
  const keys = new Map<string, string>();
  /** The truth key of a checked spec of the lab's scenarios and a seed, without any action. */
  const keyOf = (spec: RunSpec, seed: number): string => {
    const asked = JSON.stringify([spec.scenario, spec.settings, spec.bay_profiles ?? null, spec.analyzer_profiles ?? null, spec.capture_path ?? null, seed]);
    const kept = keys.get(asked);
    if (kept !== undefined) return kept;
    const key = truthKey(data, spec, seed);
    keys.set(asked, key);
    if (keys.size > KEYS_KEPT) keys.delete(keys.keys().next().value as string);
    return key;
  };

  /** Whether the run of a spec, its actions stripped, has the truth of an unrevealed challenge's run, however the spec writes it (rule 2). */
  const locked = (spec: RunSpec, seed: number): boolean => {
    if (open.size === 0) return false;
    const key = keyOf(spec, seed);
    return [...open.values()].some((c) => c.key === key);
  };

  // the key of a truth log held as an array, by identity: the overlay of a kept plan asks the same log again for every sample picked
  const logKeys = new WeakMap<readonly Event[], string>();

  /** Whether an unrevealed challenge is open: a caller that must make a truth run to ask `lockedTruth` makes it only then. */
  const anyOpen = (): boolean => open.size > 0;

  /**
   * Whether a truth log, the events of a run with its operator actions applied, is the truth of an unrevealed challenge's run (rule 2; audit R1, S-01). `locked` asks the run its spec writes with the
   * actions stripped; this asks the run the actions make, because a spec that is not the challenge's can write its truth out (the default scenario with the maintenance window of SC5).
   */
  const lockedTruth = (events: readonly Event[]): boolean => {
    if (open.size === 0) return false;
    let key = logKeys.get(events);
    if (key === undefined) {
      key = truthKeyOf(events);
      logKeys.set(events, key);
    }
    return [...open.values()].some((c) => c.key === key);
  };

  const start = (raw: { variant: unknown; spec: unknown; seed: unknown; shown: unknown }, onProgress?: (done: number, total: number) => void): ChallengeStarted | Refusal => {
    const { variant, shown } = raw;
    const sample = variant === "sample";
    if (!sample && variant !== "decision") return invalid(`unknown challenge variant ${JSON.stringify(variant)}`);
    if (!sample && !data.decision) return invalid("the decision variant is not offered by this build");
    const checked = checkRunSpec(raw.spec, sample ? data : (withDecisionScenario(data) as LabData));
    if (!checked.ok) return invalid(checked.message);
    if (!sample && checked.spec.scenario !== decisionScenarioId(data)) return invalid(`the decision variant runs on the scenario ${decisionScenarioId(data)} only`);
    const seed = checkSeed(raw.seed);
    if (!seed.ok) return invalid(seed.message);
    if (typeof shown !== "string") return invalid("shown must name an architecture");
    const spec = checked.spec;
    const started = sample ? startSampleChallenge(data, spec, seed.seed, shown) : startDecisionChallenge(data, spec, seed.seed, shown, onProgress);
    if (!started.ok) return invalid(started.message);
    const challenge = `challenge-${(counter += 1)}`;
    // the decision variant runs a closed loop on SC8, a scenario no lineage view or plant can ask for, so its key matches no request
    const key = sample ? keyOf(spec, seed.seed) : `closed-loop:${challenge}`;
    open.set(challenge, { state: started.challenge, key });
    return { ok: true, challenge, announced_type: started.announced_type, record: started.record, inputs: sample ? inputsOf(data, spec) : decisionInputs(data, spec), key };
  };

  const find = (challenge: unknown): State | Refusal => {
    const held = typeof challenge === "string" ? open.get(challenge) : undefined;
    return held ? held.state : invalid(`no open challenge ${JSON.stringify(challenge)} (it was never started, or it has been revealed)`);
  };

  const drillDown = (challenge: unknown, sample_id: unknown): SampleRecord | Refusal => {
    const state = find(challenge);
    if ("ok" in state) return state;
    if (typeof sample_id !== "string") return invalid("sample_id must be a string");
    const column = state.variant === "sample" ? openSample(state, sample_id) : openDecisionSample(state, sample_id);
    return column ?? invalid(`the shown record holds no sample ${JSON.stringify(sample_id)}`);
  };

  /** One guess (a sample id, or a decision id for the decision variant) or, with `target` null, a give-up. The challenge is over after either. */
  const finish = (challenge: unknown, target: unknown): Reveal | Refusal => {
    const state = find(challenge);
    if ("ok" in state) return state;
    let guess: string | null = null;
    if (target !== null) {
      const t = target as { sample_id?: unknown; decision_id?: unknown } | undefined;
      if (state.variant === "sample") {
        if (typeof t?.sample_id !== "string") return invalid("this challenge is guessed by a sample id");
        if (!hasSample(state, t.sample_id)) return invalid(`the shown record holds no sample ${JSON.stringify(t.sample_id)}`);
        guess = t.sample_id;
      } else {
        if (typeof t?.decision_id !== "string") return invalid("this challenge is guessed by a decision id");
        if (!hasDecision(state, t.decision_id)) return invalid(`the shown record holds no decision ${JSON.stringify(t.decision_id)}`);
        guess = t.decision_id;
      }
    }
    const reveal = state.variant === "sample" ? revealSample(state, guess) : revealDecision(state, guess);
    open.delete(challenge as string);
    return reveal;
  };

  return { locked, lockedTruth, anyOpen, keyOf, start, drillDown, finish };
};

export type Challenges = ReturnType<typeof createChallenges>;
