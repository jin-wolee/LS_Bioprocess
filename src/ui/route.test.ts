import { describe, expect, it } from "vitest";
import { SCREENS, hashOf, parseHash } from "./route.ts";

// Hash routes (lab_ui.md section 2): the path picks the screen, the query carries the shareable state. A few lines, no router.

describe("parseHash", () => {
  it.each([
    ["", "home", ""],
    ["#", "home", ""],
    ["#/", "home", ""],
    ["#/home", "home", ""],
    ["#/setup", "setup", ""],
    ["#/results", "results", ""],
    ["#/notes", "notes", ""],
    ["#/setup?scenario=default&seeds=1,2", "setup", "scenario=default&seeds=1,2"],
    ["#/setup?", "setup", ""],
  ])("Given %j Then the screen is %s and the query %j", (hash, screen, query) => {
    expect(parseHash(hash)).toEqual({ screen, query });
  });

  it.each(["#/nope", "#setup", "#/setup/extra", "#/SETUP", "#/__proto__", "#/constructor"])("Given %j, which names no screen, Then it is Home", (hash) => {
    expect(parseHash(hash).screen).toBe("home");
  });

  it("Given a query with a second question mark Then the first splits the path from the query", () => {
    expect(parseHash("#/setup?a=b?c")).toEqual({ screen: "setup", query: "a=b?c" });
  });
});

describe("hashOf", () => {
  it("Given a screen Then its hash, with the query when there is one", () => {
    expect(hashOf("results")).toBe("#/results");
    expect(hashOf("setup", "scenario=default")).toBe("#/setup?scenario=default");
  });

  it("Given every screen Then parsing its hash gives the screen back", () => {
    for (const screen of SCREENS) expect(parseHash(hashOf(screen)).screen).toBe(screen);
  });
});
