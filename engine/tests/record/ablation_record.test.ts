import { describe, expect, it } from "vitest";
import { CORE_FLAG_NAMES, FLAG_NAMES } from "../../src/record/architecture.ts";
import type { FlagName } from "../../src/record/architecture.ts";
import { recordAblations } from "../../src/record/ablation.ts";
import { record } from "../../src/record/recorder.ts";
import type { RecordedDataset } from "../../src/record/types.ts";
import { SENSORS, WITH_REPLAY, arch } from "../support/record_fixture.ts";

// S2a Step 1, ablations: C minus one flag, for each of the ten flags, recorded from one observable stream. The tables that differ
// from C's are typed by hand from the On and Off columns of spec section 5 (the replayed S1 result gives ingest_idempotency
// something to act on). A flag whose ablation changes nothing would be dead code in the recorder.

const input = { events: WITH_REPLAY, sensors: SENSORS };
const C = (): RecordedDataset => record(input, arch(...FLAG_NAMES));

const CORE = new Set<FlagName>(CORE_FLAG_NAMES);
const TABLES = ["sample", "run", "instrument_state", "result", "audit_event", "source_event", "validation_finding", "ingest_conflict", "batch", "process_event", "historian"] as const;
const differing = (a: RecordedDataset, b: RecordedDataset): string[] => TABLES.filter((t) => JSON.stringify(a[t]) !== JSON.stringify(b[t])).sort();

// hand-typed: which tables change when the flag goes off in C (alphabetical)
const EXPECTED: Record<FlagName, string[]> = {
  system_issued_id: ["sample"], // planned_at
  two_clocks: ["sample"], // sampled_at
  available_at: ["result"], // available_at
  instrument_state_snapshot: ["instrument_state", "run"], // the states and the link from the run
  append_only_versions: ["result"], // S2 is overwritten: three rows instead of four; the audit event of the rerun stays
  write_time_keys: ["sample"], // keys_fixed_at_write
  ingest_idempotency: ["result", "source_event", "validation_finding"], // the replay is counted twice, and no key or log is kept
  audit_trail: ["audit_event", "sample"], // operator_id and the history
  material_lot_links: [], // read only where lots exist (the break-out extension, ADR-0017): with no event no table changes
  equipment_links: [], // read only where equipment items exist (ADR-0020): the same
};

describe("recordAblations: C minus one flag, recorded", () => {
  const runs = recordAblations(input, arch(...FLAG_NAMES));

  it("Given C When ablated Then there are ten datasets, one per flag, each named after the config it came from", () => {
    expect(runs.map((r) => r.flag)).toEqual([...FLAG_NAMES]);
    expect(runs.map((r) => r.dataset.architecture.id)).toEqual(FLAG_NAMES.map((f) => `${arch(...FLAG_NAMES).id}_minus_${f}`));
  });

  it.each(FLAG_NAMES)("Given C minus %s Then exactly the documented tables differ from C", (flag) => {
    const run = runs.find((r) => r.flag === flag);
    expect(differing(C(), (run as NonNullable<typeof run>).dataset)).toEqual(EXPECTED[flag]);
  });

  it("Given the eight flags of ADR-0005 Then each changes at least one table when it is ablated (none is dead code)", () => {
    for (const r of runs.filter((x) => CORE.has(x.flag))) expect(differing(C(), r.dataset).length, r.flag).toBeGreaterThan(0);
  });

  it("Given the ninth and tenth flags Then ablating either changes no table: with no break-out event nothing reads them (ADR-0017, ADR-0020)", () => {
    for (const r of runs.filter((x) => !CORE.has(x.flag))) expect(differing(C(), r.dataset), r.flag).toEqual([]);
  });

  it("Given the ablations Then the input is not modified and C is recorded the same before and after them", () => {
    const before = JSON.stringify([WITH_REPLAY, C()]);
    recordAblations(input, arch(...FLAG_NAMES));
    expect(JSON.stringify([WITH_REPLAY, C()])).toBe(before);
  });
});
