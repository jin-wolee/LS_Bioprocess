import { describe, expect, it } from "vitest";
import { initial, reduce } from "./state.ts";

describe("seed preflight ordering", () => {
  it("clears an old warning when edited and ignores a late answer", () => {
    const asked = reduce(initial, { type: "seed_asked", id: 7, key: "1009,1009" } as never);
    expect(asked).toBeDefined();
    const invalid = reduce(asked, { type: "seed_checked", id: 7, reason: "a seed is repeated" } as never);
    expect((invalid as unknown as { seedCheck: unknown }).seedCheck).toEqual({ asked: { id: 7, key: "1009,1009" }, verdict: { key: "1009,1009", reason: "a seed is repeated" } });
    const edited = reduce(invalid, { type: "seed_asked", id: 8, key: "1009,1103" } as never);
    expect((edited as unknown as { seedCheck: { verdict: unknown } }).seedCheck.verdict).toBeNull();
    expect(reduce(edited, { type: "seed_checked", id: 7, reason: "old" } as never)).toEqual(edited);
    const valid = reduce(edited, { type: "seed_checked", id: 8, reason: null } as never);
    expect((valid as unknown as { seedCheck: { verdict: unknown } }).seedCheck.verdict).toEqual({ key: "1009,1103", reason: null });
  });
});

describe("Setup seed warnings", () => {
  it("blocks a refused list, clears its warning on edit and waits for the new verdict", async () => {
    const { defaultForm, fleetKey } = await import("./form.ts");
    const { READY } = await import("./fixture.ts");
    const { Setup } = await import("./Setup.tsx");
    const form = { ...defaultForm(READY, "default"), seeds: "1009,1009" };
    const state = { ...initial, fleet: { asked: null, verdict: { key: fleetKey(form), problems: [] } }, seedCheck: { asked: { id: 4, key: form.seeds }, verdict: { key: form.seeds, reason: "a seed is repeated" } } };
    type Node = { type: unknown; props: Record<string, unknown> };
    const walk = (value: unknown): Node[] => {
      if (Array.isArray(value)) return value.flatMap(walk);
      if (typeof value !== "object" || value === null || !("type" in value) || !("props" in value)) return [];
      const node = value as Node;
      return [node, ...walk(node.props.children)];
    };
    const view = (input: typeof form) => walk(Setup({ ready: READY, form: input, setForm: () => {}, state, link: "", linkEngine: null, leftOut: [], onRun: () => {}, onCancel: () => {} }));
    const invalid = view(form);
    expect(invalid.find((node) => node.props.id === "run")?.props.disabled).toBe(true);
    expect(invalid.find((node) => typeof node.type === "function" && (node.type as { name?: string }).name === "Seeds")?.props.reason).toBe("a seed is repeated");
    const edited = view({ ...form, seeds: "1009,1103" });
    expect(edited.find((node) => node.props.id === "run")?.props.disabled).toBe(true);
    expect(edited.find((node) => typeof node.type === "function" && (node.type as { name?: string }).name === "Seeds")?.props.reason).toBeNull();
  });
});

it("clears the old seed refusal immediately on edit without hiding unrelated errors", () => {
  const seedProblem = { ...initial, problem: { id: 5, code: "invalid_spec" as const, message: "a seed is repeated" } };
  const updated = reduce(seedProblem, { type: "seed_edited" } as never);
  expect(updated).toBeDefined();
  expect(updated.problem).toBeNull();
  const unrelated = { ...initial, problem: { id: 5, code: "engine_error" as const, message: "unrelated" } };
  expect(reduce(unrelated, { type: "seed_edited" } as never).problem).toEqual(unrelated.problem);
});
