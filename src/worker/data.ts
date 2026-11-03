import defaultScenario from "../../data/scenarios/default.json";
import sc02 from "../../data/scenarios/sc02_shift_burst.json";
import sc03 from "../../data/scenarios/sc03_feed_in_gap.json";
import sc05 from "../../data/scenarios/sc05_one_analyzer_down.json";
import sc08 from "../../data/scenarios/sc08_ph_restandardisation.json";
import sc12Equipment from "../../data/scenarios/sc12_equipment.json";
import sc12MediumLot from "../../data/scenarios/sc12_medium_lot.json";
import sc12Mycoplasma from "../../data/scenarios/sc12_mycoplasma.json";
import sc12Sampling from "../../data/scenarios/sc12_sampling.json";
import sc12SeedLot from "../../data/scenarios/sc12_seed_lot.json";
import bacterial from "../../data/scenarios/profiles/breakout/bacterial.json";
import mycoplasma from "../../data/scenarios/profiles/breakout/mycoplasma.json";
import allinoneAtline from "../../data/scenarios/profiles/analyzer/allinone_atline.json";
import hplc from "../../data/scenarios/profiles/analyzer/hplc.json";
import splitAnalyzers from "../../data/scenarios/profiles/analyzer/split_cellcounter_metabolite.json";
import benchManual from "../../data/scenarios/profiles/bioreactor/bench_manual.json";
import microMini from "../../data/scenarios/profiles/bioreactor/micro_mini_parallel.json";
import pilot from "../../data/scenarios/profiles/bioreactor/pilot.json";
import allinoneCsv from "../../data/scenarios/profiles/dialect/allinone_csv.json";
import cdsTable from "../../data/scenarios/profiles/dialect/cds_table.json";
import counterCsv from "../../data/scenarios/profiles/dialect/counter_csv.json";
import experienced from "../../data/scenarios/profiles/staff/experienced.json";
import trainee from "../../data/scenarios/profiles/staff/trainee.json";
import aManual from "../../data/scenarios/architectures/a_manual.json";
import bLimsLite from "../../data/scenarios/architectures/b_lims_lite.json";
import cContext from "../../data/scenarios/architectures/c_context.json";
import evaluation from "../../data/scenarios/evaluation/default.json";
import experiment1 from "../../data/scenarios/experiments/experiment1.json";
import experiment2 from "../../data/scenarios/experiments/experiment2.json";
import sc12Experiment from "../../data/scenarios/experiments/sc12.json";
import { BREAKOUT_PUBLIC } from "../generated/breakout_public.ts";
import rawLayer from "./raw_layer.json";

// The JSON the Worker bundles: the four scenarios of the Setup picker, the profiles they and the Setup lists can name, the dialects of the raw layer, the three architecture presets,
// the evaluation settings, the seed list of experiment 1 and the lab's own raw-layer inputs; and, for the decision variant of the challenge (lab_ui.md section 9), SC8 and the experiment 2
// config (its seed list), which the Setup picker does not offer. The engine reads no file (spec section 3), so Vite imports them here and the Worker hands them over as they are. A scenario,
// profile or preset the lab does not offer is not imported, so it is not shipped.
//
// S3g: the Break-out screen's files (the five SC12 scenarios, the two event-type profiles and the SC12 config, whose seed list the screen offers) are bundled only when the build offers the
// screen (src/breakout_offer.ts): the public build while a source of the screen is below main-reread refuses it (ADR-0013), and then none of these figures ships.

const PROFILE_DOCS: readonly (Record<string, unknown> & { kind: string; profile_id: string })[] = [benchManual, microMini, pilot, allinoneAtline, hplc, splitAnalyzers, experienced, trainee];

/** The Break-out files, or none: the screen's data is in a build only when the build offers the screen. */
const BREAKOUT =
  !(import.meta.env.VITE_LAB_LOCAL === "1" || BREAKOUT_PUBLIC) // the rule of offerOf (src/breakout_offer.ts), written so that a bundler folds it and drops the files below
    ? undefined
    : {
        scenarios: { sc12_medium_lot: sc12MediumLot, sc12_seed_lot: sc12SeedLot, sc12_sampling: sc12Sampling, sc12_equipment: sc12Equipment, sc12_mycoplasma: sc12Mycoplasma },
        profiles: [bacterial, mycoplasma] as readonly unknown[],
        experiment: sc12Experiment,
      };

/** Every bundled document, for the tests that check what ships (the ledger ids they name). */
export const SHIPPED: readonly unknown[] = [
  defaultScenario, sc02, sc03, sc05, sc08, ...PROFILE_DOCS, allinoneCsv, cdsTable, counterCsv, aManual, bLimsLite, cContext, evaluation, experiment1, experiment2, rawLayer,
  ...(BREAKOUT ? [...Object.values(BREAKOUT.scenarios), ...BREAKOUT.profiles, BREAKOUT.experiment] : []),
];

// Typed structurally: src/worker/worker.ts hands it to the lab functions as their LabData, and the compiler checks the shape there (this file may not import the engine).
export const LAB_DATA = {
  scenarios: { default: defaultScenario, sc02_shift_burst: sc02, sc03_feed_in_gap: sc03, sc05_one_analyzer_down: sc05 },
  lookup: (kind: string, id: string): unknown => {
    const profile = PROFILE_DOCS.find((p) => p.kind === kind && p.profile_id === id);
    if (profile === undefined) throw new Error(`no bundled ${kind} profile ${id}`);
    return profile;
  },
  profiles: PROFILE_DOCS as readonly unknown[],
  dialects: { allinone_csv: allinoneCsv, counter_csv: counterCsv, cds_table: cdsTable } as Readonly<Record<string, unknown>>,
  architectures: [aManual, bLimsLite, cContext] as readonly unknown[],
  evaluation,
  experiment: experiment1,
  rawLayer,
  decision: { scenario: sc08, experiment: experiment2 },
  ...(BREAKOUT && { breakout: BREAKOUT }),
};
