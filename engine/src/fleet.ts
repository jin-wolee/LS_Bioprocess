import { loadProfile } from "./profiles.ts";
import type { Profile, ProfileKind, ProfileLookup } from "./profiles.ts";

// Mixed fleets (ADR-0015, spec section 4.5): a profile per bay and a profile per analyzer. Routing rule B: an analyte has one profile, and a sample visits each distinct
// listed analyzer profile once, in the order of first appearance in the list, stage by stage. The plan is built here at load; the L3 core and the trace schema do not change
// (a visit names one group, an instrument carries one group). Nothing here branches on a profile id. The stages of a profile are read by the caller's `routeOf` (measure.ts),
// so this module stays out of the truth modules' import zone.

export interface Instrument {
  /** AN-1, AN-2, ... stage by stage and, inside a stage, in the list order of the analyzers that have the stage (spec 4.5.2). */
  id: string;
  /** The index of the stage of the plan this instrument serves. */
  stage: number;
  /** The analyzer profile whose analyzer this instrument belongs to. */
  profile: string;
}

export interface Fleet<S> {
  /** The analyzer profile id of each analyzer, analyzer 1 first. */
  analyzers: string[];
  /** The stages a sample visits, in order (the route of the one profile when the fleet has one). */
  plan: S[];
  instruments: Instrument[];
}

/** The bays are the reactors in bays of `bay_size`; the last bay may be smaller (spec 4.5.1). */
export const bayCount = (reactors: number, baySize: number): number => Math.ceil(reactors / baySize);

const plural = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? "" : "s"}`;

/** The parsed profile a list entry names; an id the lookup does not know is named by field and position. */
const named = (scenario: string, field: string, i: number, kind: ProfileKind, id: string, lookup: ProfileLookup): Profile => {
  let raw: unknown;
  try {
    raw = lookup(kind, id);
  } catch {
    raw = undefined;
  }
  if (raw === undefined || raw === null) throw new Error(`scenario ${scenario}: ${field}[${i}] names the ${kind} profile "${id}", which is not in the profile set`);
  return loadProfile(raw, kind);
};

/** The bioreactor profile of each bay (spec 4.5.2, 4.5.3). */
export const loadBays = (scenario: string, listed: readonly string[], shape: { reactors: number; baySize: number }, lookup: ProfileLookup): Profile[] => {
  const bays = bayCount(shape.reactors, shape.baySize);
  if (listed.length !== bays) {
    throw new Error(`scenario ${scenario}: bay_profiles names ${plural(listed.length, "bioreactor profile")} but the scenario has ${plural(bays, "bay")} (reactor_count ${shape.reactors} in bays of ${shape.baySize}); name one bioreactor profile per bay, bay 1 first (spec section 4.5)`);
  }
  return listed.map((id, i) => {
    const profile = named(scenario, "bay_profiles", i, "bioreactor", id, lookup);
    if (!profile.containers?.default) throw new Error(`profile ${profile.profile_id}: containers needs a default entry`);
    return profile;
  });
};

const analytesOf = (profile: Profile): string[] => (profile.route ?? []).flatMap((stage) => stage.analytes.map((a) => a.id));

const fleetOf = <S>(analyzers: string[], distinct: readonly Profile[], routeOf: (profile: Profile) => S[]): Fleet<S> => {
  const plan: S[] = [];
  const first = new Map<string, { offset: number; stages: number }>();
  for (const profile of distinct) {
    const stages = routeOf(profile);
    first.set(profile.profile_id, { offset: plan.length, stages: stages.length });
    plan.push(...stages);
  }
  const depth = Math.max(...[...first.values()].map((f) => f.stages));
  const instruments: Instrument[] = [];
  for (let s = 0; s < depth; s++) {
    for (const profile of analyzers) {
      const f = first.get(profile) as { offset: number; stages: number };
      if (s < f.stages) instruments.push({ id: `AN-${instruments.length + 1}`, stage: f.offset + s, profile });
    }
  }
  return { analyzers, plan, instruments };
};

/**
 * The fleet of a scenario. `listed` is `analyzer_profiles`; absent, every analyzer takes the scenario's analyzer profile (`menu`) and the fleet is what it always was.
 * With a list: the length is `analyzer_count`; a group name belongs to one profile; every analyte of the menu (the route of `profiles.analyzer`) is measured by some
 * listed analyzer; no analyte is measured by two listed profiles (rule B), which also keeps the noise keys of one sample apart (the key names the analyte).
 */
export const loadFleet = <S>(scenario: string, listed: readonly string[] | undefined, menu: Profile, count: number, lookup: ProfileLookup, routeOf: (profile: Profile) => S[]): Fleet<S> => {
  if (listed === undefined) return fleetOf(Array.from({ length: count }, () => menu.profile_id), [menu], routeOf);
  if (listed.length !== count) {
    throw new Error(`scenario ${scenario}: analyzer_profiles names ${plural(listed.length, "analyzer profile")} but analyzer_count is ${count}; name one analyzer profile per analyzer, analyzer 1 first (spec section 4.5)`);
  }
  const loaded = new Map<string, { profile: Profile; analyzer: number }>();
  const analyzers = listed.map((id, i) => {
    const profile = named(scenario, "analyzer_profiles", i, "analyzer", id, lookup);
    if (!loaded.has(profile.profile_id)) loaded.set(profile.profile_id, { profile, analyzer: i + 1 });
    return profile.profile_id;
  });
  const distinct = [...loaded.values()];
  const groupOf = new Map<string, string>();
  for (const { profile } of distinct) {
    for (const stage of profile.route ?? []) {
      const other = groupOf.get(stage.group);
      if (other !== undefined && other !== profile.profile_id) {
        throw new Error(`scenario ${scenario}: analyzer profiles ${other} and ${profile.profile_id} both name the group ${stage.group}; a group is the pool of one stage of one profile, so the names must differ`);
      }
      groupOf.set(stage.group, profile.profile_id);
    }
  }
  const owner = new Map<string, { profile: string; analyzer: number }>();
  for (const { profile, analyzer } of distinct) {
    for (const a of analytesOf(profile)) {
      const held = owner.get(a);
      if (held !== undefined && held.profile !== profile.profile_id) {
        throw new Error(`scenario ${scenario}: the analyte ${a} is measured by both ${held.profile} (analyzer ${held.analyzer}) and ${profile.profile_id} (analyzer ${analyzer}); in this build an analyte has one profile (spec section 4.5, routing rule B)`);
      }
      owner.set(a, { profile: profile.profile_id, analyzer });
    }
  }
  const unmeasured = analytesOf(menu).find((a) => !owner.has(a));
  if (unmeasured !== undefined) {
    throw new Error(`scenario ${scenario}: the analyte ${unmeasured} is requested (it is in the route of profiles.analyzer, ${menu.profile_id}) but no analyzer profile in analyzer_profiles measures it; list an analyzer with a profile that does, or change profiles.analyzer (spec section 4.5)`);
  }
  return fleetOf(analyzers, distinct.map((d) => d.profile), routeOf);
};
