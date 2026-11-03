// Canary for ADR-0016, for Node upgrades. No test and not check_all runs it; run it by hand:
//   node engine/tests/support/v8_canary.ts [runs per flag set = 160] [concurrency = 4]
// It runs the experiment 2 runner (the two-seed report of determinism_cli.ts) `runs` times in separate Node processes without the flag and `runs` times with the flags of node_flags.ts,
// `concurrency` processes at a time (the two sets interleaved), and prints per flag set how many distinct outputs there were and how many differ from the majority output.
// Exit 1 when the flagged set shows a differing output or a failed run (the flag no longer protects), else 0. When the unflagged set reads 0 differing over a run count stated in its
// output, on the Node line in use, the flag can be proposed for removal in a new ADR. It deliberately does not import require_node_flags.ts: it must be able to run without the flag.
// The parent loads no engine code; the child (`--child`) is this same file.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { ENGINE_NODE_FLAGS } from "./node_flags.ts";

const SELF = fileURLToPath(import.meta.url);
const SETS = [
  { label: "no flags", flags: [] as readonly string[] },
  { label: ENGINE_NODE_FLAGS.join(" "), flags: ENGINE_NODE_FLAGS },
];

// The same statements as the experiment2 branch of determinism_cli.ts, so the child is the process that was measured.
async function runChild(): Promise<void> {
  const { runClosedLoop } = await import("../../src/experiments/assembly/closed_loop.ts");
  const { buildClosedLoopReport } = await import("../../src/experiments/assembly/closed_loop_report.ts");
  const { canonicalJson } = await import("../../src/trace.ts");
  const { loadClosedLoop } = await import("./experiment2.ts");
  const { readJson } = await import("./paths.ts");
  const { input, head } = loadClosedLoop(readJson("data", "scenarios", "experiments", "experiment2.json"));
  console.log(canonicalJson(buildClosedLoopReport(runClosedLoop({ ...input, seeds: input.seeds.slice(0, 2) }), { ...head, min_seeds: 2 })));
}

// sha256 of the child's output, or null when the child failed
const runOnce = (flags: readonly string[]): Promise<string | null> =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [...flags, SELF, "--child"], { stdio: ["ignore", "pipe", "ignore"] });
    const sum = createHash("sha256");
    child.stdout.on("data", (chunk: Buffer) => sum.update(chunk));
    child.on("error", () => resolve(null));
    child.on("close", (code) => resolve(code === 0 ? sum.digest("hex") : null));
  });

function summarise(hashes: (string | null)[]): { runs: number; failed: number; distinct: number; differ: number; majority: string } {
  const ok = hashes.filter((h): h is string => h !== null);
  const counts = new Map<string, number>();
  for (const h of ok) counts.set(h, (counts.get(h) ?? 0) + 1);
  const [majority, top] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? ["none", 0];
  return { runs: hashes.length, failed: hashes.length - ok.length, distinct: counts.size, differ: ok.length - top, majority };
}

async function main(): Promise<number> {
  const runs = Number(process.argv[2] ?? 160);
  const concurrency = Number(process.argv[3] ?? 4);
  if (!Number.isInteger(runs) || runs < 1 || !Number.isInteger(concurrency) || concurrency < 1) {
    console.error("usage: node engine/tests/support/v8_canary.ts [runs per flag set = 160] [concurrency = 4]");
    return 2;
  }
  const hashes: (string | null)[][] = SETS.map(() => []);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < runs * SETS.length) {
      const i = next++;
      const set = i % SETS.length;
      (hashes[set] as (string | null)[]).push(await runOnce((SETS[set] as (typeof SETS)[number]).flags));
    }
  };
  const started = performance.now();
  await Promise.all(Array.from({ length: concurrency }, worker));
  console.log(`ADR-0016 canary: node ${process.version}, experiment 2 runner (two seeds), ${runs} runs per flag set, ${concurrency} processes at a time, ${((performance.now() - started) / 1000).toFixed(0)} s`);
  const sums = hashes.map(summarise);
  sums.forEach((s, i) => {
    console.log(`  flags: ${(SETS[i] as (typeof SETS)[number]).label.padEnd(30)} runs ${s.runs}  failed ${s.failed}  distinct outputs ${s.distinct}  differ from the majority ${s.differ}  majority ${s.majority.slice(0, 12)}`);
  });
  const [bare, flagged] = sums as [(typeof sums)[number], (typeof sums)[number]];
  console.log(`  majority output of the two sets is ${bare.majority === flagged.majority ? "the same" : "NOT the same"}`);
  return flagged.differ > 0 || flagged.failed > 0 ? 1 : 0;
}

if (process.argv[2] === "--child") await runChild();
else process.exitCode = await main();
