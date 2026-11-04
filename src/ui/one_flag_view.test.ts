import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import type { ExperimentReport } from "../../engine/src/generated/experiment_report.schema";
import { readyOf } from "../../engine/src/experiments/assembly/lab/ready.ts";
import { labData } from "../../engine/tests/support/lab_data.ts";
import { en } from "../i18n/en.ts";
import { ko } from "../i18n/ko.ts";
import type { Key } from "../i18n/en.ts";
import type { Request, Response } from "../protocol.ts";
import { createWorker } from "../worker/worker.ts";
import { ErrorBlock } from "./ErrorBlock.tsx";
import { Figure } from "./Figure.tsx";
import { OneFlag, OneFlagAnswer } from "./OneFlag.tsx";
import { ResultBlock } from "./ResultBlock.tsx";
import { Detection } from "./Results.tsx";
import { RunStatus } from "./RunStatus.tsx";
import { oneFlagLink, oneFlagRequest } from "./one_flag.ts";
import type { ReportRow } from "./results_view.ts";
import { initial, reduce } from "./state.ts";
import type { ReadyInfo, State } from "./state.ts";
import { T } from "./T.tsx";

// A3 (docs/design/lab_ui.md section 26): the card as elements, without a DOM. The texts are read in both languages; the card before a run, while it runs, with its answer and with a problem is
// walked; the answer is checked for what it holds (three questions, the two records in the order of the run spec, the rows of the report as they are) and for where it sits (every figure inside
// one result block, invariant 3). That a reader sees all of it, and that the page never asks for the run by itself, is the lab QA's `one_flag` (scripts/qa/qa_lab_oneflag.py).

interface VNode {
  type: unknown;
  props: Record<string, unknown>;
}
const isVNode = (x: unknown): x is VNode => typeof x === "object" && x !== null && "type" in x && "props" in x;
/** Every element of a tree once: the elements that fill the {placeholders} of a text, the output of a function component (T excepted) and, for a component that needs a hook and cannot be called, its children. */
const walk = (node: unknown, found: VNode[] = []): VNode[] => {
  if (Array.isArray(node)) node.forEach((n) => walk(n, found));
  else if (isVNode(node)) {
    found.push(node);
    if (node.props.parts !== undefined) walk(Object.values(node.props.parts as Record<string, unknown>), found);
    if (typeof node.type === "function" && node.type !== T) {
      try {
        walk((node.type as (props: Record<string, unknown>) => unknown)(node.props), found);
        return found;
      } catch {
        // a component that needs the language context from a hook is not called: its children are walked instead
      }
    }
    walk(node.props.children, found);
  }
  return found;
};
const named = (nodes: VNode[], type: unknown): VNode[] => nodes.filter((n) => n.type === type);
const keysOf = (nodes: VNode[]): string[] => nodes.flatMap((n) => (n.type === T && typeof n.props.k === "string" ? [n.props.k] : []));

const READY = readyOf(labData()) as unknown as ReadyInfo;
const ORDER = ["c_context", "c_context_minus_two_clocks"];
const ID = 7;
const noop = (): void => undefined;

describe("the texts of the card, in both languages", () => {
  const keys = (Object.keys(en) as Key[]).filter((k) => k.startsWith("oneflag."));
  const ENGLISH_ORDERING = /\b(rank(s|ed|ing)?|best|better|worse|worst|win(s|ner|ning)?|outperform(s|ed)?|superior|inferior|leaderboard|beats?|ahead|higher|lower|more|less|fewer|greater|larger|smaller|most|least)\b/i;
  const KOREAN_ORDERING = ["더 낫", "더 좋", "우수", "최고", "최악", "승자", "이긴", "앞선", "뛰어난", "우월", "열등", "우승", "순위", "더 높", "더 낮", "더 많", "더 적", "가장", "제일"];

  it("Given the keys of the card Then there are nine, each in both languages", () => {
    expect(keys).toHaveLength(9);
    for (const k of keys) expect([typeof en[k], typeof ko[k]], k).toEqual(["string", "string"]);
  });

  it("Given every text of the card Then it holds no digit in either language and no word that ranks or compares the records", () => {
    for (const k of keys) {
      expect(en[k], `en ${k}`).not.toMatch(/\d/);
      expect(ko[k], `ko ${k}`).not.toMatch(/\d/);
      expect(en[k], `en ${k}`).not.toMatch(ENGLISH_ORDERING);
      for (const w of KOREAN_ORDERING) expect(ko[k], `ko ${k}`).not.toContain(w);
    }
  });

  it("Given the title, the link and the lead Then they are as the brief and the design say, and the lead is one sentence", () => {
    expect([en["oneflag.heading"], ko["oneflag.heading"]]).toEqual(["What one stored timestamp changes", "저장한 시각 하나가 바꾸는 것"]);
    expect([en["oneflag.link"], ko["oneflag.link"]]).toEqual(["See all results for this run", "이 실행의 전체 결과 보기"]);
    for (const text of [en["oneflag.lead"], ko["oneflag.lead"]]) expect((text.match(/[.!?](\s|$)/g) ?? []).length).toBe(1);
  });

  it("Given a text of the card that mentions a feed Then the Korean says 피드 and none says 공급", () => {
    for (const k of keys) {
      if (/\bfeeds?\b/i.test(en[k])) expect(ko[k], k).toContain("피드");
      expect(ko[k], k).not.toContain("공급");
    }
  });

  it("Given the texts the card reuses from Results Then they exist, so the card adds no second wording of a metric, a status or the hold-time rule", () => {
    for (const k of ["setup.run.button", "setup.run.cancel", "results.hold_limit.lead", "results.hold_limit.cannot", "results.arch.preset", "results.arch.ablation", "results.interval.label", "results.fig.none", "results.meets.warn", "metric.alignment_error.context_mismatch", "metric.hold_limit.rejected", "metric.availability.available", "error.feed_in_gap"] as Key[])
      expect(en[k], k).toBeTypeOf("string");
  });
});

describe("the card before a run", () => {
  const card = (state: State, onRun = noop, onCancel = noop) => walk(OneFlag({ state, onRun, onCancel }));
  const ready: State = { ...initial, ready: READY };

  it("Given the page is ready Then the card is a section with its title, its sentence and a Run button that is on, and no answer", () => {
    const nodes = card(ready);
    expect(nodes[0]?.props.id).toBe("one-flag");
    expect(keysOf(nodes).slice(0, 3)).toEqual(["oneflag.heading", "oneflag.lead", "setup.run.button"]);
    const button = nodes.find((n) => n.props.id === "one-flag-run") as VNode;
    expect(button.type).toBe("button");
    expect(button.props.disabled).toBe(false);
    expect(named(nodes, ResultBlock)).toHaveLength(0);
    expect(named(nodes, RunStatus)).toHaveLength(0);
    expect(named(nodes, ErrorBlock)).toHaveLength(0);
  });

  it("Given a press of Run Then it asks the page once, and building the card asks for nothing", () => {
    let asked = 0;
    const nodes = card(ready, () => (asked += 1));
    expect(asked).toBe(0);
    (nodes.find((n) => n.props.id === "one-flag-run")?.props.onClick as () => void)();
    expect(asked).toBe(1);
  });

  it("Given the Worker has not answered ready yet, or the build offers no such ablation Then Run is off (there is no request to make)", () => {
    expect(card(initial).find((n) => n.props.id === "one-flag-run")?.props.disabled).toBe(true);
    const without: State = { ...ready, ready: { ...READY, presets: READY.presets.filter((p) => p.id !== ORDER[1]) } };
    expect(card(without).find((n) => n.props.id === "one-flag-run")?.props.disabled).toBe(true);
  });

  it("Given a run in flight Then Run is off, the progress and a Cancel are shown, and Cancel asks the page to cancel", () => {
    let cancelled = 0;
    const running = reduce(reduce(ready, { type: "one_flag_started", id: ID }), { type: "progress", id: ID, done: 3, total: 20 });
    const nodes = card(running, noop, () => (cancelled += 1));
    expect(nodes.find((n) => n.props.id === "one-flag-run")?.props.disabled).toBe(true);
    const status = named(nodes, RunStatus)[0] as VNode;
    expect(status.props.progress).toEqual({ id: ID, done: 3, total: 20 });
    (status.props.onCancel as () => void)();
    expect(cancelled).toBe(1);
    expect(named(nodes, ResultBlock)).toHaveLength(0);
  });

  it("Given a cancelled run Then the card shows the problem with the heading of a cancel, and Run is on again", () => {
    const failed = reduce(reduce(ready, { type: "one_flag_started", id: ID }), { type: "error", id: ID, code: "cancelled", message: "the run was cancelled after 1 of 20 seeds" });
    const nodes = card(failed);
    expect(named(nodes, ErrorBlock).map((n) => (n.props.problem as { code: string }).code)).toEqual(["cancelled"]);
    expect(nodes.find((n) => n.props.id === "one-flag-run")?.props.disabled).toBe(false);
  });
});

describe("the answer (a run of two seeds through the real Worker; the seeds do not matter to the page)", () => {
  let state: State;
  let report: ExperimentReport;

  beforeAll(async () => {
    const request = oneFlagRequest(READY, ID) as Extract<Request, { type: "run" }>;
    const posted: Response[] = [];
    const w = createWorker((m) => posted.push(structuredClone(m)), { data: labData(), now: () => performance.now(), fetchReference: async () => undefined });
    state = reduce({ ...initial, ready: READY }, { type: "one_flag_started", id: ID });
    await w.onMessage({ ...request, spec: { ...request.spec, seeds: request.spec.seeds.slice(0, 2) } });
    for (const m of posted) state = reduce(state, m);
    report = state.oneFlag.result?.report as ExperimentReport;
  }, 60_000);

  const card = (s: State = state) => walk(OneFlag({ state: s, onRun: noop, onCancel: noop }));
  const questions = (nodes: VNode[]): VNode[] => nodes.filter((n) => n.props["data-question"] !== undefined);
  const rowsOf = (id: string): ReportRow[] => (report.architectures.find((b) => b.id === id) as { rows: ReportRow[] }).rows;

  it("Given the answer Then the card holds one result block, and the answer is that block with its facts, the range line and the three questions in order", () => {
    const nodes = card();
    const blocks = named(nodes, ResultBlock);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.props.footer).toBe(state.oneFlag.result?.footer);
    expect(keysOf(walk(OneFlagAnswer({ result: state.oneFlag.result as never, ready: READY, check: "identical" })))).toContain("results.interval.label");
    expect(questions(nodes).map((q) => q.props["data-question"])).toEqual(["mismatch", "detection", "cost"]);
  });

  it("Given every question Then both records stand side by side in the order of the run spec", () => {
    for (const q of questions(card())) {
      const columns = walk(q).filter((n) => n.props["data-architecture"] !== undefined);
      expect(columns.map((c) => c.props["data-architecture"]), String(q.props["data-question"])).toEqual(ORDER);
    }
  });

  it("Given the questions Then their figures are the rows of the report as they are, through Figure, and recall stands with precision and the false-alarm rate (spec section 8, rule 3)", () => {
    const [mismatch, detection, cost] = questions(card()) as [VNode, VNode, VNode];
    const figures = (q: VNode) => named(walk(q), Figure).map((f) => f.props.row as ReportRow);
    const expectRows = (q: VNode, metrics: string[]) => expect(figures(q)).toEqual(ORDER.flatMap((id) => metrics.map((m) => rowsOf(id).find((r) => r.metric === m))));
    expectRows(mismatch, ["alignment_error.context_mismatch"]);
    expectRows(cost, ["hold_limit.rejected", "availability.available"]);
    expectRows(detection, ["recall", "precision", "false_alarm", "realised"].map((f) => `detection.by_type.feed_in_gap.${f}`));
    for (const q of [mismatch, detection, cost]) for (const row of figures(q)) expect(rowsOf(ORDER[0] as string).concat(rowsOf(ORDER[1] as string)).some((r) => r === row), row.metric).toBe(true);
    expect(named(walk(detection), Detection).map((d) => (d.props.group as { type: string }).type)).toEqual(["feed_in_gap", "feed_in_gap"]);
    expect(named(walk(mismatch), Detection)).toHaveLength(0);
  });

  it("Given every figure Then it sits inside the one result block (invariant 3: a number outside a result block or a label is a defect), and none sits outside", () => {
    const nodes = card();
    const inside = named(walk((named(nodes, ResultBlock)[0] as VNode).props.children), Figure);
    expect(named(nodes, Figure)).toHaveLength(inside.length);
    expect(inside).toHaveLength(14); // one figure and one figure, four and four, two and two
  });

  it("Given the third question Then a note says it is the cost of the second clock, and the hold-time rule's lead with its inputs stands above its figures; the other questions have neither", () => {
    const [mismatch, detection, cost] = questions(card()) as [VNode, VNode, VNode];
    const notes = (q: VNode) => walk(q).filter((n) => n.props["data-note"] === "cost");
    expect(notes(cost).map((n) => n.props.k)).toEqual(["oneflag.cost.note"]);
    expect(notes(mismatch)).toHaveLength(0);
    expect(notes(detection)).toHaveLength(0);
    const lead = walk(cost).find((n) => n.props.k === "results.hold_limit.lead") as VNode;
    expect(Object.keys(lead.props.parts as object)).toEqual(["limit", "review"]);
    expect(walk(mismatch).some((n) => n.props.k === "results.hold_limit.lead")).toBe(false);
  });

  it("Given the record that cannot run the hold-time rule Then its column says so in the words of Results, and the other column does not", () => {
    const [, , cost] = questions(card()) as [VNode, VNode, VNode];
    const said = walk(cost).flatMap((n) => (n.props["data-note"] === "hold-limit-cannot" ? [true] : []));
    expect(said).toEqual([true]);
    const columns = walk(cost).filter((n) => n.props["data-architecture"] !== undefined);
    expect(walk(columns[1]).some((n) => n.props["data-note"] === "hold-limit-cannot")).toBe(true);
    expect(walk(columns[0]).some((n) => n.props["data-note"] === "hold-limit-cannot")).toBe(false);
  });

  it("Given a column head Then it is the id as a label, the role of the record and, for the ablation, the name of the flag", () => {
    const [mismatch] = questions(card()) as [VNode];
    const columns = walk(mismatch).filter((n) => n.props["data-architecture"] !== undefined);
    expect(columns.map((c) => keysOf(walk(c)).filter((k) => k.startsWith("results.arch.")))).toEqual([["results.arch.preset"], ["results.arch.ablation"]]);
    const flagNames = columns.map((c) => walk(c).filter((n) => typeof n.type === "function" && (n.type as { name?: string }).name === "FlagName").map((n) => n.props.flag));
    expect(flagNames).toEqual([[], ["two_clocks"]]);
  });

  it("Given the link Then it is the setup of this run, in the page's own words, after the answer", () => {
    const link = card().find((n) => n.props.id === "one-flag-setup") as VNode;
    expect(link.type).toBe("a");
    expect(link.props.href).toBe(oneFlagLink(READY));
    expect(keysOf(walk(link))).toEqual(["oneflag.link"]);
  });

  it("Given a run of fewer seeds than the minimum Then the note of the minimum is shown; given enough Then it is not", () => {
    expect(report.meets_min_seeds).toBe(false);
    expect(card().some((n) => n.props["data-note"] === "min-seeds")).toBe(true);
    const enough: State = { ...state, oneFlag: { ...state.oneFlag, result: { ...(state.oneFlag.result as NonNullable<typeof state.oneFlag.result>), report: { ...report, meets_min_seeds: true } } } };
    expect(card(enough).some((n) => n.props["data-note"] === "min-seeds")).toBe(false);
  });

  it("Given the check was pending when the result came Then the block shows the state the check has now", () => {
    const pending: State = { ...state, check: { ...state.check, state: "identical" } };
    const footer = { ...(state.oneFlag.result?.footer as NonNullable<typeof state.oneFlag.result>["footer"]), check: "pending" as const };
    const withFooter: State = { ...pending, oneFlag: { ...pending.oneFlag, result: { ...(state.oneFlag.result as NonNullable<typeof state.oneFlag.result>), footer } } };
    expect(named(card(withFooter), ResultBlock)[0]?.props.check).toBe("identical");
  });
});

describe("the page never asks for the card's run by itself", () => {
  /** The bodies of the calls of useEffect and useLayoutEffect in a source text (balanced parentheses). */
  const effects = (source: string): string[] => {
    const bodies: string[] = [];
    for (const m of source.matchAll(/use(?:Layout)?Effect\(/g)) {
      let depth = 1;
      let i = (m.index ?? 0) + m[0].length;
      const start = i;
      while (i < source.length && depth > 0) {
        if (source[i] === "(") depth += 1;
        if (source[i] === ")") depth -= 1;
        i += 1;
      }
      bodies.push(source.slice(start, i));
    }
    return bodies;
  };

  it("Given the source of the App Then no effect (what runs on load and on a change) mentions the card's run or its request, and the request is built in one place, the handler of the button", () => {
    const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
    expect(effects(source).length).toBeGreaterThan(3);
    for (const body of effects(source)) expect(body).not.toMatch(/oneFlag|one_flag|OneFlag/);
    expect(source.match(/oneFlagRequest\(/g)).toHaveLength(1);
    expect(source).toMatch(/const runOneFlag = \(\)[^]*?oneFlagRequest\(/);
  });
});
