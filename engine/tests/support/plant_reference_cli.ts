// The reference of the plant's browser check (docs/design/plant_ui.md section 5.7, item 3): node engine/tests/support/plant_reference_cli.ts <path of plant_reference.json to write>
// For every hand fixture under tests/fixtures/plant/ it runs the hand scenario H (the fixture's `hand` fields laid over the small default scenario, seed 1, the record halls the fixture names) by the lab's
// own path, under the engine's flag (ADR-0016), and writes the fixture's name, its actions, the spec the page needs to open it, the strict truth hash and the digest of the metric cells of each hall.
// `applyActions` and every other plant module are NOT used: the page, opened on the spec with the actions entered, must show these hashes (the check `plant_equal` of the QA), and because a seed gives the same
// bytes in Node and in every browser (ADR-0019) they are the same. It never writes a golden. The QA runs it into qa_out/plant/; nothing in package.json does.
// Run directly by Node (native type stripping), so it imports modules with explicit .ts extensions only.
import "./require_node_flags.ts"; // ADR-0016: exits 2 without the Node flags of the engine, before any engine module loads
import { parseArchitecture } from "../../src/record/architecture.ts";
import { labSeedOf } from "../../src/experiments/assembly/lab/seed_setup.ts";
import { scenarioConfig } from "../../src/experiments/assembly/lab/setup.ts";
import type { LabData } from "../../src/experiments/assembly/lab/setup.ts";
import { runSeed } from "../../src/experiments/assembly/run_seed.ts";
import { ENGINE_VERSION, canonicalJson, logHash, sha256Hex } from "../../src/trace.ts";
import { labData } from "./lab_data.ts";
import { writeText } from "./lab_files.ts";
import { listFiles, readJson } from "./paths.ts";
import { SMALL, patched, rawScenario } from "./scenarios.ts";
import type { Json } from "./schemas.ts";

const out = process.argv[2];
if (!out || out.startsWith("--")) {
  console.error("usage: node engine/tests/support/plant_reference_cli.ts <path of plant_reference.json to write>");
  process.exit(2);
}

/** The record halls the page opens a fixture on: the three presets. A fixture that switches a flag names a derived document among its own halls (`hand.architectures`). */
const HALLS = ["a_manual", "b_lims_lite", "c_context"];

interface Fixture {
  actions: unknown[];
  hand: { scenario_fields: Json; capture_path?: "manual_transcription" | "adapter_ingest"; architectures: (string | Json)[] };
}

const data = labData();

/** The run of a hand-written fixture by the lab's own path: the scenario fields typed by hand laid over the small default scenario, the capture path and the record halls as the fixture names them. */
const byHand = async (f: Fixture): Promise<{ truth: string; cells: Record<string, string> }> => {
  const handData: LabData = { ...data, scenarios: { ...data.scenarios, default: patched(rawScenario("default"), { fields: f.hand.scenario_fields }) } };
  const halls = f.hand.architectures.map((a) => parseArchitecture(typeof a === "string" ? readJson("scenarios", "architectures", `${a}.json`) : a));
  const spec = { schema_version: "1" as const, scenario: "default", settings: SMALL, architectures: HALLS, seeds: [1] };
  const config = scenarioConfig(handData, "default", SMALL, 1, f.hand.capture_path ? { capture_path: f.hand.capture_path } : {});
  const { run, input } = labSeedOf(handData, spec, config, halls);
  const result = runSeed(input);
  return {
    truth: await logHash(run.events),
    cells: Object.fromEntries(await Promise.all(result.cells.map(async (cell, i) => [(halls[i] as { id: string }).id, await sha256Hex(canonicalJson(cell))] as const))),
  };
};

const started = performance.now();
const fixtures = [];
for (const file of listFiles("tests", "fixtures", "plant").filter((name) => name.endsWith(".json"))) {
  const f = readJson<Fixture>("tests", "fixtures", "plant", file);
  const name = file.replace(/\.json$/, "");
  fixtures.push({ name, actions: f.actions, spec: { scenario: "default", settings: SMALL, seed: 1, architectures: HALLS }, ...(await byHand(f)) });
}
const reference = { schema_version: "1", engine_version: ENGINE_VERSION, node: { version: process.version, flags: process.execArgv }, fixtures };
writeText(out, `${canonicalJson(reference, 2)}\n`);
console.log(`plant reference for engine ${ENGINE_VERSION} on node ${process.version}: ${fixtures.length} fixtures (${fixtures.map((x) => x.name).join(", ")}); ${((performance.now() - started) / 1000).toFixed(1)} s`);
