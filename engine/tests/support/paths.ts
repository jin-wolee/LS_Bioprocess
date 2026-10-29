import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("../../..", import.meta.url));

export const readJson = <T = unknown>(...parts: string[]): T => JSON.parse(readFileSync(join(ROOT, ...parts), "utf8")) as T;

export const listFiles = (...parts: string[]): string[] => readdirSync(join(ROOT, ...parts)).sort();
