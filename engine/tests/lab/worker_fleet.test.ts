import { describe, expect, it } from "vitest";
import { scenarioConfig } from "../../src/experiments/assembly/lab/setup.ts";
import type { Profile } from "../../src/profiles.ts";
import type { Response } from "../../../src/protocol.ts";
import { createWorker } from "../../../src/worker/worker.ts";
import type { WorkerEnv } from "../../../src/worker/worker.ts";
import { labData, LAB_PROFILES } from "../support/lab_data.ts";
import { lookup } from "../support/scenarios.ts";

// U2 (docs/design/lab_ui.md section 4, rule 6): `fleet_check` through the Worker. It is answered at once with `fleet_checked`, the id echoed, and it runs nothing; a request that names no bundled scenario or
// analyzer profile is `invalid_spec`. The parity test is the point of the request: for every ordered pair of analyzer profiles of the catalogue, with M = 3 and the default bays (the author's report of
// 2026-11-04: analyzer 1 the default, analyzers 2 and 3 a pair) and for every list of two and of three, the answer is empty exactly when the engine loads the scenario, and the problems name the analyzers and
// the analytes that a hand count over the profile files gives, which are the ones the engine's message names.

const data = labData();
const setup = () => {
  const posted: Response[] = [];
  const env: WorkerEnv = { data, now: () => performance.now(), fetchReference: async () => undefined };
  const worker = createWorker((m) => posted.push(structuredClone(m)), env);
  const ask = async (message: unknown): Promise<Response[]> => {
    const n = posted.length;
    await worker.onMessage(message);
    return posted.slice(n);
  };
  return { posted, ask };
};

const ANALYZERS = LAB_PROFILES.filter(([kind]) => kind === "analyzer").map(([, id]) => id);
const DEFAULT = "allinone_atline";
const analytesOf = (id: string): string[] => [...new Set(((lookup("analyzer", id) as Profile).route ?? []).flatMap((s) => s.analytes.map((a) => a.id)))];

/** The engine's verdict: the scenario loads with this list (the real default scenario, 24 reactors in two bays, M as long as the list), or its message. */
const engine = (list: string[]): string | null => {
  try {
    scenarioConfig(data, "default", { analyzer_count: list.length }, 1, { analyzer_profiles: list });
    return null;
  } catch (e) {
    return (e as Error).message;
  }
};

/** A hand count, from the profile files only: the analyte shared by two profiles of the list, as [first analyzer, second analyzer, analyte], and the analytes of the menu that no profile measures. */
const byHand = (list: string[]): { shared: string[]; unmeasured: string[] } => {
  const seats = [...new Set(list)].map((id) => ({ id, analyzer: list.indexOf(id) + 1 }));
  const shared: string[] = [];
  seats.forEach((x, i) => {
    for (const y of seats.slice(i + 1)) for (const a of analytesOf(x.id)) if (analytesOf(y.id).includes(a)) shared.push(`${x.analyzer}|${y.analyzer}|${a}`);
  });
  const measured = new Set(seats.flatMap((x) => analytesOf(x.id)));
  return { shared: shared.sort(), unmeasured: analytesOf(DEFAULT).filter((a) => !measured.has(a)).sort() };
};

describe("fleet_check through the Worker", () => {
  it("Given a list Then the Worker answers with fleet_checked, the id echoed, and nothing else", async () => {
    const { ask } = setup();
    expect(await ask({ type: "fleet_check", id: 7, scenario: "default", analyzers: [DEFAULT, "hplc"] })).toEqual([{ type: "fleet_checked", id: 7, problems: [] }]);
    const out = await ask({ type: "fleet_check", id: 8, scenario: "default", analyzers: [DEFAULT, "split_cellcounter_metabolite"] });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: "fleet_checked", id: 8 });
  });

  it("Given requests Then each is answered in the order of asking with its own id, and an answer carries no truth, key or result", async () => {
    const { ask } = setup();
    const answers = [
      ...(await ask({ type: "fleet_check", id: 3, scenario: "default", analyzers: ["hplc", "hplc"] })),
      ...(await ask({ type: "fleet_check", id: 4, scenario: "default", analyzers: [DEFAULT] })),
    ];
    expect(answers.map((m) => (m.type === "fleet_checked" ? [m.id, m.problems.length] : null))).toEqual([[3, 6], [4, 0]]);
    expect(Object.keys(answers[0] as object).sort()).toEqual(["id", "problems", "type"]);
  });

  it.each([
    ["no numeric id", { type: "fleet_check", scenario: "default", analyzers: [DEFAULT] }, null, /needs a numeric id/],
    ["an unknown scenario", { type: "fleet_check", id: 2, scenario: "nope", analyzers: [DEFAULT] }, 2, /^unknown scenario "nope"/],
    ["an unknown profile", { type: "fleet_check", id: 2, scenario: "default", analyzers: [DEFAULT, "nope"] }, 2, /^analyzers\[1\] names "nope"/],
    ["analyzers that are no list", { type: "fleet_check", id: 2, scenario: "default", analyzers: "hplc" }, 2, /^analyzers must be a list$/],
  ])("Given %s Then it is invalid_spec with a message, and the Worker goes on", async (_label, request, id, message) => {
    const { ask } = setup();
    const [m] = await ask(request);
    expect(m).toMatchObject({ type: "error", id, code: "invalid_spec" });
    expect(m?.type === "error" ? m.message : "").toMatch(message);
    expect(await ask({ type: "fleet_check", id: 9, scenario: "default", analyzers: [DEFAULT] })).toEqual([{ type: "fleet_checked", id: 9, problems: [] }]);
  });
});

describe("fleet_check and the engine give one verdict", () => {
  const pairs = ANALYZERS.flatMap((p) => ANALYZERS.map((q) => [p, q]));
  const triples = ANALYZERS.flatMap((p) => pairs.map(([q, r]) => [p, q, r] as string[]));
  const lists: string[][] = [...pairs.map(([p, q]) => [DEFAULT, p as string, q as string]), ...pairs, ...triples];

  it("Given the catalogue Then it has the three analyzer profiles, so there are nine ordered pairs", () => {
    expect(ANALYZERS.sort()).toEqual(["allinone_atline", "hplc", "split_cellcounter_metabolite"]);
    expect(pairs).toHaveLength(9);
  });

  it.each(lists.map((l) => [l.join(" | "), l] as const))("Given the list %s Then the answer is empty exactly when the scenario loads, and it names what a hand count finds", async (_label, list) => {
    const { ask } = setup();
    const [m] = await ask({ type: "fleet_check", id: 1, scenario: "default", analyzers: list });
    if (m?.type !== "fleet_checked") throw new Error(`fleet_checked expected, got ${JSON.stringify(m)}`);
    const loads = engine(list) === null;
    expect(m.problems.length === 0).toBe(loads);
    const hand = byHand(list);
    expect(loads).toBe(hand.shared.length === 0 && hand.unmeasured.length === 0);
    expect(m.problems.flatMap((p) => (p.kind === "shared_analyte" ? [`${p.first.analyzer}|${p.second.analyzer}|${p.analyte}`] : [])).sort()).toEqual(hand.shared);
    expect(m.problems.flatMap((p) => (p.kind === "unmeasured" ? [p.analyte] : [])).sort()).toEqual(hand.unmeasured);
    // the engine's message names the first of them: the analyte, both analyzers and both profiles, or the first analyte nobody measures
    const refusal = engine(list);
    const first = m.problems[0];
    if (refusal !== null && first?.kind === "shared_analyte") {
      expect(refusal).toContain(`the analyte ${first.analyte} is measured by both ${first.first.profile} (analyzer ${first.first.analyzer}) and ${first.second.profile} (analyzer ${first.second.analyzer});`);
    } else if (refusal !== null && first?.kind === "unmeasured") {
      expect(refusal).toContain(`the analyte ${first.analyte} is requested`);
    }
  });
});
