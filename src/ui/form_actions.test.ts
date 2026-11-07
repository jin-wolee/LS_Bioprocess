import { describe, expect, it } from "vitest";
import type { PlantAction } from "../protocol.ts";
import { defaultForm, fromQuery, runRequest, specOf, toQuery } from "./form.ts";
import type { Form } from "./form.ts";
import { READY } from "./fixture.ts";

// P6b (docs/design/lab_ui.md section 22, items 7 and 8): the plant's unit and analyzer actions in the Setup form, in the Setup link (`actions=`, the JSON of the list) and in the `run` request. The page keeps
// the four kinds Results carries and nothing else; the list is the Worker's to check. Pure functions, no DOM. The expected strings and lists are typed by hand.

const FEED: PlantAction = { kind: "add_feed", at: 291600, unit_id: "U03" };
const DOWN: PlantAction = { kind: "analyzer_down", at: 291600, analyzer: "AN-1", from: 306000, length_min: 120 };
const LOT: PlantAction = { kind: "change_lot", at: 291600, analyzer: "AN-2", effective: 310800 };
const ALARM: PlantAction = { kind: "raise_alarm", at: 295200, unit_id: "U04" };
const MOVE: PlantAction = { kind: "move_draw", at: 291600, sample_id: "U03-D03-1", to: 297000 };
const FLAG: PlantAction = { kind: "set_flag", at: 291600, architecture: "c_context", flag: "audit_trail", on: false };
const PATH: PlantAction = { kind: "set_capture_path", at: 291600, path: "adapter_ingest" };
const LABEL: PlantAction = { kind: "set_labelling", at: 291600, method: "handwritten" };

const withActions = (actions: PlantAction[]): Form => ({ ...defaultForm(READY, "default"), actions });
const query = (form: Form): string => toQuery(form, READY);

describe("the form starts with no plant action", () => {
  it("Given a fresh form Then it holds none, its link has no actions key, and its run request has none (Setup opened without the plant is as before)", () => {
    const form = defaultForm(READY, "default");
    expect(form.actions).toEqual([]);
    expect(query(form)).not.toContain("actions=");
    const request = runRequest(form, READY, 5);
    expect(request).toEqual({ type: "run", id: 5, spec: { schema_version: "1", scenario: "default", settings: {}, architectures: ["a_manual", "b_lims_lite", "c_context"], seeds: READY.seed_list.slice(0, 20) } });
    expect(request).not.toHaveProperty("actions");
  });

  it("Given another scenario chosen Then the carried actions stay (whether they fit the run is the Worker's to say)", () => {
    expect(defaultForm(READY, "small", withActions([FEED])).actions).toEqual([FEED]);
  });
});

describe("the Setup link round trip", () => {
  const three = [FEED, DOWN, ALARM];
  const orders = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]].map((p) => p.map((i) => three[i] as PlantAction));

  it.each(orders.map((o, i) => [i + 1, o] as const))("Given three actions entered in order %i Then the link reads back the same list in the same order", (_n, entered) => {
    const back = fromQuery(query(withActions(entered)), READY).form;
    expect(back.actions).toEqual(entered);
  });

  it("Given the three actions Then the link holds the JSON of the list percent-encoded, between the capture path and the seeds, as typed", () => {
    const q = query(withActions([FEED]));
    expect(q).toContain("&arch=a_manual,b_lims_lite,c_context&actions=%5B%7B%22kind%22%3A%22add_feed%22,%22at%22%3A291600,%22unit_id%22%3A%22U03%22%7D%5D&seeds=");
  });

  it("Given the six orders of entry Then the run request holds the same actions in each, and the spec is one", () => {
    const requests = orders.map((o) => runRequest(fromQuery(query(withActions(o)), READY).form, READY, 9));
    for (const [i, r] of requests.entries()) expect(r, String(i)).toMatchObject({ type: "run", id: 9, actions: orders[i] });
    expect(new Set(requests.map((r) => JSON.stringify(r?.type === "run" ? r.spec : null))).size).toBe(1);
  });
});

describe("the filter: a draw and the lab settings never reach the form", () => {
  const all = [FEED, ALARM, MOVE, DOWN, LOT, FLAG, PATH, LABEL];
  const linked = (list: unknown): string => `scenario=default&actions=${encodeURIComponent(JSON.stringify(list))}&schema=1&engine=9.9.9`;

  it("Given a link that carries all eight kinds Then the form holds the four that name a unit or an analyzer, in the order of the link", () => {
    expect(fromQuery(linked(all), READY).form.actions).toEqual([FEED, ALARM, DOWN, LOT]);
  });

  it.each([MOVE, FLAG, PATH, LABEL])("Given a link that carries only $kind Then the form holds none and the request has no actions", (action) => {
    const form = fromQuery(linked([action]), READY).form;
    expect(form.actions).toEqual([]);
    expect(runRequest(form, READY, 3)).not.toHaveProperty("actions");
  });

  it("Given a value that is not a JSON list, or entries that are not actions Then none (a link is user input; the Worker checks what is left)", () => {
    expect(fromQuery("scenario=default&actions=nope", READY).form.actions).toEqual([]);
    expect(fromQuery(linked({ kind: "add_feed" }), READY).form.actions).toEqual([]);
    expect(fromQuery(linked([7, null, "feed", FEED]), READY).form.actions).toEqual([]);
  });
});

describe("the run request", () => {
  it("Given carried actions Then they are beside the spec and the spec is the spec of the form (RunSpec is unchanged)", () => {
    const form = withActions([FEED, DOWN]);
    const out = specOf(form, READY);
    expect(out.ok && runRequest(form, READY, 4)).toEqual({ type: "run", id: 4, spec: out.ok ? out.spec : null, actions: [FEED, DOWN] });
  });

  it("Given a form that is not a spec Then no request", () => {
    expect(runRequest({ ...defaultForm(READY, "default"), seeds: "x" }, READY, 4)).toBeNull();
  });
});
