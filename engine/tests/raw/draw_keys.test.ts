import { beforeAll, describe, expect, it } from "vitest";
import { anchorEpoch } from "../../src/calendar.ts";
import { physicalIds } from "../../src/experiments/assembly/physical_ids.ts";
import { rawPath } from "../../src/experiments/assembly/raw_path.ts";
import type { RawSetup } from "../../src/experiments/assembly/raw_path.ts";
import { runSeed } from "../../src/experiments/assembly/run_seed.ts";
import { transcribe } from "../../src/inject/entry.ts";
import { inject } from "../../src/inject/inject.ts";
import type { ForcedError } from "../../src/inject/types.ts";
import { observeEvents } from "../../src/observe.ts";
import type { CapturePath } from "../../src/raw/types.ts";
import { runScenario } from "../../src/run.ts";
import { BASE, byTime, inoculation, sampleWithRun } from "../support/cell_stream.ts";
import { CONFIGS } from "../support/cells.ts";
import { DIALECTS, rawConfigOf, rawInputOf } from "../support/raw_run.ts";
import { SMALL } from "../support/scenarios.ts";
import { keyErrors } from "../support/sc_run.ts";

// S2f F2: the raw draws are keyed by the physical sample, not by the label text (invariant 2: "a rerun or an added sample never changes another sample's draws"; spec section 5,
// "Capture path", rule 5: the opportunities do not depend on the architecture or the path). A label error moves a result to the neighbour's label; the draw must stay where it was.

const [A, B, C] = CONFIGS.slice(0, 3).map((c) => c.config) as [(typeof CONFIGS)[number]["config"], (typeof CONFIGS)[number]["config"], (typeof CONFIGS)[number]["config"]];
const PATHS: CapturePath[] = ["manual_transcription", "adapter_ingest"];

describe("S2f F2: a forced label error changes no draw (hand-built, two tubes on one analyzer)", () => {
  const clean = byTime([...BASE, inoculation("U1"), ...sampleWithRun("S1", "U1", 1100, 100, 4.2), ...sampleWithRun("S2", "U1", 1200, 100, 5.1)]);
  const wrong = inject({ seed: 9, architecture: { id: A.id, flags: A.flags }, events: clean, forced: [{ type: "label_error", sample_id: "S2", detail: { as_id: "S1" } }] });
  const setup: RawSetup = {
    dialects: DIALECTS, anchor_epoch_s: anchorEpoch("2030-01-07"), zone_offset_s: 0, default_dilution: 1, export_at: () => 5000, visits: [{ dialect: "allinone_csv", analytes: ["glucose"], run_s: 270 }],
  };
  const draws = (events: typeof clean, physical: ReturnType<typeof physicalIds>, path: CapturePath) => rawPath({ setup, seed: 9, architecture: A, path, events, received_at: {}, physical }).key.opportunities;

  it.each(PATHS)("Given S2 is written as S1 on %s Then the draws are those of the clean stream, ids and u values", (path) => {
    expect(draws(wrong.events, physicalIds(clean, wrong.events), path)).toEqual(draws(clean, physicalIds(clean, clean), path));
  });
  it("Given a test-only entry-error rate of 0.5 and seed 9, whose entry draw is 0.07 for S1 and 0.95 for S2 When S2 is written as S1 Then the slip stays with the tube: the result of S1 is typed 2.4 (4.2 with its digits swapped) and the result of S2 is typed 5.1, as without the label error", () => {
    const typed = (events: typeof clean, physical: ReturnType<typeof physicalIds>) =>
      transcribe({ seed: 9, events, physical, unit_text: { glucose: "g/L" }, ucum_of: { "g/L": "g/L" }, default_dilution: 1, rate: 0.5 }).events.flatMap((e) => (e.type === "result_measured" ? [[e.t, e.value]] : []));
    expect(typed(clean, physicalIds(clean, clean))).toEqual([[1500, 2.4], [1600, 5.1]]);
    expect(typed(wrong.events, physicalIds(clean, wrong.events))).toEqual([[1500, 2.4], [1600, 5.1]]);
  });
  it("Then the draws are keyed by the tubes: each row's overlap draw and each result's entry draw names S1 once and S2 once, never S1 twice", () => {
    const d = draws(wrong.events, physicalIds(clean, wrong.events), "manual_transcription");
    expect(d.filter((o) => o.purpose === "raw:RQ4").map((o) => o.id)).toEqual(["S1/1/1", "S2/1/1", "AN-1|allinone_csv|5000"]);
    expect(d.filter((o) => o.purpose === "error:result_entry").map((o) => o.id)).toEqual(["S1/glucose/1", "S2/glucose/1"]);
  });
});

describe("S2f F2: the draws of one seed are the same in A, B and C and on both paths, with and without label errors (SC1 small, seed 1)", () => {
  const keys: Record<string, string[]> = {};
  const labelErrors: Record<string, number> = {};
  const draws = (key_text: string): string[] => (JSON.parse(key_text) as { opportunities: unknown[] }).opportunities.map((o) => JSON.stringify(o)).sort();
  beforeAll(() => {
    const config = rawConfigOf("default", { seed: 1, settings: SMALL });
    const run = runScenario(config);
    // two label errors in the first tubes of the run: the label of the second draw reads the third, and the label of the fourth reads the fifth
    const ids = observeEvents(run.events).flatMap((e) => (e.type === "sample_drawn" ? [e.sample_id] : []));
    const forced: ForcedError[] = [{ type: "label_error", sample_id: ids[1] as string, detail: { as_id: ids[2] as string } }, { type: "label_error", sample_id: ids[3] as string, detail: { as_id: ids[4] as string } }];
    const input = rawInputOf(run, config, "default-raw-draws", [A, B, C], 8);
    for (const path of PATHS) {
      for (const [name, f] of [["with", forced], ["without", []]] as const) {
        const out = runSeed({ ...input, raw: { ...(input.raw as RawSetup), capture_path: path }, forced: f });
        for (const arch of [A, B, C]) {
          keys[`${arch.id}|${path}|${name}`] = draws(out.raw?.[arch.id]?.key_text ?? "{}");
          if (name === "with") labelErrors[arch.id] = keyErrors(out.key_text, arch.id).filter((e) => e.type === "label_error").length;
        }
      }
    }
  }, 240_000);

  it("Given the two forced label errors Then A realises both and B and C, which issue the id at the system, realise none", () => {
    expect(labelErrors).toEqual({ [A.id]: 2, [B.id]: 0, [C.id]: 0 });
  });
  it("Given the keys of A, B and C on both paths, with the forced errors and without Then every key holds the same draws (ids and u values)", () => {
    const first = keys[`${A.id}|manual_transcription|without`] as string[];
    expect(first.length).toBeGreaterThan(100);
    expect(Object.keys(keys).length).toBe(12);
    for (const [name, key] of Object.entries(keys)) expect(key, name).toEqual(first);
  });
});
