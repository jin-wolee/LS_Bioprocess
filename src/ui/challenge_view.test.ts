import { describe, expect, it } from "vitest";
import { en } from "../i18n/en.ts";
import { ko } from "../i18n/ko.ts";
import { Challenge, UbiquitousNote } from "./Challenge.tsx";
import { defaultChallengeForm } from "./challenge_form.ts";
import { READY } from "./fixture.ts";
import { initial } from "./state.ts";
import type { State } from "./state.ts";

// The Challenge screen (lab_ui.md section 9): it says plainly that this is a game on the honour system and not a security boundary, in both languages, and it shows no reveal before the guess. Preact
// elements are plain objects, so a component with no hook of its own can be called and its output inspected without a DOM.

interface VNode {
  type: unknown;
  props: Record<string, unknown>;
}
const isVNode = (x: unknown): x is VNode => typeof x === "object" && x !== null && "type" in x && "props" in x;
const walk = (node: unknown, found: VNode[] = []): VNode[] => {
  if (Array.isArray(node)) node.forEach((n) => walk(n, found));
  else if (isVNode(node)) {
    found.push(node);
    walk(node.props.children, found);
  }
  return found;
};

const state: State = { ...initial, ready: READY };
const actions = { onStart: () => {}, onOpen: () => {}, onGuess: () => {}, onGiveUp: () => {}, onNew: () => {} };
const tree = Challenge({ ready: READY, state, form: defaultChallengeForm(READY), setForm: () => {}, actions });

describe("the honour-system sentence", () => {
  it("Given the English text Then it says a game on the honour system, not a security boundary, that the engine runs in the browser and that the seed is in the link", () => {
    const text = en["challenge.honour"];
    for (const part of ["honour system", "not a security boundary", "runs in your browser", "seed is in the link"]) expect(text).toContain(part);
  });

  it("Given the Korean text Then it exists and says the same without a number", () => {
    expect(ko["challenge.honour"]).toMatch(/명예/);
    expect(ko["challenge.honour"]).toMatch(/보안 경계/);
    expect(ko["challenge.honour"]).not.toMatch(/\d/);
  });

  it("Given the screen before any challenge Then the sentence is on it, as a notice, and no reveal is", () => {
    const keys = walk(tree).filter((n) => typeof n.type === "function" && "k" in n.props).map((n) => n.props.k);
    expect(keys).toContain("challenge.honour");
    expect(walk(tree).some((n) => "data-reveal" in n.props)).toBe(false);
  });
});

describe("the type on every sample (lab_ui.md section 9, the author's ruling of 2026-10-30)", () => {
  const sentences = (types: string[]) => walk(UbiquitousNote({ types })).filter((n) => typeof n.type === "function" && n.props.k === "challenge.ubiquitous");

  it("Given two types Then the record names each once, in the order given, as a sentence of the dictionary", () => {
    expect(sentences(["unattributable_record", "planned_vs_actual"]).map((n) => n.props["data-ubiquitous"])).toEqual(["unattributable_record", "planned_vs_actual"]);
  });

  it("Given none Then nothing is on the screen", () => {
    expect(UbiquitousNote({ types: [] })).toBeNull();
  });

  it("Given the English text Then it says that every sample carries the type and that a guess is not scored background for it, and the Korean text says the same without a number", () => {
    for (const part of ["Every sample", "{type}", "background"]) expect(en["challenge.ubiquitous"]).toContain(part);
    expect(ko["challenge.ubiquitous"]).toMatch(/모든 시료/);
    expect(ko["challenge.ubiquitous"]).toMatch(/배경/);
    expect(ko["challenge.ubiquitous"]).not.toMatch(/\d/);
  });
});
