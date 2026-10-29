// Child-process entry for invariant I9: prints the log_hash of the test workload of one seed.
// Run directly by Node (native type stripping), so it imports modules with explicit .ts extensions only.
import "./require_node_flags.ts"; // ADR-0016: exits 2 without the Node flags of the engine, before any engine module loads
import { runL3 } from "../../src/analysis.ts";
import { logHash } from "../../src/trace.ts";
import { makeWorkload } from "./workload.ts";

const seed = Number(process.argv[2]);
const out = runL3(makeWorkload(seed));
console.log(await logHash(out.events));
