// Imported first by every CLI script that Node runs directly (ADR-0016): a process started without the engine's Node flags exits 2 before any engine module loads.
// The flag cannot be set from inside (v8.setFlagsFromString after start-up has an undefined effect, per the Node documentation) and Node refuses it in NODE_OPTIONS.
import { ENGINE_NODE_FLAGS } from "./node_flags.ts";

const missing = ENGINE_NODE_FLAGS.filter((flag) => !process.execArgv.includes(flag));
if (missing.length > 0) {
  console.error(
    `refused: Node was started without ${missing.join(" ")} (ADR-0016: a V8 miscompile can silently change the numbers of the engine). Run: node ${ENGINE_NODE_FLAGS.join(" ")} <script> [arguments]`,
  );
  process.exit(2);
}
