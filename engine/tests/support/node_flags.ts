// The Node flags every process that runs engine code carries (ADR-0016: Node v25 miscompiles a hot loop of experiment 2 under Maglev escape analysis, which silently
// changes numbers). One list for the Vitest workers (vite.config.ts), the child processes that tests spawn and the check of the CLI scripts (require_node_flags.ts).
// Node refuses this flag in NODE_OPTIONS, so each process gets it on its own command line.
export const ENGINE_NODE_FLAGS: readonly string[] = ["--no-maglev-escape-analysis"];
