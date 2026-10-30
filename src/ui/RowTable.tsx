import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { Label, T } from "./T.tsx";
import type { Key } from "../i18n/index.ts";

// A table of the recorded rows of the challenge (lab_ui.md section 9, "What the reader can open"): a filter on one id, a page of rows at a time, a button to show more. A record of the default
// scenario holds thousands of result rows, and a page of that many rows is not usable; the reader filters, the table shows the first rows that match. Every identifier and count in it sits in
// the result block of the screen (invariant 3).

const PAGE = 100;

export interface Column<R> {
  head: string;
  cell: (row: R) => ComponentChildren;
}

export function RowTable<R>({ name, title, rows, columns, idOf, actions }: { name: string; title: Key; rows: readonly R[]; columns: Column<R>[]; idOf: (row: R) => string; actions?: (row: R) => ComponentChildren }) {
  const [filter, setFilter] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const wanted = filter.trim();
  const matching = wanted === "" ? rows : rows.filter((r) => idOf(r).includes(wanted));
  const shown = matching.slice(0, limit);
  return (
    <section class="rt" data-table={name} aria-labelledby={`rt-${name}`}>
      <T as="h4" k={title} id={`rt-${name}`} />
      {rows.length === 0 ? (
        <T as="p" k="challenge.record.none" />
      ) : (
        <>
          <div class="field">
            <T as="label" k="challenge.filter" for={`rt-filter-${name}`} />
            <input id={`rt-filter-${name}`} type="text" autocomplete="off" value={filter} onInput={(event) => { setFilter(event.currentTarget.value); setLimit(PAGE); }} />
            <T k="challenge.rows" class="rt-count" parts={{ shown: <Label>{shown.length}</Label>, total: <Label>{matching.length}</Label> }} />
          </div>
          <div class="rt-wrap" tabIndex={0}>
            <table class="rt-table">
              <thead>
                <tr>
                  {columns.map((c) => (
                    <th key={c.head} scope="col">
                      <code>{c.head}</code>
                    </th>
                  ))}
                  {actions && <th scope="col" />}
                </tr>
              </thead>
              <tbody>
                {shown.map((row, i) => (
                  <tr key={`${idOf(row)}-${i}`} data-row={idOf(row)}>
                    {columns.map((c) => (
                      <td key={c.head}>{c.cell(row)}</td>
                    ))}
                    {actions && <td class="rt-actions">{actions(row)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {matching.length > shown.length && (
            <button type="button" class="rt-more" onClick={() => setLimit(limit + PAGE)}>
              <T k="challenge.more" />
            </button>
          )}
        </>
      )}
    </section>
  );
}
