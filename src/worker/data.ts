import defaultScenario from "../../scenarios/default.json";
import allinoneAtline from "../../scenarios/profiles/analyzer/allinone_atline.json";
import benchManual from "../../scenarios/profiles/bioreactor/bench_manual.json";
import experienced from "../../scenarios/profiles/staff/experienced.json";
import aManual from "../../scenarios/architectures/a_manual.json";
import bLimsLite from "../../scenarios/architectures/b_lims_lite.json";
import cContext from "../../scenarios/architectures/c_context.json";
import evaluation from "../../scenarios/evaluation/default.json";

// The JSON the Worker bundles: the scenario the lab offers, the profiles it names, the three architecture presets and the evaluation settings. The engine reads no file (spec section 3), so
// Vite imports them here and the Worker hands them over as they are. A scenario, profile or preset the lab does not offer is not imported, so it is not shipped.

const PROFILES: Record<string, Record<string, unknown>> = {
  analyzer: { allinone_atline: allinoneAtline },
  bioreactor: { bench_manual: benchManual },
  staff: { experienced },
};

/** Every bundled document, for the tests that check what ships (the ledger ids they name). */
export const SHIPPED: readonly unknown[] = [defaultScenario, allinoneAtline, benchManual, experienced, aManual, bLimsLite, cContext, evaluation];

// Typed structurally: src/worker/worker.ts hands it to the lab functions as their LabData, and the compiler checks the shape there (this file may not import the engine).
export const LAB_DATA = {
  scenarios: { default: defaultScenario },
  lookup: (kind: string, id: string): unknown => {
    const profile = PROFILES[kind]?.[id];
    if (profile === undefined) throw new Error(`no bundled ${kind} profile ${id}`);
    return profile;
  },
  architectures: [aManual, bLimsLite, cContext] as readonly unknown[],
  evaluation,
};
