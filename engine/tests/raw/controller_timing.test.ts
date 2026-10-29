import { beforeAll, describe, expect, it } from "vitest";
import { runSeed } from "../../src/experiments/assembly/run_seed.ts";
import { parseArchitecture } from "../../src/record/architecture.ts";
import type { RecordedDataset } from "../../src/record/types.ts";
import { runScenario } from "../../src/run.ts";
import { readJson } from "../support/paths.ts";
import { rawConfigOf, rawInputOf } from "../support/raw_run.ts";

// Step 7, the controller cut (A217) and the timing of the capture-path contrast. A historian value reaches the manual path as an observable event at its own stamp, and no entry delay
// is modelled (spec 2.4.8), so a tick is ingested at its own stamp (data_model 5). On the adapter path the cut decides when a row arrives: per_row, each row reaches the host at its
// own stamp, so the adapter-side ingested_at equals the manual-side one for every historian key; daily, a file reaches the host at the end of its day. SC1 seed 1, B and C, the
// export schedule per_run so that only the controller cut differs. Instants are seconds of the scenario, day 0 a Monday; one day is 86400 s.

const preset = (name: string) => parseArchitecture(readJson("scenarios", "architectures", `${name}.json`));
const [B, C] = [preset("b_lims_lite"), preset("c_context")];
const DAY = 86400;

describe("SC1 seed 1, the layer on: the controller cut decides when a historian row arrives, the path does not", () => {
  const runs: Record<"manual" | "per_row" | "daily", Record<string, RecordedDataset | undefined>> = { manual: {}, per_row: {}, daily: {} };
  beforeAll(() => {
    for (const [name, over] of [
      ["manual", { capture_path: "manual_transcription" as const, controller_log_cut: "per_row" as const }],
      ["per_row", { capture_path: "adapter_ingest" as const, controller_log_cut: "per_row" as const }],
      ["daily", { capture_path: "adapter_ingest" as const, controller_log_cut: "daily" as const }],
    ] as const) {
      const config = rawConfigOf("default", { seed: 1 }, { ...over, export_schedule: "per_run" });
      runs[name] = runSeed(rawInputOf(runScenario(config), config, `sc1-${name}`, [B, C], 21)).datasets;
    }
  }, 600_000);

  /** The ingested_at of a tick on the manual side: a tick is ingested at its own stamp (data_model 5), the first at the inoculation. */
  const manualIngested = (ds: RecordedDataset | undefined, tag: string, ts: number): number | undefined => {
    const [unit, signal] = tag.split(".");
    const s = ds?.historian.series.find((x) => x.unit_id === unit && x.signal === signal);
    if (!s) return undefined;
    const j = (ts - s.t0_s) / s.cadence_s;
    return Number.isInteger(j) && j >= 0 && j < s.n ? s.t0_s + j * s.cadence_s : undefined;
  };

  it.each([[B.id, B], [C.id, C]] as const)("Given per_row When %s is recorded on each path Then adapter ingested_at equals manual ingested_at for every historian key", (_id, arch) => {
    const adapter = (runs.per_row[arch.id]?.historian.late ?? []).filter((r) => r.tag.endsWith(".PV"));
    expect(adapter.length).toBeGreaterThan(10_000);
    expect(runs.manual[arch.id]?.historian.series.length).toBe(72); // 24 units x 3 signals, all columnar as with the layer off
    for (const r of adapter) {
      const manual = manualIngested(runs.manual[arch.id], r.tag, r.ts);
      if (manual !== r.ingested_at) expect(manual, `${r.tag} at ${r.ts}`).toBe(r.ingested_at); // fails at the first key that differs
    }
  });
  it.each([[B.id, B], [C.id, C]] as const)("Given per_row Then every historian row of %s, set points included, was ingested at its own stamp", (_id, arch) => {
    const rows = runs.per_row[arch.id]?.historian.late ?? [];
    expect(rows.some((r) => r.tag.endsWith(".SP"))).toBe(true);
    expect(rows.filter((r) => r.ingested_at !== r.ts).length).toBe(0);
  });
  it.each([[B.id, B], [C.id, C]] as const)("Given daily Then every historian row of %s was ingested at the end of its day, (day + 1) x 86400 s, which is later than the manual side's own stamp", (_id, arch) => {
    const rows = runs.daily[arch.id]?.historian.late ?? [];
    expect(rows.length).toBeGreaterThan(10_000);
    expect(rows.filter((r) => r.ingested_at !== (Math.floor(r.ts / DAY) + 1) * DAY).length).toBe(0);
    expect(rows.every((r) => r.ingested_at > r.ts)).toBe(true);
  });
  it("Given the two cuts Then the same rows are logged: the cut changes when a row arrives, not which rows exist", () => {
    const keys = (id: string, cut: "per_row" | "daily") => (runs[cut][id]?.historian.late ?? []).map((r) => `${r.tag}|${r.ts}|${r.value}`).sort();
    expect(keys(C.id, "daily")).toEqual(keys(C.id, "per_row"));
  });
});
