// English texts of the drill-downs from the plant and of the plant link (docs/design/plant_ui.md section 7, "As built in P5c"). Part of the dictionary of en.ts. No digit appears in a text: an identifier or a
// count reaches a text through a {placeholder} filled with a marked element (invariant 3).
export const enDrill = {
  "plant.drill.heading": "Other screens",
  "plant.drill.lineage": "Follow {sample} in Lineage",
  "plant.drill.lineage.none": "No sample has been drawn on this reactor yet, so there is nothing to follow.",
  "plant.drill.results": "See this architecture over many seeds in Results",
  "plant.drill.utilisation": "See how busy the analyzers are over many seeds in Results",
  "plant.drill.notes": "Read in Notes what the qualification of a record is",

  "plant.origin.label": "Opened from the plant",
  "plant.origin.run": "From the plant: scenario {scenario}, seed {seed}, {actions} operator actions, left at {clock}.",
  "plant.origin.run_open": "From the plant: scenario {scenario}, seed {seed}, {actions} operator actions.",
  "plant.origin.back": "Back to the plant",
  "plant.origin.results": "Results over many seeds carries no plant action in this version: the actions of the plant are not applied to it.",
  "plant.origin.utilisation": "Press Run: the utilisation of the analyzers is at the end of Results.",

  "plant.link.heading": "The link was read with changes",
  "plant.link.scenario": "The scenario {given} is not one this build offers, so the default scenario is run.",
  "plant.link.settings": "The setting {given} is not a number and was left out.",
  "plant.link.capture": "The capture path {given} is not one of the two this build offers and was left out.",
  "plant.link.arch": "The record architecture {given} is not one this build offers and was left out.",
  "plant.link.seed": "The seed {given} is not a whole number from zero up, so the default seed {fallback} is run.",
  "plant.link.actions": "The actions {given} are not a list and were left out.",
  "plant.link.t": "The instant {given} is not a whole number of seconds, so the clock opens at the start of the run.",
  "plant.link.t_range": "The instant {given} lies outside the run, which ends at {horizon} seconds, so the clock opens at the start of the run.",
  "plant.link.schema": "The link was made for the schema {given}; it was read as this build's schema.",
  "plant.link.engine": "The link was made with the engine {made}; it runs with the engine {current}.",
} as const;
