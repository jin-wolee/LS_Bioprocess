import type { ControllerProfile } from "../generated/controller_profile.schema";
import { logKindOf } from "../raw/controller_types.ts";
import type { LogKind } from "../raw/controller_types.ts";
import { BANNER } from "../raw/types.ts";

// The adapter entry of a controller (data_model section 16.1, `adapter`; spec 2.4.1, rule 2): a controller profile plus what the parser BELIEVES about one controller. The real
// settings of the controller are scenario data used by the emitter; a mismatch between the two is an injected error, not a parser fault. The entry is master data, immutable once a
// file was parsed with it (K21).

export interface EntryLog {
  log: string;
  kind: LogKind;
  file_prefix: string;
  columns: string[];
  roles: string[];
}

export interface ControllerEntry {
  adapter_id: string;
  adapter_version: number;
  profile_id: string;
  device_class: "controller";
  /** The controller (one per bay): the source system of everything loaded. */
  controller: string;
  stamp_form: ControllerProfile["stamp"]["form"];
  /** The zone the adapter applies to a local wall-clock stamp, seconds ahead of UTC; null leaves every such stamp unresolved (VR-024, RQ1). */
  source_zone_s: number | null;
  logs: EntryLog[];
  modeled_on: string[];
  banner: string;
}

/** What the entry believes about the controller; the zone defaults to 0 h, as the analyzer entry does. */
export interface ControllerBelief {
  controller: string;
  source_zone_s?: number | null;
  adapter_version?: number;
}

export const controllerEntry = (profile: ControllerProfile, belief: ControllerBelief): ControllerEntry => ({
  adapter_id: `AD-${profile.profile_id}-${belief.controller}`, adapter_version: belief.adapter_version ?? 1, profile_id: profile.profile_id, device_class: "controller", controller: belief.controller,
  stamp_form: profile.stamp.form, source_zone_s: belief.source_zone_s === undefined ? 0 : belief.source_zone_s,
  logs: profile.logs.map((l) => ({ log: l.log, kind: logKindOf(l.log), file_prefix: l.file_prefix, columns: [...l.columns], roles: [...l.roles] })),
  modeled_on: [...profile.modeled_on], banner: BANNER,
});
