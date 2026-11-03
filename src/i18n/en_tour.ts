// English texts of the guided scene (docs/design/plant_ui.md section 3.5). Part of the dictionary of en.ts. No digit appears in a text: the sample, the unit, the analyzer, the scenario and the clock
// reading reach a text through a {placeholder} filled with a marked element (invariant 3). A step's text says where to look and what the record keeps; it states no simulation result, never calls the
// feed of this sample "scripted" (it is the rule's daily feed) and ranks nothing. The text of each step is in the tour box and, in the same words, in the text alternative.
export const enTour = {
  "plant.tour.button": "Take the tour",
  "plant.tour.button.hint": "A short tour of one sample: its draw, a feed before its measurement, and what each record kept.",
  "plant.tour.offer.heading": "New here? A short tour",
  "plant.tour.offer.text": "Follow one sample from its draw to the three record halls, and see what each record kept about when it was drawn and which process context its result was joined to. A few steps; skip it at any one.",
  "plant.tour.offer.take": "Take the tour",
  "plant.tour.offer.later": "Not now",

  "plant.tour.region": "Guided tour",
  "plant.tour.progress": "Step {n} of {total}",
  "plant.tour.optional": "optional",
  "plant.tour.back": "Back",
  "plant.tour.next": "Next",
  "plant.tour.finish": "Finish",
  "plant.tour.skip": "Skip the tour",
  "plant.tour.keys": "The arrow keys step through the tour and Escape skips it.",
  "plant.tour.waiting": "Opening the run of the tour.",
  "plant.tour.scenario": "The tour uses the scenario {scenario} and replaces the run on screen with it.",

  "plant.tour.draw.title": "The draw",
  "plant.tour.draw.text": "Sample {sample} is drawn from reactor {unit} at {clock}. Look at the operator at the reactor with the tube in hand: the floor shows the moment of the draw as it happened.",
  "plant.tour.feed.title": "A feed in the gap",
  "plant.tour.feed.text": "At {clock} reactor {unit} is fed, while the tube of sample {sample} is still on its way to the analyzer. Look at the line from the feed station to the reactor: the process context of the reactor moves on before the sample is measured.",
  "plant.tour.run.title": "The tube reaches the analyzer",
  "plant.tour.run.text": "At {clock} the tube is in analyzer {analyzer} and its run starts. Look at the panel of the sample: the draw, the arrival at the lane and the run are separate moments.",
  "plant.tour.records.title": "What the three records kept",
  "plant.tour.records.text": "At {clock} the result is written, and each record hall holds a card of sample {sample}. In the table, read what each record kept: the moment of the draw, and the time it used to join the result to a process context. A solid square is a field the record stores, a dashed hollow square one it does not.",
  "plant.tour.truth.title": "What the simulation knows",
  "plant.tour.truth.text": "This optional step turns on the simulation's own view of sample {sample}: its true reactor, the true moment of the draw and the true process context, which no record holds, and whether each record answered each question correctly.",

  "plant.tour.cards.caption": "The card of sample {sample} in each record hall",
  "plant.tour.cards.open": "Open the record of {architecture}",
  "plant.tour.slot.unit": "Reactor",
  "plant.tour.slot.sampled_at": "Moment of the draw",
  "plant.tour.slot.context": "Process context",
  "plant.tour.slot.value": "Result",
  "plant.tour.slot.stored": "stored",
  "plant.tour.slot.missing": "not stored",
  "plant.tour.slot.basis": "joined by {basis}",
  "plant.tour.verdicts.caption": "What each record answered about sample {sample}",

  "plant.tour.text.heading": "The guided scene as text",
  "plant.tour.text.lead": "The same steps as the tour on the floor, for the sample of the scenario {scenario}. Each step names its moment in the run.",
  "plant.tour.text.other": "The plant on screen is not the run of the tour, so the steps wait for it.",
  "plant.tour.text.open": "Open the run of the tour",
} as const;
