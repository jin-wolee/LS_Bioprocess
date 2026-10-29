import { describe, expect, it } from "vitest";
import { BANNER } from "../../src/raw/types.ts";
import { casesOf, fixtureFiles, flat, runCase, textOf } from "../support/raw_fixtures.ts";

// Step 5 and 6: every hand-made fixture starts with the banner line, and the parser reproduces the canonical records typed by hand in its sibling .expected.json.

const files = fixtureFiles();

describe("hand-made raw fixtures", () => {
  it("there is a clean file for each of the three analyzer dialects, and the variants of the quirk tests", () => {
    expect(files.filter((f) => f.name === "clean").map((f) => f.dialect).sort()).toEqual(["allinone_csv", "cds_table", "counter_csv"]);
    expect(files.length).toBeGreaterThanOrEqual(18);
  });

  it.each(files.map((f) => [`${f.dialect}/${f.name}`, f.dialect, f.name] as const))("%s: the first line is the banner (ADR-0014 R3) and 3 to 5 data lines follow the header", (_label, dialect, name) => {
    const lines = textOf(dialect, name).split("\n");
    expect(lines[0]).toBe(BANNER);
    expect(BANNER).toBe("synthetic, modeled on public documentation; not a real instrument file");
    const data = lines.slice(2).filter((l) => /^(U\d{2}-D\d{2}-\d|INJ-)/.test(l)); // the units row of a variant starts with a comma and is not a data line
    expect(data.length).toBeGreaterThanOrEqual(1);
    expect(data.length).toBeLessThanOrEqual(5);
  });

  for (const f of files) {
    for (const c of casesOf(f.dialect, f.name)) {
      it(`${f.dialect}/${f.name}: ${c.name}`, () => {
        const { last } = runCase(f.dialect, f.name, c);
        const want = c.expect as {
          records?: Record<string, unknown>[]; raw_records?: Record<string, unknown>[]; parse_errors?: Record<string, unknown>[];
          findings?: { rule: string; target: string }[]; conflicts?: number; file_state?: string; partial?: boolean;
        };
        if (want.records) {
          // a case marked partial types the first records only (the others are the same kind); every other case lists all of them
          if (want.partial) expect(last.records.length).toBeGreaterThanOrEqual(want.records.length);
          else expect(last.records.length).toBe(want.records.length);
          want.records.forEach((w, i) => expect(flat(last.records[i] as (typeof last.records)[number]), `record ${i}`).toMatchObject(w));
        }
        for (const w of want.raw_records ?? []) {
          const got = last.raw_records.find((r) => r.line_no === w.line);
          expect(got, `raw_record at line ${String(w.line)}`).toMatchObject({ state: w.state, rule_id: w.rule_id });
        }
        if (want.parse_errors) {
          expect(last.parse_errors.map((e) => ({ line: e.line_no, code: e.code, ...(e.column_role && { column_role: e.column_role }) }))).toEqual(want.parse_errors.map((e) => ({ line: e.line, code: e.code, ...(e.column_role !== undefined && { column_role: e.column_role }) })));
        }
        for (const w of want.findings ?? []) expect(last.findings.some((x) => x.rule === w.rule && x.target === w.target), `finding ${w.rule} ${w.target}`).toBe(true);
        if (want.conflicts !== undefined) expect(last.conflicts.length).toBe(want.conflicts);
        if (want.file_state) expect(last.raw_file.state).toBe(want.file_state);
      });
    }
  }
});
