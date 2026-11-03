// The reference of the plant's browser check (docs/design/plant_ui.md section 5.7, item 3): node engine/tests/support/plant_reference_cli.ts <path of plant_reference.json to write>
// For every hand fixture under tests/fixtures/plant/ it runs the hand scenario H (the fixture's `hand` fields laid over the small default scenario, seed 1, the record halls the fixture names) by the lab's
// own path, under the engine's flag (ADR-0016), and writes the fixture's name, its actions, the spec the page needs to open it, the strict truth hash and the digest of the metric cells of each hall.
// `applyActions` and every other plant module are NOT used: the page, opened on the spec with the actions entered, must show these hashes (the check `plant_equal` of the QA), and because a seed gives the same
// bytes in Node and in every browser (ADR-0019) they are the same. It never writes a golden. The QA runs it into qa_out/plant/; nothing in package.json does.
// P6c: the same file also holds `sweep`, an entry for each spec of tests/fixtures/plant/sweep/specs.json (docs/design/plant_ui.md section 10): the spec run by the lab's own path with no action, the strict
// truth hash and the digest of the cells of each hall, for the check `plant_sweep`.
// P7b: the same file also holds `breakout`, one entry for a break-out case (docs/design/plant_ui.md section 10): the case run by the Break-out screen's own path (`investigateBreakoutSeed`, through
// `screenRun`), with no plant module, as the strict truth hash and the digest of the cell of each record, for the check of P7c.
// Run directly by Node (native type stripping), so it imports modules with explicit .ts extensions only.
import "./require_node_flags.ts"; // ADR-0016: exits 2 without the Node flags of the engine, before any engine module loads
import { parseArchitecture } from "../../src/record/architecture.ts";
import { labSeedOf } from "../../src/experiments/assembly/lab/seed_setup.ts";
import type { RunSpec } from "../../src/experiments/assembly/lab/spec.ts";
import { scenarioConfig } from "../../src/experiments/assembly/lab/setup.ts";
import type { LabData } from "../../src/experiments/assembly/lab/setup.ts";
import { runSeed } from "../../src/experiments/assembly/run_seed.ts";
import { ENGINE_VERSION, canonicalJson, logHash, sha256Hex } from "../../src/trace.ts";
import { breakoutData } from "../lab/breakout_data.ts";
import { screenRun } from "./breakout_screen.ts";
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

/** A spec of the sweep: the run (without `seeds`, which the plant ignores) and the seed. The other fields of the file belong to the QA. */
interface SweepSpec {
  name: string;
  seed: number;
  run: Omit<RunSpec, "schema_version" | "seeds">;
}

/** The run of a spec of the sweep by the lab's own path, no action: the scenario laid out by `scenarioConfig` with the profile lists and the capture path, the halls as the files have them. */
const bySpec = async (s: SweepSpec): Promise<{ name: string; seed: number; truth: string; cells: Record<string, string> }> => {
  const halls = s.run.architectures.map((id) => parseArchitecture(readJson("scenarios", "architectures", `${id}.json`)));
  const spec: RunSpec = { schema_version: "1", ...s.run, seeds: [s.seed] };
  const extras = { ...(s.run.bay_profiles && { bay_profiles: s.run.bay_profiles }), ...(s.run.analyzer_profiles && { analyzer_profiles: s.run.analyzer_profiles }), ...(s.run.capture_path && { capture_path: s.run.capture_path }) };
  const { run, input } = labSeedOf(data, spec, scenarioConfig(data, s.run.scenario, s.run.settings, s.seed, extras), halls);
  const result = runSeed(input);
  return {
    name: s.name,
    seed: s.seed,
    truth: await logHash(run.events),
    cells: Object.fromEntries(await Promise.all(result.cells.map(async (cell, i) => [(halls[i] as { id: string }).id, await sha256Hex(canonicalJson(cell))] as const))),
  };
};

/** The case of the reference: the medium-lot case at the seed the lab's Break-out check uses, under the five records the Break-out form offers (A, B, C, and C without each of the two link flags). */
const BREAKOUT_CASES = [{
  case: "sc12_medium_lot", seed: 9013,
  architectures: ["a_manual", "b_lims_lite", "c_context", "c_context_minus_material_lot_links", "c_context_minus_equipment_links"],
}];

const started = performance.now();
const fixtures = [];
for (const file of listFiles("tests", "fixtures", "plant").filter((name) => name.endsWith(".json"))) {
  const f = readJson<Fixture>("tests", "fixtures", "plant", file);
  const name = file.replace(/\.json$/, "");
  fixtures.push({ name, actions: f.actions, spec: { scenario: "default", settings: SMALL, seed: 1, architectures: HALLS }, ...(await byHand(f)) });
}
const sweep = [];
for (const spec of readJson<{ specs: SweepSpec[] }>("tests", "fixtures", "plant", "sweep", "specs.json").specs) sweep.push(await bySpec(spec));
const breakout = [];
for (const c of BREAKOUT_CASES) {
  const run = await screenRun(breakoutData(), c.case, c.seed, c.architectures);
  breakout.push({ ...c, truth: run.truth, cells: run.cells });
}
const reference = { schema_version: "1", engine_version: ENGINE_VERSION, node: { version: process.version, flags: process.execArgv }, fixtures, sweep, breakout };
writeText(out, `${canonicalJson(reference, 2)}\n`);
console.log(`plant reference for engine ${ENGINE_VERSION} on node ${process.version}: ${fixtures.length} fixtures (${fixtures.map((x) => x.name).join(", ")}) and ${sweep.length} specs of the sweep and ${breakout.length} break-out case; ${((performance.now() - started) / 1000).toFixed(1)} s`);
