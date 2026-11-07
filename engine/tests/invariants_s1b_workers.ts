import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function runWorkers(commands: string[][], cwd: string, timeoutMs: number): Promise<string[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const workers = commands.map((args) => execFileAsync(process.execPath, args, {
    cwd, maxBuffer: 16 * 1024 * 1024, signal: controller.signal, killSignal: "SIGKILL",
  }).then(({ stdout }) => stdout));
  try {
    return await Promise.all(workers);
  } catch (error) {
    controller.abort();
    await Promise.allSettled(workers);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
