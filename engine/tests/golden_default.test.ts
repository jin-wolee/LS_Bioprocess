import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runScenario } from "../src/run.ts";
import { canonicalJson, canonicalJsonl, ENGINE_VERSION, logHash } from "../src/trace.ts";
import { ROOT, listFiles } from "./support/paths.ts";
import { configOf } from "./support/scenarios.ts";

// Golden event logs of the default scenario (docs/prompts/11 Step 4, 00 section 2 item 9). The files in tests/golden/ were created once by a recorded command
// (docs/progress.md) and are read-only from then on: this test only reads them, compares and reports. It never writes or regenerates a file.
// The logs are `runScenario(...).events`; sensor ticks are in `sensors`, not in `events`, so they are not part of the files.

const SEEDS = [1, 2, 3] as const;
const dir = join(ROOT, "tests", "golden");
const NAMES = SEEDS.flatMap((s) => [`default_seed${s}.trace.jsonl`, `default_seed${s}.summary.json`]);
const read = (name: string): string => readFileSync(join(dir, name), "utf8");
const sha = (text: string): string => createHash("sha256").update(text).digest("hex");

/** The first line that differs, for a readable failure; the assertions themselves compare whole strings as booleans. */
const firstDifference = (a: string, b: string): string => {
  const x = a.split("\n");
  const y = b.split("\n");
  const i = x.findIndex((line, k) => line !== y[k]);
  return i < 0 ? `lengths ${x.length} and ${y.length}` : `line ${i + 1}: ${x[i]?.slice(0, 160)} | ${y[i]?.slice(0, 160)}`;
};

describe("Golden event logs of the default scenario: checksums", () => {
  const listed = read("CHECKSUMS.txt").trim().split("\n").map((l) => {
    const m = /^([0-9a-f]{64}) {2}(\S+)$/.exec(l);
    if (!m) throw new Error(`bad CHECKSUMS line: ${l}`);
    return [m[2] as string, m[1] as string] as const;
  });

  it("Given tests/golden When it is listed Then it holds CHECKSUMS.txt, the six files of seeds 1 to 3 and the parity folder, nothing else", () => {
    expect(listFiles("tests", "golden")).toEqual(["CHECKSUMS.txt", ...NAMES, "parity"].sort());
  });

  it("Given CHECKSUMS.txt Then it lists exactly the six files and every sha256 matches", () => {
    expect(listed.map(([f]) => f).sort()).toEqual([...NAMES].sort());
    for (const [f, sum] of listed) expect(sha(read(f)), f).toBe(sum);
  });
});

describe("Golden event logs of the default scenario: the engine reproduces them", () => {
  it.each(SEEDS)("Given seed %i and data/scenarios/default.json When the scenario runs Then the canonical log equals the golden file byte for byte", (seed) => {
    const actual = canonicalJsonl(runScenario({ ...configOf("default"), seed }).events);
    const golden = read(`default_seed${seed}.trace.jsonl`);
    expect(actual === golden, firstDifference(actual, golden)).toBe(true);
  });

  it.each(SEEDS)("Given seed %i When the scenario runs Then the summary file states its version, seed, event count, log_hash and the count per event type", async (seed) => {
    const events = runScenario({ ...configOf("default"), seed }).events;
    const counts: Record<string, number> = {};
    for (const e of events) counts[e.type] = (counts[e.type] ?? 0) + 1;
    const expected = canonicalJson({ schema_version: "1", engine_version: ENGINE_VERSION, seed, event_count: events.length, log_hash: await logHash(events), event_counts: counts }, 2) + "\n";
    const golden = read(`default_seed${seed}.summary.json`);
    expect(expected === golden, firstDifference(expected, golden)).toBe(true);
    expect(events[0]).toMatchObject({ type: "log_header", engine_version: ENGINE_VERSION, seed });
  });
});
