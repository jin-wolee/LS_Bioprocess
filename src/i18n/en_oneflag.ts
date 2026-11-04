// English texts of the card "What one stored timestamp changes" on Home (docs/design/lab_ui.md section 26; A3). Part of the dictionary of en.ts. No digit appears in a text (every number of the answer
// is a figure of a result block or a label), and no text says which record is better, orders the records or states a result: a text says what the case is, what a figure is and what a flag does.
// The words of Results are reused wherever they exist (the metric names, the detection names, the statuses, the hold-time rule's lead), so this file holds only what the card adds.
export const enOneFlag = {
  "oneflag.heading": "What one stored timestamp changes",
  "oneflag.lead": "Run a synthetic case in which a feed lands between the draw of a sample and its measurement, under record C and under record C that stores only the measurement time, and ask the same questions of both records.",
  "oneflag.q.mismatch": "How often is a result joined to the wrong process state?",
  "oneflag.q.mismatch.note": "The figure is the share of requests whose joined process state differs from the process state at the draw. A record that stores only the measurement time joins on that time.",
  "oneflag.q.detection": "Can any check see that wrong join?",
  "oneflag.q.detection.note": "Recall is always shown with precision and the false-alarm rate. A figure with no value shows its status and the reason.",
  "oneflag.q.cost": "What does the second clock cost?",
  "oneflag.cost.note": "This question is the cost of the second clock. The hold-time rule runs only when both times are stored, and a result it rejects is not shown to the read, so its request is not available.",
  "oneflag.link": "See all results for this run",
} as const;
