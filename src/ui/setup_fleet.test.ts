import { describe, expect, it } from "vitest";
import { readyOf } from "../../engine/src/experiments/assembly/lab/ready.ts";
import { scenarioConfig } from "../../engine/src/experiments/assembly/lab/setup.ts";
import { labData, LAB_PROFILES } from "../../engine/tests/support/lab_data.ts";
import { en } from "../i18n/en.ts";
import { ko } from "../i18n/ko.ts";
import { piecesOf, T } from "./T.tsx";
import { template } from "../i18n/index.ts";
import type { Key, Lang } from "../i18n/index.ts";
import type { FleetProblem, Response } from "../protocol.ts";
import { createWorker } from "../worker/worker.ts";
import { fleetKey, fleetRequest, withCounts, defaultForm } from "./form.ts";
import type { Form } from "./form.ts";
import { READY } from "./fixture.ts";
import { Setup } from "./Setup.tsx";
import { FleetProblems } from "./SetupFleet.tsx";
import { initial, reduce } from "./state.ts";
import type { ReadyInfo, State } from "./state.ts";

// U2 (docs/design/lab_ui.md sections 3 and 4): Setup says in words which analyzers clash and on which analytes, in both languages, and Run is off exactly when the engine would refuse the list. The first half
// walks the elements with the words of both dictionaries (the sentences are typed here by hand); the second half goes through the real Worker and the real reducer, over every ordered pair of analyzer
// profiles of the bundled catalogue with M = 3 and the default bays, and compares what Setup does with whether the engine loads the scenario. Elements are walked without a DOM.

interface VNode {
  type: unknown;
  props: Record<string, unknown>;
}
const isVNode = (x: unknown): x is VNode => typeof x === "object" && x !== null && "type" in x && "props" in x;
/** Every element of a tree; a function component is called (and one that needs the language context from a hook is left as an element). */
const walk = (node: unknown, found: VNode[] = []): VNode[] => {
  if (Array.isArray(node)) node.forEach((n) => walk(n, found));
  else if (isVNode(node)) {
    found.push(node);
    walk(node.props.children, found);
    if (node.props.parts !== undefined) walk(Object.values(node.props.parts as Record<string, unknown>), found); // the elements that fill the {placeholders} of a T
    if (typeof node.type === "function" && node.type !== T) {
      try {
        walk((node.type as (props: Record<string, unknown>) => unknown)(node.props), found);
      } catch {
        // a component that needs the language context is not called
      }
    }
  }
  return found;
};
/** The text a reader gets from a tree in a language: the dictionary text of each T with its {placeholders} filled by the elements given for them. */
const textOf = (node: unknown, lang: Lang): string => {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map((n) => textOf(n, lang)).join("");
  const v = node as VNode;
  if (v.type === T) return textOf(piecesOf(template(lang, v.props.k as Key), v.props.params as Record<string, string> | undefined, v.props.parts as Record<string, never> | undefined), lang);
  if (typeof v.type === "function") return textOf((v.type as (props: Record<string, unknown>) => unknown)(v.props), lang);
  return textOf(v.props.children, lang);
};
const notesOf = (problems: FleetProblem[]): VNode[] => walk(FleetProblems({ problems })).filter((n) => "data-fleet-note" in n.props);

const six = ["vcd", "viability", "glucose", "lactate", "glutamine", "ph"];
const shared = (analyte: string, a: number, b: number): FleetProblem => ({ kind: "shared_analyte", analyte, first: { profile: "allinone_atline", analyzer: a }, second: { profile: "split_cellcounter_metabolite", analyzer: b } });

describe("the message under the analyzer list, in words", () => {
  const clash = six.map((a) => shared(a, 1, 2));

  it("Given six analytes shared by analyzers 1 and 2 Then English names the analyzers and the six analytes and says what to do", () => {
    const [note, ...rest] = notesOf(clash);
    expect(rest).toEqual([]);
    expect(textOf(note, "en")).toBe(
      "Analyzers 1 and 2 both measure vcd, viability, glucose, lactate, glutamine and ph. Each analyte can be measured by one kind of analyzer only: pick the same profile for both, or profiles that measure different analytes.",
    );
  });

  it("Given the same problems Then Korean names the same analyzers and analytes, with no particle that depends on a word that is typed in", () => {
    expect(textOf(notesOf(clash)[0], "ko")).toBe(
      "분석기 1번과 2번이 둘 다 측정하는 항목은 vcd, viability, glucose, lactate, glutamine 및 ph입니다. 한 분석 항목은 한 종류의 분석기만 측정할 수 있으니, 두 분석기에 같은 프로파일을 고르거나 측정 항목이 겹치지 않는 프로파일을 고르세요.",
    );
  });

  it("Given one analyte and two analytes Then the joining word is used only where there are two or more", () => {
    expect(textOf(notesOf([shared("vcd", 2, 3)])[0], "en")).toMatch(/^Analyzers 2 and 3 both measure vcd\. Each/);
    expect(textOf(notesOf([shared("vcd", 2, 3), shared("ph", 2, 3)])[0], "en")).toMatch(/^Analyzers 2 and 3 both measure vcd and ph\. Each/);
    expect(textOf(notesOf([shared("vcd", 2, 3), shared("ph", 2, 3)])[0], "ko")).toMatch(/^분석기 2번과 3번이 둘 다 측정하는 항목은 vcd 및 ph입니다\. /);
  });

  it("Given analytes that nobody measures Then the unmeasured case is worded the same way in both languages", () => {
    const problems: FleetProblem[] = six.map((analyte) => ({ kind: "unmeasured", analyte, menu: "allinone_atline" }));
    expect(textOf(notesOf(problems)[0], "en")).toBe("No analyzer measures vcd, viability, glucose, lactate, glutamine and ph, which this scenario asks for. Give at least one analyzer a profile that measures them.");
    expect(textOf(notesOf(problems)[0], "ko")).toBe("이 시나리오가 요구하는 항목 중 측정하는 분석기가 없는 것은 vcd, viability, glucose, lactate, glutamine 및 ph입니다. 이 항목들을 측정하는 프로파일을 분석기 하나 이상에 고르세요.");
  });

  it("Given a group name that two profiles share Then the group and the two analyzers are named in both languages", () => {
    const group: FleetProblem = { kind: "shared_group", group: "AIO", first: { profile: "x", analyzer: 1 }, second: { profile: "y", analyzer: 3 } };
    expect(textOf(notesOf([group])[0], "en")).toBe("Analyzers 1 and 3 use profiles that both name the group AIO. A group is the pool of one stage of one profile: pick the same profile for both, or profiles whose groups have different names.");
    expect(textOf(notesOf([group])[0], "ko")).toBe("분석기 1번과 3번의 프로파일이 둘 다 그룹 AIO의 이름을 씁니다. 그룹은 한 프로파일의 한 단계가 쓰는 풀이므로, 두 분석기에 같은 프로파일을 고르거나 그룹 이름이 서로 다른 프로파일을 고르세요.");
  });

  it("Given two pairs that clash Then each pair is a sentence of its own and names its own analyzers", () => {
    const notes = notesOf([shared("vcd", 1, 2), shared("ph", 1, 3)]);
    expect(notes.map((n) => n.props["data-fleet-analyzers"])).toEqual(["1 2", "1 3"]);
    expect(notes.map((n) => textOf(n, "en").slice(0, 38))).toEqual(["Analyzers 1 and 2 both measure vcd. Ea", "Analyzers 1 and 3 both measure ph. Eac"]);
  });

  it("Given a message Then the numbers of the analyzers and the analytes are labels, and no text of either dictionary holds a digit", () => {
    const labels = walk(notesOf(six.map((a) => shared(a, 1, 2)))[0]).filter((n) => n.type === "span" && n.props["data-label"] === true);
    expect(labels.length).toBeGreaterThanOrEqual(8); // two analyzers and six analytes
    for (const key of ["setup.fleet.heading", "setup.fleet.and", "setup.fleet.clash", "setup.fleet.group", "setup.fleet.unmeasured", "setup.fleet.run"] as const) {
      expect(en[key], key).not.toMatch(/\d/);
      expect(ko[key], key).not.toMatch(/\d/);
    }
  });

  it("Given no problem Then the container is still in the page (a live region that exists before it speaks), empty, and says nothing", () => {
    const root = FleetProblems({ problems: [] }) as unknown as VNode;
    expect(root.props.id).toBe("fleet-problems");
    expect(root.props.role).toBe("status");
    expect(root.props["aria-live"]).toBe("polite");
    expect(textOf(root, "en")).toBe("");
    expect(walk(root).some((n) => "data-fleet-block" in n.props)).toBe(false);
  });

  it("Given a problem Then the block names its heading in words (not colour alone) and lives inside the polite region", () => {
    const root = FleetProblems({ problems: [shared("vcd", 1, 2)] }) as unknown as VNode;
    expect(root.props.role).toBe("status");
    expect(textOf(root, "en")).toMatch(/^This list of analyzers cannot run/);
    expect(textOf(root, "ko")).toMatch(/^이 분석기 목록은 실행할 수 없습니다/);
  });
});

// ---- Setup, the real Worker and the engine ----

const data = labData();
const REAL = readyOf(data) as unknown as ReadyInfo;
const DEFAULT = "allinone_atline";
const CATALOGUE = LAB_PROFILES.filter(([kind]) => kind === "analyzer").map(([, id]) => id);

/** A Worker with a recording `post`: the answers to `fleet_check` as the page would receive them. */
const worker = () => {
  const posted: Response[] = [];
  const w = createWorker((m) => posted.push(structuredClone(m)), { data, now: () => performance.now(), fetchReference: async () => undefined });
  return async (request: unknown): Promise<Response[]> => {
    const n = posted.length;
    await w.onMessage(request);
    return posted.slice(n);
  };
};
const formOf = (analyzers: string[]): Form => ({ ...withCounts(defaultForm(REAL, "default"), REAL, { m: String(analyzers.length) }), analyzers });
/** The page as it is after the Worker has answered the check of this form. */
const settled = async (ask: (request: unknown) => Promise<Response[]>, f: Form, id = 2): Promise<State> => {
  let state: State = { ...initial, ready: REAL };
  state = reduce(state, { type: "fleet_asked", id, key: fleetKey(f) });
  for (const m of await ask(fleetRequest(f, id))) state = reduce(state, m);
  return state;
};
const render = (f: Form, state: State): VNode[] => walk(Setup({ ready: REAL, form: f, setForm: () => undefined, state, link: "", linkEngine: null, leftOut: [], onRun: () => undefined, onCancel: () => undefined }));
const run = (nodes: VNode[]): VNode => nodes.find((n) => n.props.id === "run") as VNode;
const engineRefusal = (list: string[]): string | null => {
  try {
    scenarioConfig(data, "default", { analyzer_count: list.length }, 1, { analyzer_profiles: list });
    return null;
  } catch (e) {
    return (e as Error).message;
  }
};

describe("Setup: Run is off exactly when the engine would refuse the list (M = 3, default bays, every ordered pair)", () => {
  const pairs = CATALOGUE.flatMap((p) => CATALOGUE.map((q) => [p, q] as const));

  it("Given the catalogue Then there are nine ordered pairs", () => {
    expect(pairs).toHaveLength(9);
  });

  it.each(pairs.map(([p, q]) => [`${DEFAULT} | ${p} | ${q}`, [DEFAULT, p, q]] as const))("Given analyzers %s Then Run is off exactly when the engine refuses, and the message names what the engine names", async (_label, list) => {
    const f = formOf([...list]);
    const state = await settled(worker(), f);
    const nodes = render(f, state);
    const refusal = engineRefusal([...list]);
    expect(run(nodes).props.disabled, "Run").toBe(refusal !== null);
    const notes = nodes.filter((n) => "data-fleet-note" in n.props);
    expect(notes.length > 0, "a message").toBe(refusal !== null);
    expect(nodes.some((n) => n.props.id === "run-blocked"), "the reason beside Run").toBe(refusal !== null);
    expect(run(nodes).props["aria-describedby"]).toBe(refusal !== null ? "run-blocked" : undefined);
    if (refusal !== null) {
      const named = /the analyte (\w+) is measured by both (\w+) \(analyzer (\d)\) and (\w+) \(analyzer (\d)\)/.exec(refusal);
      const unmeasured = /the analyte (\w+) is requested/.exec(refusal);
      const first = notes[0] as VNode;
      if (named) {
        expect(first.props["data-fleet-analyzers"]).toBe(`${named[3]} ${named[5]}`);
        for (const lang of ["en", "ko"] as const) expect(textOf(first, lang), lang).toContain(named[1] as string);
      } else {
        expect(unmeasured).not.toBeNull();
        expect(first.props["data-fleet-note"]).toBe("unmeasured");
        for (const lang of ["en", "ko"] as const) expect(textOf(first, lang), lang).toContain(unmeasured?.[1] as string);
      }
    }
  });

  it("Given the author's report: M = 3, analyzer 2 the split pair, analyzer 3 the all-in-one Then the message names analyzers 1 and 2 (the first appearance of each profile, as the engine does) and the six analytes, and Run is off", async () => {
    const list = [DEFAULT, "split_cellcounter_metabolite", DEFAULT];
    const f = formOf(list);
    const nodes = render(f, await settled(worker(), f));
    expect(run(nodes).props.disabled).toBe(true);
    expect(engineRefusal(list)).toContain("the analyte vcd is measured by both allinone_atline (analyzer 1) and split_cellcounter_metabolite (analyzer 2)");
    const [note] = nodes.filter((n) => "data-fleet-note" in n.props);
    expect(textOf(note, "en")).toMatch(/^Analyzers 1 and 2 both measure vcd, viability, glucose, lactate, glutamine and ph\./);
  });

  it("Given M raised from 2 to 3 on a list that was fine Then the new analyzer copies the one before it and Run stays on (the scenario default would have clashed)", async () => {
    const two = formOf([DEFAULT, "hplc"]);
    expect(run(render(two, await settled(worker(), two))).props.disabled).toBe(false);
    const three = withCounts(two, REAL, { m: "3" });
    expect(three.analyzers).toEqual([DEFAULT, "hplc", "hplc"]);
    expect(engineRefusal(three.analyzers)).toBeNull();
    expect(run(render(three, await settled(worker(), three, 3))).props.disabled).toBe(false);
    const split = formOf(["split_cellcounter_metabolite", "hplc"]);
    const splitThree = withCounts(split, REAL, { m: "3" });
    expect(splitThree.analyzers).toEqual(["split_cellcounter_metabolite", "hplc", "hplc"]);
    expect(run(render(splitThree, await settled(worker(), splitThree))).props.disabled).toBe(false);
    // the default of the scenario in the new place would have clashed with the split pair: that is the list the author ran into
    expect(engineRefusal(["split_cellcounter_metabolite", "hplc", DEFAULT])).not.toBeNull();
  });

  it("Given a check that has not answered for the picks on screen Then Run is off and no message is shown (nothing blinks for a check that answers in milliseconds)", () => {
    const f = formOf([DEFAULT, DEFAULT, DEFAULT]);
    const nodes = render(f, { ...initial, ready: REAL, fleet: { asked: { id: 2, key: fleetKey(f) }, verdict: null } });
    expect(run(nodes).props.disabled).toBe(true);
    expect(nodes.some((n) => "data-fleet-note" in n.props)).toBe(false);
    expect(nodes.some((n) => n.props.id === "run-blocked")).toBe(false);
  });

  it("Given the default form of the fixture ready, answered with no problem Then Run is on", () => {
    const f = defaultForm(READY, "default");
    const nodes = walk(Setup({ ready: READY, form: f, setForm: () => undefined, state: { ...initial, fleet: { asked: { id: 2, key: fleetKey(f) }, verdict: { key: fleetKey(f), problems: [] } } }, link: "", linkEngine: null, leftOut: [], onRun: () => undefined, onCancel: () => undefined }));
    expect(run(nodes).props.disabled).toBe(false);
  });
});
