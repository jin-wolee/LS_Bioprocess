import { describe, expect, it } from "vitest";
import { outcomeOf } from "../../src/experiments/assembly/lab/outcome.ts";
import type { Outcome } from "../../src/experiments/assembly/lab/outcome.ts";
import type { ForcedError } from "../../src/inject/types.ts";
import { LABEL, REKEY, REKEY_OPEN, REPLAY } from "../support/cell_rows_a.ts";
import { LABEL_CELLS, REKEY_CELLS, REKEY_OPEN_CELLS, REPLAY_CELLS } from "../support/cell_tables.ts";
import type { Cell } from "../support/cells.ts";
import { CONFIGS, run } from "../support/cells.ts";
import type { CellRow } from "../support/cells.ts";

// S3e, `outcomeOf` (docs/design/lab_ui.md section 5): the classification of a planted error in one recorded dataset. The oracle is the set of hand-typed expected cells of S2
// (engine/tests/support/cell_tables.ts, typed from the hypothesis matrix before any run): the hand-built streams of the three drawn types are run through the 13 configurations (A, B, C and
// the ten ablations of C) and the function must give the typed cell for each, from the injector's realised list and the record only.

const asCell = (o: Outcome): Cell => (o.outcome === "detected" ? `detected:${o.evidence.join("+")}` : o.outcome);

const cases: [string, CellRow, readonly Cell[]][] = [
  ["label error", LABEL, LABEL_CELLS],
  ["unit re-keyed onto a unit with no open batch", REKEY, REKEY_CELLS],
  ["unit re-keyed onto a unit with an open batch", REKEY_OPEN, REKEY_OPEN_CELLS],
  ["duplicate or replayed file", REPLAY, REPLAY_CELLS],
];

describe("outcomeOf against the hand-typed cells of S2", () => {
  for (const [name, row, expected] of cases) {
    it(`Given the ${name} in each of the thirteen configurations Then the outcome and its evidence equal the typed cell`, () => {
      const planted = (row.forced ?? [])[0] ?? ({ type: "duplicate_replay", sample_id: "S1" } as ForcedError);
      const got = CONFIGS.map((c) => {
        const { out, ds } = run(row, c.config);
        return asCell(outcomeOf(planted, ds, out.materialised));
      });
      expect(got).toEqual(expected);
    });
  }

  it("Given a configuration that prevents the error Then the outcome is prevented and names no evidence", () => {
    const { out, ds } = run(LABEL, CONFIGS[1]?.config as NonNullable<(typeof CONFIGS)[number]>["config"]); // B: system_issued_id on
    expect(outcomeOf((LABEL.forced ?? [])[0] as ForcedError, ds, out.materialised)).toEqual({ outcome: "prevented", evidence: [] });
  });

  it("Given a detected error Then the evidence is the sorted rule ids, each once", () => {
    const { out, ds } = run(REKEY, CONFIGS.find((c) => c.name === "C-write_time_keys")?.config as NonNullable<(typeof CONFIGS)[number]>["config"]);
    expect(outcomeOf((REKEY.forced ?? [])[0] as ForcedError, ds, out.materialised)).toEqual({ outcome: "detected", evidence: ["VR-020"] });
  });
});
