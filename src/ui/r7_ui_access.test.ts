import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { en } from "../i18n/en.ts";
import { ko } from "../i18n/ko.ts";
import { RunStatus } from "./RunStatus.tsx";
import { ProfileList } from "./SetupLists.tsx";

vi.mock("preact/hooks", async (original) => ({ ...(await original<typeof import("preact/hooks")>()), useContext: () => "en" }));
type Node = { type: unknown; props: Record<string, unknown> };
const walk = (value: unknown): Node[] => {
  if (Array.isArray(value)) return value.flatMap(walk);
  if (typeof value !== "object" || value === null || !("type" in value) || !("props" in value)) return [];
  const node = value as Node;
  return [node, ...walk(node.props.children)];
};
const app = () => readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

describe("accessible navigation", () => {
  it("provides a translated skip link, source link, page titles and route focus", () => {
    expect(app()).toContain('k="app.skip"');
    expect(app()).toContain('k="app.source"');
    expect(app()).toContain('document.title');
    expect(app()).toContain('focusRoute');
    for (const key of ["app.skip", "app.source"] as const) {
      expect(en).toHaveProperty(key);
      expect(ko).toHaveProperty(key);
    }
  });
});

describe("accessible progress", () => {
  it("names its progress bar and keeps a completion announcement in the page", () => {
    const nodes = walk(RunStatus({ progress: { id: 3, done: 1, total: 2 }, onCancel: () => {} }));
    expect(nodes.find((node) => node.type === "progress")?.props["aria-label"]).toBeTruthy();
    expect(app()).toContain('id="run-completion"');
    expect(app()).toContain('k="setup.run.complete"');
  });
});

describe("fleet select semantics", () => {
  it("connects only the invalid analyzer picks to their explanation", () => {
    const list = ProfileList({ kind: "analyzer", picks: ["a", "b"], profiles: [{ id: "a", kind: "analyzer", bundle: "A001" }, { id: "b", kind: "analyzer", bundle: "A001" }] as never, onPick: () => {}, invalidPositions: [2] } as never);
    const picks = walk(list).filter((node) => typeof node.type === "function" && (node.type as {name?: string}).name === "ProfileSelect");
    const rendered = picks.map((node) => walk((node.type as (props: never) => unknown)(node.props as never)).find((n) => n.type === "select"));
    expect(rendered[0]?.props["aria-invalid"]).not.toBe(true);
    expect(rendered[1]?.props["aria-invalid"]).toBe(true);
    expect(rendered[1]?.props["aria-describedby"]).toBe("fleet-problems");
  });
});

describe("worker failure on every route", () => {
  it("renders the worker problem after readiness outside Home and offers recovery guidance", () => {
    expect(app()).toContain('globalProblem(state, route.screen)');
    const error = readFileSync(new URL("./ErrorBlock.tsx", import.meta.url), "utf8");
    expect(error).toContain('k="error.worker.recovery"');
    expect(en).toHaveProperty("error.worker.recovery");
    expect(ko).toHaveProperty("error.worker.recovery");
  });
});

describe("neutral ledger range wording", () => {
  it("does not imply every range was established by a source", () => {
    expect(en["setup.range.note"]).toContain("ledger");
    expect(en["setup.range.note"]).not.toContain("sources cover");
    expect(ko["setup.range.note"]).not.toContain("출처가 다루는 범위");
  });
});

describe("route focus", () => {
  it("focuses a heading or the main landmark when the heading is not ready", async () => {
    const { focusRoute } = await import("./App.tsx");
    const heading = { setAttribute: vi.fn(), focus: vi.fn() };
    const main = { querySelector: vi.fn(() => heading), setAttribute: vi.fn(), focus: vi.fn() };
    focusRoute(main as unknown as HTMLElement);
    expect(heading.setAttribute).toHaveBeenCalledWith("tabindex", "-1");
    expect(heading.focus).toHaveBeenCalledOnce();
    main.querySelector.mockReturnValue(null as never);
    focusRoute(main as unknown as HTMLElement);
    expect(main.focus).toHaveBeenCalledOnce();
  });
});

describe("worker failure check indicator", () => {
  it("shows the error chip and banner for a startup timeout and a post-ready crash", async () => {
    const { CheckStatus } = await import("./CheckPanel.tsx");
    const { initial, reduce } = await import("./state.ts");
    const ready = {} as NonNullable<typeof initial.ready>;
    const cases = [reduce(initial, { type: "worker_timeout" }), reduce({ ...initial, ready }, { type: "worker_error", message: "stopped" })];
    for (const result of cases) {
      const nodes = walk(CheckStatus(result.check));
      expect(nodes.find((node) => node.props.id === "check-chip")?.props["data-check-state"]).toBe("error");
      expect(nodes.some((node) => node.props.k === "check.banner.error")).toBe(true);
    }
  });
});
