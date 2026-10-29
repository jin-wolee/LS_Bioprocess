// Child-process entry for invariant I9: prints the log_hash of the default scenario for one seed.
// Run directly by Node (native type stripping), so it imports modules with explicit .ts extensions only.
import "./require_node_flags.ts"; // ADR-0016: exits 2 without the Node flags of the engine, before any engine module loads
import { runScenario } from "../../src/run.ts";
import { logHash } from "../../src/trace.ts";
import { configOf } from "./scenarios.ts";

const seed = Number(process.argv[2]);
console.log(await logHash(runScenario({ ...configOf("default"), seed }).events));
