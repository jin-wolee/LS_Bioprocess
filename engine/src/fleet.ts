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

/** What the check of the two lists reads of an analyzer profile: its id and the stages of its route (the group of a stage and the analytes it measures). The profile catalogue of the page has this shape too. */
export interface FleetEntry {
  id: string;
  stages: { group: string; analytes: string[] }[];
}

/** One analyzer by its place in the list: the profile it lists and the position of its first appearance, analyzer 1 first. */
export interface FleetSeat {
  profile: string;
  analyzer: number;
}

/** A refusal of the two lists, as data (`fleetProblems`); `loadFleet` words the first one as a message. */
export type FleetProblem =
  | { kind: "shared_group"; group: string; first: FleetSeat; second: FleetSeat }
  | { kind: "shared_analyte"; analyte: string; first: FleetSeat; second: FleetSeat }
  | { kind: "unmeasured"; analyte: string; menu: string };

const entryOf = (profile: Profile): FleetEntry => ({
  id: profile.profile_id,
  stages: (profile.route ?? []).map((stage) => ({ group: stage.group, analytes: stage.analytes.map((a) => a.id) })),
});

const analytesOf = (entry: FleetEntry): string[] => [...new Set(entry.stages.flatMap((stage) => stage.analytes))];

/**
 * The problems of an analyzer list, in the order the loader meets them: a group name that belongs to two profiles, an analyte that two profiles measure (rule B), then the analytes of the menu
 * (the route of `profiles.analyzer`) that no profile measures. `analyzers` is the profile of each analyzer, analyzer 1 first; a profile listed twice is one pool and never clashes with itself.
 * Pure: it reads the entries and nothing else, so the loader below and the Setup page of the lab give the same verdict.
 */
export const fleetProblems = (analyzers: readonly FleetEntry[], menu: FleetEntry): FleetProblem[] => {
  const distinct = new Map<string, { entry: FleetEntry; analyzer: number }>();
  analyzers.forEach((entry, i) => {
    if (!distinct.has(entry.id)) distinct.set(entry.id, { entry, analyzer: i + 1 });
  });
  const problems: FleetProblem[] = [];
  const groupOf = new Map<string, FleetSeat>();
  for (const { entry, analyzer } of distinct.values()) {
    for (const stage of entry.stages) {
      const held = groupOf.get(stage.group);
      if (held !== undefined && held.profile !== entry.id) problems.push({ kind: "shared_group", group: stage.group, first: held, second: { profile: entry.id, analyzer } });
      groupOf.set(stage.group, { profile: entry.id, analyzer });
    }
  }
  const owner = new Map<string, FleetSeat>();
  for (const { entry, analyzer } of distinct.values()) {
    for (const a of analytesOf(entry)) {
      const held = owner.get(a);
      if (held === undefined) owner.set(a, { profile: entry.id, analyzer });
      else if (held.profile !== entry.id) problems.push({ kind: "shared_analyte", analyte: a, first: held, second: { profile: entry.id, analyzer } });
    }
  }
  for (const a of analytesOf(menu)) if (!owner.has(a)) problems.push({ kind: "unmeasured", analyte: a, menu: menu.id });
  return problems;
};

const messageOf = (problem: FleetProblem): string => {
  switch (problem.kind) {
    case "shared_group":
      return `analyzer profiles ${problem.first.profile} and ${problem.second.profile} both name the group ${problem.group}; a group is the pool of one stage of one profile, so the names must differ`;
    case "shared_analyte":
      return `the analyte ${problem.analyte} is measured by both ${problem.first.profile} (analyzer ${problem.first.analyzer}) and ${problem.second.profile} (analyzer ${problem.second.analyzer}); in this build an analyte has one profile (spec section 4.5, routing rule B)`;
    case "unmeasured":
      return `the analyte ${problem.analyte} is requested (it is in the route of profiles.analyzer, ${problem.menu}) but no analyzer profile in analyzer_profiles measures it; list an analyzer with a profile that does, or change profiles.analyzer (spec section 4.5)`;
  }
};

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
  const loaded = new Map<string, Profile>();
  const parsed = listed.map((id, i) => {
    const profile = named(scenario, "analyzer_profiles", i, "analyzer", id, lookup);
    if (!loaded.has(profile.profile_id)) loaded.set(profile.profile_id, profile);
    return profile;
  });
  const [problem] = fleetProblems(parsed.map(entryOf), entryOf(menu));
  if (problem !== undefined) throw new Error(`scenario ${scenario}: ${messageOf(problem)}`);
  return fleetOf(parsed.map((p) => p.profile_id), [...loaded.values()], routeOf);
};
