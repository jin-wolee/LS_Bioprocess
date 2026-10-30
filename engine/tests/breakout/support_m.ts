import { loadScenario } from "../../src/scenario.ts";
import type { ScenarioConfig } from "../../src/scenario.ts";
import { lookup } from "../support/scenarios.ts";
import type { ProfileKind } from "../../src/profiles.ts";
import type { Json } from "../support/schemas.ts";
import { docOf, fx12a, h, q } from "./support.ts";

// Test side of the mycoplasma batch (spec 11.8.5 row 5, FX12m of 11.8.4): the layout of FX12a with the mycoplasma profile. Every input that has no ledger number (A219 to A224, A226) is a test design
// choice and not data: the ramp 12 h is the one FX12m states; the others are chosen so that nothing in the tables of 11.8.4 depends on them. FX12m runs 31 days (A189): the culture result comes at 727 h.

export const d = (value: number, ref: string): Json => q(value, "d", ref);

export interface MycoplasmaChoices {
  nat?: 0 | 1;
  ramp?: number;
  plateau?: number;
  growth?: number;
  fall?: number;
  death?: number;
}

/** The seven scenario inputs of the mycoplasma profile, in the order the profile declares them. */
export const mycoplasmaInputs = (o: MycoplasmaChoices = {}): Json => ({
  mycoplasma_do_rise_ramp_h: h(o.ramp ?? 12, "A219"),
  mycoplasma_plateau_delay_d: d(o.plateau ?? 2, "A220"),
  mycoplasma_growth_multiplier_after_plateau: q(o.growth ?? 0.5, "factor", "A221"),
  mycoplasma_viability_fall_delay_d: d(o.fall ?? 3, "A222"),
  mycoplasma_death_multiplier_after_fall: q(o.death ?? 2, "factor", "A223"),
  nat_target_covers_organism: q(o.nat ?? 1, "flag", "A224"),
  nat_sample_volume_ml: q(1, "mL", "A226"),
});

/** The break-out block of FX12m: the topology, the response and the confirm list of FX12a, the mycoplasma profile and its inputs. The lag is the profile's own, 48 h (A138). */
export const fx12m = (o: MycoplasmaChoices = {}): Json => ({ ...fx12a(), profile: "mycoplasma", inputs: mycoplasmaInputs(o) });

/** 31 days: the latest result (the culture of A144, 28 d after the confirming draw at 55 h) comes at 727 h. */
export const HORIZON_31: Record<string, number> = { horizon_days: 31 };

export const docOfM = (block: Json, settings: Record<string, number> = {}): Json => docOf(block, { ...HORIZON_31, ...settings });

/** The scenario with the profile read through a lookup that drops what `edit` removes: the same inputs, the same scenario, a profile without (for example) the host effects. */
export const loadedWith = (doc: Json, edit: (profile: Record<string, unknown>) => void): ScenarioConfig =>
  loadScenario(doc, (kind: ProfileKind, id: string) => {
    const profile = structuredClone(lookup(kind, id)) as Record<string, unknown>;
    if (kind === "breakout") edit(profile);
    return profile;
  });
