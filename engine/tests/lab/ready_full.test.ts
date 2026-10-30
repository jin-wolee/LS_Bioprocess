import { describe, expect, it } from "vitest";
import { readyOf } from "../../src/experiments/assembly/lab/ready.ts";
import { labData } from "../support/lab_data.ts";

// docs/design/lab_ui.md section 4 and spec section 4.5.6: the full `ready` payload. Expected values are typed by hand from the preset table of spec section 5, the evaluation
// file, the experiment config and the profile files (bundle ids A065 to A073); the lab function is not their source.

const FLAGS = ["system_issued_id", "two_clocks", "available_at", "instrument_state_snapshot", "append_only_versions", "write_time_keys", "ingest_idempotency", "audit_trail"];
const data = labData();
const ready = readyOf(data);

describe("ready: what the Setup page is built from", () => {
  it("Given the bundle Then the scenarios are the four of the Setup picker, in this order", () => {
    expect(ready.scenarios.map((s) => s.id)).toEqual(["default", "sc02_shift_burst", "sc03_feed_in_gap", "sc05_one_analyzer_down"]);
  });

  it("Given the experiment config and the evaluation file Then min_seeds is the A103 value and the seed list is the whole list of experiment 1 (30 neutral integers)", () => {
    expect(ready.min_seeds).toBe(20);
    expect(ready.seed_list).toHaveLength(30);
    expect(ready.seed_list.slice(0, 5)).toEqual([1009, 1103, 1259, 1381, 1511]);
    expect(ready.seed_list.at(-1)).toBe(4789);
  });

  it("Given the evaluation file Then the four inputs of the metrics are listed with their ledger ids", () => {
    expect(ready.evaluation).toEqual([
      { name: "sla_hold_threshold_min", value: 30, unit: "min", ref: "A097" },
      { name: "staffed_window_h", value: 10, unit: "h", ref: "A098" },
      { name: "hold_limit_min", value: 30, unit: "min", ref: "A046" },
      { name: "min_seeds", value: 20, unit: "seeds", ref: "A103" },
    ]);
  });

  it("Given a build with no challenge Then the variants offered are none (the page never assumes one exists)", () => {
    expect(ready.challenge_variants).toEqual([]);
  });

  it("Given the ready payload Then it is plain data: a JSON round trip changes nothing", () => {
    expect(JSON.parse(JSON.stringify(ready))).toEqual(ready);
  });
});

describe("ready: presets and the ablations of C", () => {
  it("Given A, B and C Then the list is the three presets and then C with each flag off, in flag order, the base taken from the data", () => {
    expect(ready.presets.map((p) => p.id)).toEqual(["a_manual", "b_lims_lite", "c_context", ...FLAGS.map((f) => `c_context_minus_${f}`)]);
    expect(ready.presets.map((p) => p.role)).toEqual(["preset", "preset", "preset", ...FLAGS.map(() => "ablation")]);
    expect(ready.presets.map((p) => p.ablated_flag)).toEqual([null, null, null, ...FLAGS]);
  });

  it("Given the preset table of spec section 5 Then A has no flag on, B has system_issued_id, ingest_idempotency and audit_trail on, C has all eight", () => {
    const on = (id: string): string[] => Object.entries(ready.presets.find((p) => p.id === id)?.flags ?? {}).filter(([, v]) => v).map(([k]) => k);
    expect(on("a_manual")).toEqual([]);
    expect(on("b_lims_lite")).toEqual(["system_issued_id", "ingest_idempotency", "audit_trail"]);
    expect(on("c_context")).toEqual(FLAGS);
  });

  it("Given the labelling and the capture path of the table Then A is handwritten on manual_transcription, B pre-printed and C issued at draw, both on adapter_ingest", () => {
    expect(ready.presets.slice(0, 3).map((p) => [p.labelling, p.capture_path])).toEqual([
      ["handwritten", "manual_transcription"],
      ["preprinted_barcode", "adapter_ingest"],
      ["issued_at_draw", "adapter_ingest"],
    ]);
  });

  it("Given an ablation Then its flags are C's with exactly the named flag off, and labelling and capture path are C's", () => {
    const c = ready.presets.find((p) => p.id === "c_context");
    for (const flag of FLAGS) {
      const ablation = ready.presets.find((p) => p.id === `c_context_minus_${flag}`);
      expect(ablation?.flags).toEqual({ ...c?.flags, [flag]: false });
      expect(ablation).toMatchObject({ labelling: c?.labelling, capture_path: c?.capture_path });
    }
  });

  it("Given the same presets in another order Then the ablations are still those of the preset with all flags on", () => {
    const [a, b, c] = data.architectures as [unknown, unknown, unknown];
    const reordered = readyOf({ ...data, architectures: [c, a, b] });
    expect(reordered.presets.filter((p) => p.role === "ablation").every((p) => p.id.startsWith("c_context_minus_"))).toBe(true);
    expect(readyOf({ ...data, architectures: [a, b] }).presets.map((p) => p.id)).toEqual(["a_manual", "b_lims_lite"]);
  });
});

describe("ready: the profile catalogue (spec section 4.5.6)", () => {
  const find = (kind: string, id: string) => ready.profiles.find((p) => p.kind === kind && p.id === id);

  it("Given the bundled profiles Then the catalogue lists bioreactor, analyzer and staff profiles by id with the bundle their file names", () => {
    expect(ready.profiles.map((p) => `${p.kind}/${p.id}/${p.bundle}`)).toEqual([
      "bioreactor/bench_manual/A067",
      "bioreactor/micro_mini_parallel/A065",
      "bioreactor/pilot/A068",
      "analyzer/allinone_atline/A069",
      "analyzer/hplc/A071",
      "analyzer/split_cellcounter_metabolite/A070",
      "staff/experienced/A072",
      "staff/trainee/A073",
    ]);
  });

  it("Given an analyzer profile Then it carries its stages with the analytes each measures (typed from the profile files)", () => {
    expect(find("analyzer", "allinone_atline")?.stages).toEqual([{ group: "AIO", analytes: ["vcd", "viability", "glucose", "lactate", "glutamine", "ph"] }]);
    expect(find("analyzer", "hplc")?.stages).toEqual([{ group: "HPLC", analytes: ["titer"] }]);
    expect(find("analyzer", "split_cellcounter_metabolite")?.stages).toEqual([
      { group: "CELL", analytes: ["vcd", "viability"] },
      { group: "CHEM", analytes: ["glucose", "lactate", "glutamine", "ph"] },
    ]);
  });

  it("Given a bioreactor or a staff profile Then it has no stages", () => {
    expect(find("bioreactor", "pilot")).not.toHaveProperty("stages");
    expect(find("staff", "trainee")).not.toHaveProperty("stages");
  });

  it("Given each scenario Then the profiles it names are in the catalogue", () => {
    for (const s of ready.scenarios) {
      for (const [kind, id] of Object.entries(s.profiles)) expect(find(kind, id), `${s.id}: ${kind}/${id}`).toBeDefined();
    }
  });
});
