import { describe, expect, it } from "vitest";
import { batchOf, contextAsOf } from "../../src/record/asof.ts";
import { record } from "../../src/record/recorder.ts";
import type { ResultRow, SampleRow } from "../../src/record/types.ts";
import { SENSORS, STREAM, arch } from "../support/record_fixture.ts";

// S2a Step 1: the two time flags are independent (spec section 5, 00 section 3). Per cell of two_clocks x write_time_keys, typed by
// hand from spec section 5 and data_model sections 1 and 5: the time columns that are stored, whether the keys are fixed at write
// time, and the time the process-context join uses. The sample is S1: drawn at 1100, measured at 2000, with a feed at 1200 between
// the two, so the join time decides whether the feed is in the context (feed epoch 0 before it, 1 after it).
//
//   two_clocks   write_time_keys | stored time columns        keys fixed at write | join basis   feed epoch of S1
//   on           on              | sampled_at, measured_at    yes                 | sampled_at   0
//   on           off             | sampled_at, measured_at    no                  | sampled_at   0
//   off          on              | measured_at                yes                 | measured_at  1
//   off          off             | measured_at                no                  | measured_at  1

const CELLS = [
  { two_clocks: true, write_time_keys: true, stored: ["measured_at", "sampled_at"], fixed: true, basis: "sampled_at", join_time: 1100, epoch: 0, temperature: 37.1 },
  { two_clocks: true, write_time_keys: false, stored: ["measured_at", "sampled_at"], fixed: false, basis: "sampled_at", join_time: 1100, epoch: 0, temperature: 37.1 },
  { two_clocks: false, write_time_keys: true, stored: ["measured_at"], fixed: true, basis: "measured_at", join_time: 2000, epoch: 1, temperature: 37.2 },
  { two_clocks: false, write_time_keys: false, stored: ["measured_at"], fixed: false, basis: "measured_at", join_time: 2000, epoch: 1, temperature: 37.2 },
] as const;

type Cell = (typeof CELLS)[number];
const flagsOf = (c: Cell) => [...(c.two_clocks ? (["two_clocks"] as const) : []), ...(c.write_time_keys ? (["write_time_keys"] as const) : [])];

const TIME_COLUMNS = { sample: ["sampled_at", "planned_at"], result: ["measured_at", "available_at"] } as const;
const storedTimes = (sample: SampleRow, result: ResultRow): string[] =>
  [...TIME_COLUMNS.sample.filter((c) => sample[c] !== null), ...TIME_COLUMNS.result.filter((c) => result[c] !== null)].sort();

describe("the two time flags are independent: two_clocks x write_time_keys", () => {
  for (const cell of CELLS) {
    describe(`two_clocks ${cell.two_clocks ? "on" : "off"}, write_time_keys ${cell.write_time_keys ? "on" : "off"}`, () => {
      const ds = record({ events: STREAM, sensors: SENSORS }, arch(...flagsOf(cell)));
      const s1 = ds.sample[0] as SampleRow;
      const r1 = ds.result[0] as ResultRow;

      it(`Then the stored time columns are ${cell.stored.join(" and ")}`, () => {
        expect(storedTimes(s1, r1)).toEqual(cell.stored);
        expect(s1.sampled_at).toBe(cell.two_clocks ? 1100 : null);
        expect(r1.measured_at).toBe(2000);
      });

      it(`Then the keys are ${cell.fixed ? "" : "not "}fixed at write time: unit_id is stored either way, batch_id only when fixed, and the batch of S1 is B-U1 at read`, () => {
        expect(s1.keys_fixed_at_write).toBe(cell.fixed);
        expect([s1.sample_id, s1.unit_id, s1.batch_id]).toEqual(["S1", "U1", cell.fixed ? "B-U1" : null]);
        expect(batchOf(ds, r1)).toBe("B-U1"); // no harvest in this stream: the batch is open at both stored times
      });

      it(`Then the join basis is ${cell.basis} (${cell.join_time}), the feed epoch of S1 is ${cell.epoch} and the temperature read is ${cell.temperature}`, () => {
        const ctx = contextAsOf(ds, r1, 20000);
        expect(ctx).toMatchObject({ join_basis: cell.basis, join_time: cell.join_time, unit_id: "U1", batch_id: "B-U1", feed_epoch: cell.epoch, pv: { temperature: cell.temperature } });
      });
    });
  }

  it("The join basis follows two_clocks alone: flipping write_time_keys never changes it, flipping two_clocks always does", () => {
    const basis = (c: Cell): string | undefined => {
      const ds = record({ events: STREAM, sensors: SENSORS }, arch(...flagsOf(c)));
      return contextAsOf(ds, ds.result[0] as ResultRow, 20000)?.join_basis;
    };
    expect(CELLS.map(basis)).toEqual(["sampled_at", "sampled_at", "measured_at", "measured_at"]);
  });
});
