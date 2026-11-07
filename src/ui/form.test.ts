import { describe, expect, it } from "vitest";
import { bayCount, defaultForm, fromQuery, growAnalyzers, rangeWarning, resizeList, specOf, toQuery, withCounts } from "./form.ts";
import type { Form } from "./form.ts";
import { READY } from "./fixture.ts";

// The Setup form (docs/design/lab_ui.md sections 3, 4 and 2): the lists follow N, the bay size and M, the form becomes a RunSpec, and the spec travels in a link that never holds a
// result. Pure functions, no DOM. Expected values are hand arithmetic: 24 reactors in bays of 12 are 2 bays; 25 reactors are 3 bays (the last bay is smaller).

const fresh = (): Form => defaultForm(READY, "default");
const ok = (form: Form) => {
  const out = specOf(form, READY);
  if (!out.ok) throw new Error(`the form was expected to give a spec: ${out.problems.join(", ")}`);
  return out.spec;
};

describe("bayCount: the reactors in bays, the last bay may be smaller (A001)", () => {
  it.each([[24, 12, 2], [25, 12, 3], [6, 6, 1], [13, 12, 2], [1, 12, 1]])("Given %i reactors in bays of %i Then %i bays", (n, size, bays) => {
    expect(bayCount(n, size)).toBe(bays);
  });
});

describe("resizeList: picks are kept by position, new positions take the default", () => {
  it("Given a longer list Then the first positions keep their picks and the new ones take the default", () => {
    expect(resizeList(["pilot", "bench_manual"], 4, "bench_manual")).toEqual(["pilot", "bench_manual", "bench_manual", "bench_manual"]);
  });

  it("Given a shorter list Then the first positions are kept and the rest dropped", () => {
    expect(resizeList(["a", "b", "c"], 2, "d")).toEqual(["a", "b"]);
  });

  it("Given the same length Then the list is unchanged", () => {
    expect(resizeList(["a", "b"], 2, "d")).toEqual(["a", "b"]);
  });
});

describe("defaultForm: the scenario's own sizes and profiles, A, B and C, the first seeds of the list", () => {
  it("Given the default scenario Then 24 reactors in bays of 12, 2 analyzers, one profile per position, A, B and C, no ablation, no capture path", () => {
    expect(fresh()).toEqual({
      scenario: "default",
      n: "24",
      baySize: "12",
      m: "2",
      bays: ["bench_manual", "bench_manual"],
      analyzers: ["allinone_atline", "allinone_atline"],
      archs: ["a_manual", "b_lims_lite", "c_context"],
      ablation: "",
      capture: "",
      seeds: READY.seed_list.slice(0, 20).join(", "),
      actions: [],
    });
  });

  it("Given another scenario Then its sizes and profiles are used and the choices that do not depend on it are kept", () => {
    const changed = { ...fresh(), archs: ["a_manual"], capture: "adapter_ingest" as const, seeds: "1, 2" };
    expect(defaultForm(READY, "small", changed)).toMatchObject({ scenario: "small", n: "6", baySize: "6", m: "1", bays: ["pilot"], analyzers: ["hplc"], archs: ["a_manual"], capture: "adapter_ingest", seeds: "1, 2" });
  });
});

describe("withCounts: both lists are rebuilt when N, the bay size or M change", () => {
  it("Given N raised from 24 to 36 in bays of 12 Then three bays: the picks of the first two are kept and the third is the default", () => {
    const form = { ...fresh(), bays: ["pilot", "bench_manual"] };
    expect(withCounts(form, READY, { n: "36" })).toMatchObject({ n: "36", bays: ["pilot", "bench_manual", "bench_manual"] });
  });

  it("Given the bay size raised to 24 Then one bay with the pick of the first", () => {
    expect(withCounts({ ...fresh(), bays: ["pilot", "bench_manual"] }, READY, { baySize: "24" }).bays).toEqual(["pilot"]);
  });

  it("Given M raised from 2 to 3 with the default on analyzer 2 Then the new analyzer 3 takes the profile of analyzer 2, which is also the default, and the picks of 1 and 2 are kept", () => {
    const form = { ...fresh(), analyzers: ["hplc", "allinone_atline"] };
    expect(withCounts(form, READY, { m: "3" }).analyzers).toEqual(["hplc", "allinone_atline", "allinone_atline"]);
  });

  it("Given M raised from 2 to 3 with a profile that is not the default on analyzer 2 Then the new analyzer takes that profile, not the default of the scenario", () => {
    const form = { ...fresh(), analyzers: ["allinone_atline", "hplc"] };
    expect(withCounts(form, READY, { m: "3" }).analyzers).toEqual(["allinone_atline", "hplc", "hplc"]);
  });

  it("Given M raised by two Then each new analyzer copies the one before it, so the profile of the last pick runs on to the end", () => {
    const form = { ...fresh(), analyzers: ["allinone_atline", "hplc"] };
    expect(withCounts(form, READY, { m: "5" }).analyzers).toEqual(["allinone_atline", "hplc", "hplc", "hplc", "hplc"]);
  });

  it("Given M lowered and raised again Then the picks that were cut are not remembered: the new positions copy the one before", () => {
    const three = { ...fresh(), m: "3", analyzers: ["allinone_atline", "hplc", "allinone_atline"] };
    const two = withCounts(three, READY, { m: "2" });
    expect(two.analyzers).toEqual(["allinone_atline", "hplc"]);
    expect(withCounts(two, READY, { m: "3" }).analyzers).toEqual(["allinone_atline", "hplc", "hplc"]);
  });

  it("Given the scenario default on every analyzer Then raising M gives the default on every analyzer, and the spec still has no list", () => {
    const form = withCounts(fresh(), READY, { m: "4" });
    expect(form.analyzers).toEqual(Array(4).fill("allinone_atline"));
    expect(ok(form)).not.toHaveProperty("analyzer_profiles");
  });

  it("Given growAnalyzers Then it copies the one before, takes the fallback only at position 1, and cuts without remembering", () => {
    expect(growAnalyzers([], 3, "d")).toEqual(["d", "d", "d"]);
    expect(growAnalyzers(["a"], 3, "d")).toEqual(["a", "a", "a"]);
    expect(growAnalyzers(["a", "b", "c"], 2, "d")).toEqual(["a", "b"]);
    expect(growAnalyzers(["a", "b"], 2, "d")).toEqual(["a", "b"]);
  });

  it("Given the bay size or N raised Then the new bays take the default of the scenario, not the bay before (the rule of the bays is unchanged)", () => {
    const form = { ...fresh(), bays: ["pilot", "pilot"] };
    expect(withCounts(form, READY, { n: "36" }).bays).toEqual(["pilot", "pilot", "bench_manual"]);
    expect(withCounts({ ...form, baySize: "6", n: "12" }, READY, { baySize: "4" }).bays).toEqual(["pilot", "pilot", "bench_manual"]);
  });

  it("Given a count that is not a whole number of one or more Then it is kept as typed and the lists are left alone", () => {
    for (const typed of ["", "abc", "0", "-2", "1.5"]) {
      const next = withCounts(fresh(), READY, { n: typed });
      expect([next.n, next.bays]).toEqual([typed, ["bench_manual", "bench_manual"]]);
    }
  });
});

describe("specOf: the form as a RunSpec", () => {
  it("Given the default form Then the spec names the scenario, A, B and C and the first 20 seeds, and no setting, list or capture path", () => {
    expect(ok(fresh())).toEqual({ schema_version: "1", scenario: "default", settings: {}, architectures: ["a_manual", "b_lims_lite", "c_context"], seeds: READY.seed_list.slice(0, 20) });
  });

  it("Given N, the bay size and M changed Then they are settings by the name the scenario gives them, and only the changed ones", () => {
    const form = withCounts({ ...fresh(), baySize: "6", m: "1" }, READY, { n: "6" });
    expect(ok(form).settings).toEqual({ reactor_count: 6, bay_size: 6, analyzer_count: 1 });
    expect(ok({ ...fresh(), n: "30" }).settings).toEqual({ reactor_count: 30 });
  });

  it("Given every position at the scenario default Then the lists are left out, even when they are as long as the scenario needs", () => {
    expect(ok(fresh())).not.toHaveProperty("bay_profiles");
    expect(ok(fresh())).not.toHaveProperty("analyzer_profiles");
  });

  it("Given one bay and one analyzer off the default Then the whole list of that kind is in the spec, in order", () => {
    const spec = ok({ ...fresh(), bays: ["bench_manual", "pilot"], analyzers: ["hplc", "allinone_atline"] });
    expect(spec.bay_profiles).toEqual(["bench_manual", "pilot"]);
    expect(spec.analyzer_profiles).toEqual(["hplc", "allinone_atline"]);
  });

  it("Given an ablation and a capture path Then the ablation follows the presets in the order of ready, and the capture path is named", () => {
    const spec = ok({ ...fresh(), ablation: "c_context_minus_audit_trail", capture: "adapter_ingest" });
    expect(spec.architectures).toEqual(["a_manual", "b_lims_lite", "c_context", "c_context_minus_audit_trail"]);
    expect(spec.capture_path).toBe("adapter_ingest");
  });

  it("Given only the ablation selected Then it alone is run", () => {
    expect(ok({ ...fresh(), archs: [], ablation: "c_context_minus_system_issued_id" }).architectures).toEqual(["c_context_minus_system_issued_id"]);
  });

  it.each([["1009, 1103 1259", [1009, 1103, 1259]], ["1009,1103\n1259", [1009, 1103, 1259]], ["  7  ", [7]]])("Given the seeds %j Then they are %j", (seeds, expected) => {
    expect(ok({ ...fresh(), seeds }).seeds).toEqual(expected);
  });

  it.each([
    ["seeds that are not whole numbers", { seeds: "1009, x" }, ["seeds"]],
    ["no seed at all", { seeds: " , " }, ["seeds"]],
    ["a decimal seed", { seeds: "1.5" }, ["seeds"]],
    ["no architecture", { archs: [] }, ["architectures"]],
    ["N as text", { n: "many" }, ["n"]],
    ["a bay size of zero", { baySize: "0" }, ["baySize"]],
    ["M missing", { m: "" }, ["m"]],
    ["two things wrong", { n: "x", seeds: "y" }, ["n", "seeds"]],
  ])("Given %s Then there is no spec and the problems are named", (_name, over, problems) => {
    const out = specOf({ ...fresh(), ...over }, READY);
    expect(out.ok).toBe(false);
    expect(!out.ok && out.problems).toEqual(problems);
  });
});

describe("the link: the spec in the hash, never a result", () => {
  it("Given the default form Then the link names the scenario, the architectures, the seeds, the schema and the engine version, and nothing else", () => {
    const query = new URLSearchParams(toQuery(fresh(), READY));
    expect([...query.keys()]).toEqual(["scenario", "arch", "seeds", "schema", "engine"]);
    expect(query.get("scenario")).toBe("default");
    expect(query.get("arch")).toBe("a_manual,b_lims_lite,c_context");
    expect(query.get("seeds")).toBe(READY.seed_list.slice(0, 20).join(","));
    expect(query.get("schema")).toBe("1");
    expect(query.get("engine")).toBe("9.9.9");
  });

  it("Given a changed form Then a link made from it gives the same form back", () => {
    const form: Form = { ...withCounts({ ...fresh(), baySize: "3", m: "3" }, READY, { n: "9" }), bays: ["pilot", "bench_manual", "pilot"], analyzers: ["hplc", "allinone_atline", "hplc"], archs: ["a_manual", "c_context"], ablation: "c_context_minus_audit_trail", capture: "manual_transcription", seeds: "1009, 1103" };
    const { form: back, engine } = fromQuery(toQuery(form, READY), READY);
    expect(back).toEqual({ ...form, seeds: "1009, 1103" });
    expect(engine).toBe("9.9.9");
  });

  it("Given a link with a key, a scenario or an architecture the page does not know Then it is ignored and the defaults stand", () => {
    const { form } = fromQuery("scenario=nope&arch=zzz,a_manual&answer_key=1&set.no_such=3&seeds=5&capture=fax", READY);
    expect(form).toMatchObject({ scenario: "default", archs: ["a_manual"], seeds: "5", capture: "", n: "24" });
  });

  it("Given a link made with another engine version Then the version it was made with is reported", () => {
    expect(fromQuery("engine=0.1.0", READY).engine).toBe("0.1.0");
    expect(fromQuery("", READY).engine).toBeNull();
  });

  it("Given a link that holds a result Then no field of the form comes from it (there is no result key)", () => {
    const query = toQuery(fresh(), READY);
    expect(query).not.toMatch(/result|report|median/);
  });
});

describe("rangeWarning: a typed value outside the ledger range of its id (00 section 2, item 8)", () => {
  it.each([[24, "A001", null], [5, "A001", null], [100, "A001", null], [4, "A001", [5, 100]], [101, "A001", [5, 100]], [7, "A022", [1, 6]], [19, "A103", [20, 200]]])(
    "Given the value %i for %s Then the range shown is %j",
    (value, id, range) => {
      expect(rangeWarning(id, value)).toEqual(range);
    },
  );

  it("Given an id the ledger view does not have, or one whose range is not numeric (A098), Then there is no warning", () => {
    expect(rangeWarning("X001", 5)).toBeNull();
    expect(rangeWarning("A098", 5)).toBeNull();
  });
});


describe("processing bounds", () => {
  it.each(["101", "1000000000", "9".repeat(400)])("rejects an unsafe count without growing lists: %s", (n) => {
    const form = withCounts(fresh(), READY, { n, m: n });
    expect(form.bays.length).toBeLessThanOrEqual(100);
    expect(form.analyzers.length).toBeLessThanOrEqual(100);
    expect(specOf(form, READY).ok).toBe(false);
  });
  it("accepts the count boundary", () => {
    const form = withCounts(fresh(), READY, { n: "100", baySize: "1", m: "100" });
    expect([form.bays.length, form.analyzers.length, specOf(form, READY).ok]).toEqual([100, 100, true]);
  });
});
