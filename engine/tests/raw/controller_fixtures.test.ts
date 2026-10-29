import { describe, expect, it } from "vitest";
import { BANNER } from "../../src/raw/types.ts";
import { readJson } from "../support/paths.ts";
import { isValid, makeAjv } from "../support/schemas.ts";
import type { Json } from "../support/schemas.ts";
import { controllerCases, controllerFixtureFiles, controllerText, flatAlarms, flatHistorian, flatPhases, runControllerCase } from "../support/controller_fixtures.ts";

// Step 7: every hand-made controller fixture starts with the banner line, and the parser reproduces the rows typed by hand in its sibling .expected.json. A case lists only
// the fields it asserts; the lists of rows must have the length of the case's list (a case that types the first rows only is marked partial).

const files = controllerFixtureFiles();

describe("hand-made controller fixtures", () => {
  it("there is a deadband, an alarm and a phase fixture for the first family, and a process, an alarm and a recipe-step fixture for the second", () => {
    expect(files.filter((f) => f.family === "ctrl_neutral").map((f) => f.name).sort()).toEqual(["alarm_ack", "alarm_illegal", "deadband", "phase_hold", "phase_illegal"]);
    expect(files.filter((f) => f.family === "ctrl_bench").map((f) => f.name).sort()).toEqual(["alarm", "process", "steps", "steps_illegal"]);
  });

  it.each(files.map((f) => [`${f.family}/${f.name}`, f.family, f.name] as const))("%s: the first line is the banner (ADR-0014 R3) and 3 to 5 data lines follow the header", (_label, family, name) => {
    const lines = controllerText(family, name).split("\n").filter((l) => l !== "");
    expect(lines[0]).toBe(BANNER);
    expect(BANNER).toBe("synthetic, modeled on public documentation; not a real instrument file");
    expect(lines.length - 2).toBeGreaterThanOrEqual(3);
    expect(lines.length - 2).toBeLessThanOrEqual(5);
  });

  it("Given the records the parser makes from the controller fixtures Then each validates against the canonical record schema (the envelope with raw_ref as file and line, and the payload; a field a family does not carry is null)", () => {
    const ajv = makeAjv();
    ajv.addSchema(readJson<Json>("schemas", "canonical_record.schema.json"));
    let n = 0;
    for (const f of files) {
      for (const c of controllerCases(f.family, f.name)) {
        const { last } = runControllerCase(f.family, f.name, c);
        for (const r of [...last.historian, ...last.alarms, ...last.phases]) {
          n += 1;
          expect(isValid(ajv, "canonical_record", r), `${f.family}/${f.name}: ${JSON.stringify(r)}`).toBe(true);
        }
      }
    }
    expect(n).toBeGreaterThan(30);
  });
  it("Given a canonical alarm record with no raw_ref, an unknown state of the record or a tag name with no role Then the schema refuses it", () => {
    const ajv = makeAjv();
    ajv.addSchema(readJson<Json>("schemas", "canonical_record.schema.json"));
    const c = controllerCases("ctrl_neutral", "deadband")[0] as ReturnType<typeof controllerCases>[number];
    const r = runControllerCase("ctrl_neutral", "deadband", c).last.historian[0] as unknown as Json;
    expect(isValid(ajv, "canonical_record", { ...r, envelope: { ...(r.envelope as Json), raw_ref: undefined } })).toBe(false);
    expect(isValid(ajv, "canonical_record", { ...r, state: "rejected" })).toBe(false);
    expect(isValid(ajv, "canonical_record", { ...r, payload: { ...(r.payload as Json), tag: "U01.agitation" } })).toBe(false);
  });

  for (const f of files) {
    for (const c of controllerCases(f.family, f.name)) {
      it(`${f.family}/${f.name}: ${c.name}`, () => {
        const { last } = runControllerCase(f.family, f.name, c);
        const want = c.expect as {
          historian?: Record<string, unknown>[]; alarms?: Record<string, unknown>[]; phases?: Record<string, unknown>[]; raw_records?: { line: number; state: string; rule_id: string | null }[];
          findings?: { rule: string; target: string; action: string }[];
        };
        for (const [rows, got] of [[want.historian, flatHistorian(last)], [want.alarms, flatAlarms(last)], [want.phases, flatPhases(last)]] as const) {
          if (!rows) continue;
          expect(got.length, "number of rows").toBe(rows.length);
          rows.forEach((w, i) => expect(got[i], `row ${i}`).toMatchObject(w));
        }
        for (const w of want.raw_records ?? []) expect(last.raw_records.find((r) => r.line_no === w.line), `raw_record at line ${w.line}`).toMatchObject({ state: w.state, rule_id: w.rule_id });
        if (want.findings) {
          const open = last.findings.filter((x) => x.action === "hold" || x.action === "quarantine");
          expect(open.map((x) => ({ rule: x.rule, target: x.target, action: x.action }))).toEqual(want.findings);
        }
      });
    }
  }
});
