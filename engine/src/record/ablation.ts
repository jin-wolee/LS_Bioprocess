import { ABLATIONS } from "./architecture.ts";
import type { Architecture, FlagName } from "./architecture.ts";
import { record } from "./recorder.ts";
import type { RecordedDataset, RecorderInput } from "./types.ts";

/** C minus one flag for each of the ten flags (spec section 5), each recorded from the same input. The config must have every flag on. */
export const recordAblations = (input: RecorderInput, c: Architecture): { flag: FlagName; config: Architecture; dataset: RecordedDataset }[] =>
  ABLATIONS(c).map(({ flag, config }) => ({ flag, config, dataset: record(input, config) }));
