import { describe, expect, it } from "vitest";
import { ATTRIB_CELLS, CLOCK_CELLS, FEED_CELLS, INSTRUMENT_CELLS, LABEL_CELLS, LATE_CELLS, LOT_CELLS, REKEY_CELLS, REKEY_OPEN_CELLS, REPLAY_CELLS, RERUN_CELLS, TECHNIQUE_CELLS } from "../support/cell_tables.ts";
import { CLOCK, FEED, LABEL, REKEY, REKEY_OPEN, REPLAY } from "../support/cell_rows_a.ts";
import { ATTRIB, INSTRUMENT, LATE, LOT, RERUN, TECHNIQUE } from "../support/cell_rows_b.ts";
import { CONFIGS, CONFIG_NAMES, classify } from "../support/cells.ts";
import type { Cell, CellRow } from "../support/cells.ts";

// S2c1, the structural gate of the recorders (spec section 6; prompts/20 Step 4; 00 section 2 item 8): for each row of the hypothesis matrix of spec
// section 5 that is not (raw) or (manual), one hand-built stream with one forced error, run through A, B, C and the eight single-flag ablations of C.
// Every expected cell is typed by hand in support/cell_tables.ts before any run. `detected` names its evidence: a rule id, or a named check of the record
// (audit_event, bridging_study, lot_link, container_hold). A cell the design does not decide is a todo, not a guess; none is open at present.

const cellTests = (title: string, when: string, row: CellRow, expected: readonly Cell[]): void => {
  describe(`Forced-error cells: ${title}`, () => {
    it("Given the table Then it has one hand-typed entry per configuration (A, B, C and the eight ablations)", () => {
      expect(expected.length).toBe(CONFIG_NAMES.length);
    });
    CONFIGS.forEach((c, i) => {
      const want = expected[i];
      it(`Given ${c.name} When ${when} Then ${want}`, () => {
        expect(classify(row, c.config)).toBe(want);
      });
    });
  });
};

cellTests("label or transcription error", "the sample-id text of S2 is wrong at the analyzer", LABEL, LABEL_CELLS);
cellTests("feed in the gap", "a feed falls between the draw and the measurement of S1", FEED, FEED_CELLS);
cellTests("unit or batch re-keyed (gross: no open batch)", "S1's label names a unit with no open batch", REKEY, REKEY_CELLS);
cellTests("unit or batch re-keyed (the other unit has an open batch)", "S1's label names a unit that has an open batch", REKEY_OPEN, REKEY_OPEN_CELLS);
cellTests("clock error", "AN-1 runs 5 h (18000 s) ahead", CLOCK, CLOCK_CELLS);
cellTests("duplicate or replayed file", "the result file of S1 is sent twice", REPLAY, REPLAY_CELLS);
cellTests("lost rerun or silent overwrite", "S2 is rerun and the rerun replaces the first attempt", RERUN, RERUN_CELLS);
cellTests("instrument effect between analyzers", "AN-2 reads 0.5 high", INSTRUMENT, INSTRUMENT_CELLS);
cellTests("instrument effect within an analyzer (reagent lot step)", "AN-2 reads 0.5 high on a new reagent lot", LOT, LOT_CELLS);
cellTests("late correction leaking into an earlier decision", "S1 is corrected after a decision was taken", LATE, LATE_CELLS);
cellTests("unattributable record", "the sampler of S2 must be named", ATTRIB, ATTRIB_CELLS);
cellTests("sampling technique error", "S2 was drawn into an open container and held 1000 s", TECHNIQUE, TECHNIQUE_CELLS);
