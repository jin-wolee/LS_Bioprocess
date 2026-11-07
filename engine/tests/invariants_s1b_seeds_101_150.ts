import { checkSeeds } from "./invariants_s1b_helper.ts";

const seeds = Array.from({ length: 50 }, (_, i) => i + 101);
process.stdout.write(JSON.stringify(checkSeeds(seeds)));
