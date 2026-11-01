import { sampleRecordOf } from "./lineage.ts";
import type { SampleRecord } from "./lineage.ts";
import type { PlantKept } from "./plant.ts";

// The `plant_record` request (docs/design/plant_ui.md section 6): the rows one architecture holds for one sample, for the record panel. It is the lineage view's own function (`sampleRecordOf`) read
// from the dataset the Worker kept for the epoch, so nothing is recomputed and nothing is guessed: a field the record does not store is null and a key that is null ends in a gap. No truth column,
// no answer and no verdict. A hall holds a card only for a sample its architecture holds a row of, so a request for a sample without a card is refused, not answered with an empty record: an empty
// answer would show the absence of a row, and absence is shown in the truth overlay only (section 3.3).

export type PlantRecordResult = { ok: true; sample: SampleRecord } | { ok: false; message: string };

export const answerPlantRecord = (kept: PlantKept, architecture: string, sample_id: string): PlantRecordResult => {
  const hall = kept.halls.get(architecture);
  if (!hall) return { ok: false, message: `the plant holds no record hall ${JSON.stringify(architecture)} (not in the run, or not built yet)` };
  if (!hall.cards.has(sample_id)) return { ok: false, message: `the hall ${architecture} holds no card for ${JSON.stringify(sample_id)}` };
  return { ok: true, sample: sampleRecordOf(hall.dataset, sample_id) };
};
