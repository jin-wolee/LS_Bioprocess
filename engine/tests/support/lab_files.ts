import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

// The one place where the lab's build script and its test write a file: a text file at a path given on the command line (reference.json) or inside a scratch folder of a test.
// Run directly by Node (native type stripping), so it imports with explicit extensions only.

/** Writes `text` at `path`, creating the folder; returns the absolute path. */
export const writeText = (path: string, text: string): string => {
  const file = resolve(path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
  return file;
};
