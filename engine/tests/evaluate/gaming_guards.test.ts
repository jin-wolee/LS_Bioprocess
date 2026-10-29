import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseKey } from "../../src/evaluate/answer_key.ts";
import { RULES_OF, detection } from "../../src/evaluate/detection.ts";
import { evaluate } from "../../src/evaluate/evaluate.ts";
import type { Ratio } from "../../src/evaluate/ratio.ts";
import { truthFrom } from "../../src/evaluate/truth.ts";
import { keyFile } from "../../src/experiments/assembly/key_file.ts";
import { runSeed } from "../../src/experiments/assembly/run_seed.ts";
import type { Event } from "../../src/generated/event.schema";
import type { Metrics } from "../../src/generated/metrics.schema";
import { ERROR_TYPES } from "../../src/inject/types.ts";
import type { MaterialisedError } from "../../src/inject/types.ts";
import type { RecordedDataset } from "../../src/record/types.ts";
import { ROOT } from "../support/paths.ts";
import { CONFIG, WORLD, emptyDataset, seedInput } from "../support/eval_fixture.ts";
import { makeEvalAjv, validates } from "../support/eval_schemas.ts";

// S2b Step 3 and spec section 8, "Anti-gaming rules": each guard is a test. The hand world is that of eval_fixture.ts (four analysis requests,
// one of them a draw refused by the volume budget).

const out = runSeed(seedInput());
const N = 4;

const ratiosOf = (node: unknown, path = ""): [string, Ratio][] => {
  if (node && typeof node === "object" && "num" in node && "den" in node && "denominator" in node) return [[path, node as Ratio]];
  if (node && typeof node === "object" && !Array.isArray(node)) return Object.entries(node).flatMap(([k, v]) => ratiosOf(v, path === "" ? k : `${path}.${k}`));
  return [];
};

describe("Guard 1: every denominator is all analysis requests or the stated subset", () => {
  for (const cell of out.cells) {
    it(`${cell.architecture}: each ratio has a named denominator of the expected size`, () => {
      const ds = out.datasets[cell.architecture] as RecordedDataset;
      const found = ratiosOf(cell.metrics);
      expect(found.length).toBeGreaterThan(38); // 39 shares: the precision and the false-alarm rate of the lost rerun (an evidence detector) read "not applicable", not a share
      for (const [path, ratio] of found) {
        expect(ratio.denominator.length, path).toBeGreaterThan(10);
        const type = /^detection\.by_type\.(\w+)\.(recall|precision|false_alarm)$/.exec(path);
        if (path.startsWith("utilisation.per_staffed_window")) expect(ratio.den, path).toBe(36000); // 1 analyzer x 1 day x the 36000 s window
        else if (path.startsWith("utilisation.per_24h")) expect(ratio.den, path).toBe(86400);
        else if (path === "rerun_traceability") expect(ratio.den, path).toBe(1); // requests that had a rerun: S2
        else if (type) {
          const detail = (cell.metrics.detection.by_type as Record<string, { realised: number }>)[type[1] as string] as { realised: number };
          const flags = ds.validation_finding.filter((f) => f.action !== "no-op" && RULES_OF[type[1] as (typeof ERROR_TYPES)[number]].includes(f.rule)).length;
          expect(ratio.den, path).toBe(type[2] === "recall" ? detail.realised : type[2] === "precision" ? flags : N - detail.realised);
        } else expect(ratio.den, path).toBe(N);
      }
    });
  }
});

describe("Guard 2: skipped and rejected requests stay in the denominator", () => {
  it("Given the refused draw S4 Then it is one of the four requests of every metric and counts against holding, turnaround and availability", () => {
    for (const cell of out.cells) {
      expect(cell.n_requests).toBe(N);
      expect(cell.metrics.holding_time.started.den).toBe(N);
      expect(cell.metrics.turnaround.released.den).toBe(N);
      expect(cell.metrics.availability.available.den).toBe(N);
      expect(cell.metrics.holding_time.sla_exceedance.num).toBe(2); // S4 never started, S2 held 1000 s
    }
  });
  it("Given the result of S3 rejected by a rule Then S3 is no longer available or reconstructed, and the denominator is still four", () => {
    const ds = structuredClone({ ...(out.datasets.C as RecordedDataset), historian: { series: [], late: [] } });
    for (const x of ds.result) if (x.request_id === "S3") x.state = "rejected";
    const m = evaluate({ truth: WORLD, dataset: ds, not_evaluable: [], key_text: out.key_text, architecture: "C", config: CONFIG }).metrics;
    expect(m.availability.available).toMatchObject({ num: 0, den: N }); // C had 1 of 4 (S3)
    expect(m.exact_reconstruction).toMatchObject({ num: 1, den: N }); // C had 2 of 4 (S1, S3): S2 has no result since the review step rejects both attempts
    expect(m.misattribution.no_result).toMatchObject({ num: 3, den: N }); // S2, S3 and S4
  });
});

describe("Guard 3: no function returns a combined score", () => {
  it("Then a cell holds exactly the eleven separate metrics of spec section 8 and no key of the output names a score", () => {
    for (const cell of out.cells) {
      expect(Object.keys(cell.metrics).sort()).toEqual(
        ["alignment_error", "attributable", "availability", "detection", "exact_reconstruction", "holding_time", "misattribution", "phantom_effect", "rerun_traceability", "turnaround", "utilisation"],
      );
      const keys: string[] = [];
      const walk = (n: unknown): void => {
        if (!n || typeof n !== "object") return;
        for (const [k, v] of Object.entries(n)) {
          keys.push(k);
          walk(v);
        }
      };
      walk(cell);
      expect(keys.filter((k) => /score|composite|overall|index|rank|grade|total/i.test(k))).toEqual([]);
    }
  });
  it("Then no exported name of engine/src/evaluate mentions a score, composite or ranking", () => {
    const dir = join(ROOT, "engine", "src", "evaluate");
    const names = readdirSync(dir).flatMap((f) => [...readFileSync(join(dir, f), "utf8").matchAll(/export (?:const|function|interface|type) (\w+)/g)].map((m) => m[1] as string));
    expect(names.length).toBeGreaterThan(20);
    expect(names.filter((n) => /score|composite|overall|rank|best/i.test(n))).toEqual([]);
  });
});

describe("Guard 4: flagged-only samples never define the denominator of recall", () => {
  const drawn = (id: string): Event => ({ type: "sample_drawn", t: 100, sample_id: id, unit_id: "U1", batch_id: "B1", operator_id: "OP-1", volume_ul: 200, true_state: {} }) as unknown as Event;
  const truth = truthFrom(Array.from({ length: 10 }, (_, i) => drawn(`R${i + 1}`)), { visits: {}, deadlines: {}, operators: [], analyzers: [] });
  const key = (ids: string[]) =>
    parseKey(keyFile({ engine_version: "t", scenario_id: "g", seed: 1 }, { T: { materialised: ids.map((id): MaterialisedError => ({ type: "unit_rekey", sample_id: id, detail: {} })), not_modelled: [] } }), "T");
  const flags = (...ids: string[]): RecordedDataset => ({
    ...emptyDataset(),
    validation_finding: ids.map((id) => ({ rule: "VR-020", target: `sample:${id}`, severity: "error" as const, action: "hold" as const, status: "open" as const })),
  });
  const of = (ids: string[], flagged: string[]) => detection(truth, flags(...flagged), key(ids), []).by_type.unit_rekey;

  it("Given 3 realised errors and 5 flags (2 on errors, 3 on clean requests) Then recall is 2 of 3, precision 2 of 5 and false alarm 3 of 7", () => {
    const d = of(["R1", "R2", "R3"], ["R1", "R2", "R8", "R9", "R10"]);
    expect([d.recall.num, d.recall.den]).toEqual([2, 3]);
    expect([d.precision.num, d.precision.den]).toEqual([2, 5]);
    expect([d.false_alarm.num, d.false_alarm.den]).toEqual([3, 7]);
  });
  it("Given 3 realised errors and no flag at all Then recall is 0 of 3, not undefined: the error counts although nobody flagged it", () => {
    const d = of(["R1", "R2", "R3"], []);
    expect([d.recall.num, d.recall.den, d.recall.value]).toEqual([0, 3, 0]);
    expect(d.precision.value).toBeNull();
  });
  it("Given flags and no realised error Then recall has no denominator (null, never 1) and the false-alarm rate is flags over all requests", () => {
    const d = of([], ["R4", "R5"]);
    expect([d.recall.den, d.recall.value]).toEqual([0, null]);
    expect([d.false_alarm.num, d.false_alarm.den]).toEqual([2, 10]);
  });
  it("Given the same flags twice for one request (two rules of the type) Then a request is flagged once for recall and each flag counts for precision", () => {
    const ds = flags("R1");
    ds.validation_finding.push({ ...(ds.validation_finding[0] as RecordedDataset["validation_finding"][number]) });
    const d = detection(truth, ds, key(["R1", "R2"]), []).by_type.unit_rekey;
    expect([d.recall.num, d.recall.den, d.precision.num, d.precision.den]).toEqual([1, 2, 2, 2]);
  });
});

describe("Guard 5: the output carries the seed count and the spread, in the aggregate (see aggregate.test.ts) and the seed of each cell", () => {
  it("Then a cell names its scenario, seed and architecture", () => {
    expect(out.cells.map((c) => [c.scenario_id, c.seed, c.architecture])).toEqual([["hand", 7, "A"], ["hand", 7, "C"]]);
  });
});

describe("Guard 6: the metrics are computed from recorded datasets, the truth and the key, not from recorder internals", () => {
  it("Then no module of engine/src/evaluate imports the recorder or the result builder, only the as-of reads, the evidence checks, the types and the rule helper", () => {
    const dir = join(ROOT, "engine", "src", "evaluate");
    const imports = readdirSync(dir).flatMap((f) => [...readFileSync(join(dir, f), "utf8").matchAll(/from "(\.\.\/record\/[^"]+)"/g)].map((m) => m[1] as string));
    expect(imports.length).toBeGreaterThan(3);
    expect([...new Set(imports)].sort()).toEqual(["../record/asof.ts", "../record/evidence.ts", "../record/types.ts", "../record/validate.ts"]);
  });
  it("Then the evaluator runs on a dataset typed by hand that no recorder produced (the 10-request fixture of metrics.test.ts does the same)", () => {
    const m = evaluate({ truth: WORLD, dataset: emptyDataset(), not_evaluable: [], key_text: out.key_text, architecture: "A", config: CONFIG }).metrics;
    expect(m.misattribution.no_result).toMatchObject({ num: 4, den: 4 });
  });
});

describe("Guard 7: metrics.json is schema-validated", () => {
  const ajv = makeEvalAjv();
  it("Then every cell and the key file validate, and a cell with an extra score or a ratio without a denominator text does not", () => {
    for (const cell of out.cells) expect(validates(ajv, "metrics", cell), JSON.stringify(ajv.errors)).toBe(true);
    expect(validates(ajv, "answer_key", JSON.parse(out.key_text))).toBe(true);
    const bad = structuredClone(out.cells[0] as Metrics);
    (bad.metrics as unknown as Record<string, unknown>).score = 0.9;
    expect(validates(ajv, "metrics", bad)).toBe(false);
    const noText = structuredClone(out.cells[0] as Metrics);
    noText.metrics.exact_reconstruction.denominator = "";
    expect(validates(ajv, "metrics", noText)).toBe(false);
  });
});
