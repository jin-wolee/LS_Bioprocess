// English texts of the lab (docs/design/lab_ui.md section 10): the source of the dictionary. A flat object, keys by screen, {name} placeholders. src/i18n/ko.ts is typed against it, so a
// missing Korean key is a type error. A text holds no digit: every number on the page is an input with a ledger id (<Ref>), a simulation result (<ResultBlock>) or a label (invariant 3).
// Strings that come from the engine (error messages, the reason of the check) are data and are shown verbatim in a lang="en" element under a translated label.
import { enBreakout } from "./en_breakout.ts";
import { enChallenge } from "./en_challenge.ts";
import { enLineage } from "./en_lineage.ts";
import { enNotes } from "./en_notes.ts";
import { enOneFlag } from "./en_oneflag.ts";
import { enAct } from "./en_act.ts";
import { enDrill } from "./en_drill.ts";
import { enItems } from "./en_items.ts";
import { enPlant } from "./en_plant.ts";
import { enResults } from "./en_results.ts";
import { enSetup } from "./en_setup.ts";
import { enTour } from "./en_tour.ts";

export const enBase = {
  "app.title": "Sample Lineage Lab",
  "app.footer": "Synthetic data. Simulation results under the inputs shown; not a prediction of a real plant.",
  "app.loading": "Starting the engine in a Worker.",

  "nav.label": "Screens",
  "nav.home": "Home",
  "nav.setup": "Setup",
  "nav.results": "Results",
  "nav.lineage": "Lineage",
  "nav.challenge": "Challenge",
  "nav.breakout": "Break-out",
  "nav.notes": "Notes",

  "controls.site": "Explainer page",
  "controls.lang.label": "Language",
  "controls.lang.switch": "한국어",
  "controls.theme.label": "Theme",
  "controls.theme.auto": "Follow the system",
  "controls.theme.light": "Light",
  "controls.theme.dark": "Dark",

  "home.heading": "A synthetic plant, run in your browser",
  "home.lead": "Bioreactors share at-line analyzers, and every sample that reaches an analyzer is tracked by lineage. This lab runs the same synthetic run through several data architectures and compares what each one can reconstruct afterwards.",
  "home.notice": "Everything here is synthetic. The page runs a simulation under the inputs listed below; it describes no real plant and predicts none.",
  "home.versions.heading": "Versions",
  "home.versions.engine": "Engine version",
  "home.versions.schema": "Schema version",
  "home.run.heading": "One run of the default scenario",
  "home.run.lead": "These are counts of the events that the simulated plant produced in this browser, on this visit, for one seed. They are a simulation result under the inputs shown, not a fact about a real plant.",
  "home.run.pending": "Waiting for the run.",
  "home.about.summary": "About this run: checks and inputs",
  "home.inputs.heading": "Inputs of the default scenario",
  "home.inputs.lead": "Every input carries the id of its entry in the assumption ledger and the grade of that entry. A dashed chip marks an input whose sources have not all been re-read.",

  "result.label": "Simulation result",
  "result.scenario": "Scenario",
  "result.seeds": "Seeds",
  "result.engine": "Engine version",
  "result.architectures": "Architectures",
  "result.architectures.none": "none: this run records nothing",
  "result.check": "Browser check",
  "result.check.pending": "unchecked",
  "result.check.identical": "passed",
  "result.check.failed": "not verified",
  "result.check.error": "unchecked",
  "result.events.type": "Event type",
  "result.events.count": "Events",
  "result.events.total": "All events",

  "check.label": "Browser check",
  "check.chip.pending": "Running",
  "check.chip.identical": "Passed",
  "check.chip.failed": "Failed",
  "check.chip.error": "Could not run",
  "check.banner.pending": "Browser check running. Results shown now are unchecked.",
  "check.banner.identical": "Browser check passed: this browser reproduces the reference run byte for byte.",
  "check.banner.failed": "Browser check FAILED: this browser gave a different result from the reference. Results below are not verified. The page cannot tell a compiler fault from another engine difference.",
  "check.banner.error": "Browser check could not run. Results are unchecked. Reason:",
  "check.detail.heading": "What was compared",
  "check.part.truth": "Truth log hash of the default scenario against the reference",
  "check.part.repeats": "Repeats of one seed agree with each other",
  "check.part.cells": "Metric cells of one seed against the reference",
  "check.part.equal": "equal",
  "check.part.differs": "differs",
  "check.scope": "What it covers: the open loop of the default scenario, and nothing more. The truth log is compared for the seeds {seeds} and the metric cells for seed {cell_seed}, each against the reference made in Node at build time. Every other scenario is not covered, and neither is the closed loop of {closed_loop}.",

  "error.heading": "The engine reported a problem",
  "error.invalid_spec": "The run request was refused:",
  "error.engine_error": "The engine stopped with this message:",
  "error.worker": "The Worker could not start or stopped:",
  "error.cancelled": "The run was stopped between two seeds:",
  "error.locked": "The request was refused because this run is an open challenge:",
  "error.heading.cancelled": "The run was cancelled",
  "error.heading.refused": "The run was not started",

  "grade.S": "sourced",
  "grade.P": "proxy",
  "grade.D": "derived",
  "grade.A": "assumed",
  "grade.provisional": "provisional",
} as const;

export const en = { ...enBase, ...enSetup, ...enResults, ...enNotes, ...enLineage, ...enChallenge, ...enBreakout, ...enPlant, ...enDrill, ...enAct, ...enItems, ...enTour, ...enOneFlag } as const;

export type Key = keyof typeof en;
