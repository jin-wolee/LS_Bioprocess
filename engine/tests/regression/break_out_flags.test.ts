import { beforeAll, describe, expect, it } from "vitest";
import { ablate } from "../../src/record/architecture.ts";
import type { Architecture } from "../../src/record/architecture.ts";
import type { RecordedDataset } from "../../src/record/types.ts";
import { C, OLD_ELEVEN, seedOneOf } from "../support/break_out_pin.ts";

// ADR-0017 and ADR-0020, spec 11.8.5 batch 1: "each new ablation equals C with no break-out event". The scenario here has no `breakout` block, so no lot and no equipment item
// exists and nothing reads the ninth or the tenth flag: the dataset and the metrics cell of C without either flag, and of A with either flag (or both) switched on alone, are
// those of C and of A, except the name and the flags of the architecture. Expected values are the equalities of the ADRs, not numbers read back from the code.

const A = OLD_ELEVEN[0] as Architecture;
const lone = (flags: Partial<Architecture["flags"]>): Architecture => ({ ...A, id: `a_manual_plus_${Object.keys(flags).join("_and_")}`, flags: { ...A.flags, ...flags } });
const ARCHS = [
  A, C,
  ablate(C, "material_lot_links"), ablate(C, "equipment_links"),
  lone({ material_lot_links: true }), lone({ equipment_links: true }), lone({ material_lot_links: true, equipment_links: true }),
];

/** A dataset with the name and the flags of its architecture set aside: everything else is a recorded value. */
const body = (ds: RecordedDataset | undefined) => ({ ...ds, architecture: { labelling: ds?.architecture.labelling } });

describe("The ninth and tenth flags with no break-out event", () => {
  let datasets: Record<string, RecordedDataset>;
  let cells: Record<string, unknown>;

  beforeAll(() => {
    const { out } = seedOneOf(ARCHS);
    datasets = out.datasets;
    cells = Object.fromEntries(out.cells.map((c) => [c.architecture, { ...c, architecture: "x" }]));
  }, 120_000);

  it.each(["material_lot_links", "equipment_links"] as const)("Given C minus %s When the small default scenario is recorded Then its dataset and its metrics cell equal C's, the name and the flags aside", (flag) => {
    const id = `c_context_minus_${flag}`;
    expect(datasets[id]?.architecture.flags[flag]).toBe(false);
    expect(body(datasets[id])).toEqual(body(datasets["c_context"]));
    expect(cells[id]).toEqual(cells["c_context"]);
  });

  it.each([
    ["the ninth flag alone", "a_manual_plus_material_lot_links"],
    ["the tenth flag alone", "a_manual_plus_equipment_links"],
    ["both new flags alone", "a_manual_plus_material_lot_links_and_equipment_links"],
  ])("Given A with %s on When it is recorded Then no recorded value changes: its dataset and its metrics cell equal A's (a lone new flag stores no row-creation stamp)", (_name, id) => {
    expect(body(datasets[id])).toEqual(body(datasets["a_manual"]));
    expect(cells[id]).toEqual(cells["a_manual"]);
  });
});
