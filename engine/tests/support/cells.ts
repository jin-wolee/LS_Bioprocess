import { cellOf, inKey, ruleFlags } from "../../src/experiments/assembly/lab/outcome.ts";
import type { Cell } from "../../src/experiments/assembly/lab/outcome.ts";
import { inject } from "../../src/inject/inject.ts";
import type { ForcedError, InjectResult } from "../../src/inject/types.ts";
import type { ObservableEvent } from "../../src/observe.ts";
import { ABLATIONS, parseArchitecture } from "../../src/record/architecture.ts";
import type { Architecture } from "../../src/record/architecture.ts";
import { record } from "../../src/record/recorder.ts";
import type { QualificationInput, RecordedDataset, RecorderInput } from "../../src/record/types.ts";
import { validate } from "../../src/record/validate.ts";
import type { RuleConfig } from "../../src/record/validate.ts";
import { VALID_QUALIFICATIONS } from "./cell_stream.ts";
import { readJson } from "./paths.ts";

// The forced-error cells (spec section 6; docs/prompts/20 Step 4): one hand-built stream per row of the hypothesis matrix, one error, run through
// A, B, C and each single-flag ablation of C. This module only runs a row through a configuration and names what happened; the expected
// outcome of every cell is typed by hand in cell_tables.ts, from the matrix, the flag table and the rule catalogue, never from this output.
// The classification of a cell (Cell, cellOf, inKey, ruleFlags) moved to the lab folder in S3e (engine/src/experiments/assembly/lab/outcome.ts, where the reveal of the challenge uses it);
// it is re-exported here, so the rows and the tables are unchanged and stay the oracle.

const preset = (name: string): Architecture => parseArchitecture(readJson("data", "scenarios", "architectures", `${name}.json`));
const C = preset("c_context");

/** The 13 configurations in table order: A, B, C, then C minus system_issued_id ... C minus equipment_links (the order of the flag table). */
export const CONFIGS: { name: string; config: Architecture }[] = [
  { name: "A", config: preset("a_manual") },
  { name: "B", config: preset("b_lims_lite") },
  { name: "C", config: C },
  ...ABLATIONS(C).map(({ flag, config }) => ({ name: `C-${flag}`, config })),
];
export const CONFIG_NAMES = CONFIGS.map((c) => c.name);

export { inKey, ruleFlags };
export type { Cell };

export interface CellRow {
  events: ObservableEvent[];
  /** Forced mode: the errors to materialise (an empty list for the structural types, which follow from the stream and the flags). */
  forced?: ForcedError[];
  clock_offsets?: Record<string, number>;
  plan?: RecorderInput["plan"];
  qualifications?: QualificationInput[];
  rules: RuleConfig;
  /** Did the error arise in this configuration? Read from the injector's key, or from the record where the error is in the stream by construction. */
  realised: (out: InjectResult, ds: RecordedDataset) => boolean;
  /** Names of the evidence that shows the realised error in the record: rule ids, or the name of an evidence check. Empty: nothing shows it. */
  evidence: (ds: RecordedDataset) => string[];
}

export interface Ran {
  out: InjectResult;
  ds: RecordedDataset;
  not_evaluable: { rule: string; reason: string }[];
}

/** The pipeline of one cell: inject (forced), record, validate. No truth, no key, no evaluator. */
export const run = (row: CellRow, config: Architecture, opts: { qualifications?: QualificationInput[] } = {}): Ran => {
  const out = inject({ seed: 1, architecture: { id: config.id, flags: config.flags }, events: row.events, forced: row.forced ?? [], ...(row.clock_offsets && { clock_offsets: row.clock_offsets }) });
  const qualifications = opts.qualifications ?? row.qualifications ?? VALID_QUALIFICATIONS;
  const recorded = record({ events: out.events, sensors: [], received_at: out.received_at, qualifications, ...(row.plan && { plan: row.plan }) }, config);
  const validated = validate(recorded, row.rules);
  return { out, ds: validated.dataset, not_evaluable: validated.not_evaluable };
};

export const classify = (row: CellRow, config: Architecture): Cell => {
  const { out, ds } = run(row, config);
  return cellOf(row.realised(out, ds), () => row.evidence(ds));
};

export const cellsOf = (row: CellRow): Cell[] => CONFIGS.map((c) => classify(row, c.config));
