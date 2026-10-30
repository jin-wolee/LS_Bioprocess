import type { ObservableEvent } from "../../src/observe.ts";
import type { Architecture } from "../../src/record/architecture.ts";
import { investigate, signalsOf } from "../../src/record/investigate/investigate.ts";
import type { Investigation, InvestigationConfig } from "../../src/record/investigate/investigate.ts";
import { record } from "../../src/record/recorder.ts";
import type { BreakoutInput, RecordedDataset } from "../../src/record/types.ts";
import { H } from "./breakout_streams.ts";
import { VALID_QUALIFICATIONS } from "./cell_stream.ts";
import { CONFIGS } from "./cells.ts";
import { REVIEW } from "./review_setup.ts";

// The set-up of the investigation tests (break-out batch 4, spec 11.8.5 row 4): the five configurations of the fixture tables, the decision settings of 11.8.4 and the readers that turn a
// recorded and investigated dataset into the names the tables use (a batch id, a lot id, a request id). Test-only values: d1 2 h and d2 4 h are test design choices (A176 gives none) and the
// assumed lag 12 h is the A139 default, all as 11.8.4 says. The expected values of the tests are typed from the fixture tables, never read off this module.

export const NAMES = { A: "A", B: "B", C: "C", "C-L": "C-material_lot_links", "C-E": "C-equipment_links" } as const;
export type Name = keyof typeof NAMES;
export const ALL = Object.keys(NAMES) as Name[];
export const config = (n: Name) => (CONFIGS.find((c) => c.name === NAMES[n]) as (typeof CONFIGS)[number]).config;

/** d1 and d2 of 11.8.4 (2 h and 4 h), the assumed lag 12 h, and the review of the S2 review step (the roster of A201 as test numbers). */
export const CFG: InvestigationConfig = { decision_delay_s: H(2), conclusion_delay_s: H(4), assumed_lag_s: H(12), review: REVIEW };

/** Recorded under any architecture, for the ablations of the flag table that the five names do not cover. */
export const recAs = (events: readonly ObservableEvent[], master: BreakoutInput, arch: Architecture): RecordedDataset =>
  record({ events, sensors: [], qualifications: VALID_QUALIFICATIONS, breakout: master }, arch);
export const rec = (events: readonly ObservableEvent[], master: BreakoutInput, n: Name): RecordedDataset => recAs(events, master, config(n));

/** The pipeline of the break-out path after recording: the signals come from the observable events, the rest from the recorded dataset. */
export const run = (events: readonly ObservableEvent[], master: BreakoutInput, n: Name, cfg: InvestigationConfig = CFG): Investigation =>
  investigate(rec(events, master, n), signalsOf(events), cfg);

const requestOf = (ds: RecordedDataset, result_id: string): string => (ds.result.find((r) => r.result_id === result_id) as { request_id: string }).request_id;

/** A target as the tables of 11.8.4 name it: `batch:B-U01`, `material_lot:SL-1`, `equipment:TL-1` or `result:U01-S2` (a result by its request, which is its sample). */
export const nameOf = (ds: RecordedDataset, kind: string, id: string): string => `${kind}:${kind === "result" ? requestOf(ds, id) : id}`;

/** The holds placed at an instant, by the target names of the tables, sorted. */
export const placedAt = (ds: RecordedDataset, t: number): string[] =>
  (ds.quality_hold ?? []).filter((h) => h.placed_at === t).map((h) => nameOf(ds, h.target_kind, h.target_id)).sort();

/** What a walk returns, by the target names of the tables, sorted. */
export const returned = (items: readonly { kind: string; id: string }[], ds: RecordedDataset): string[] => items.map((i) => nameOf(ds, i.kind, i.id)).sort();

/** The retro-flag versions (a result with a `hold_id`), as `request/version` strings, sorted. */
export const versions = (ds: RecordedDataset): string[] => ds.result.filter((r) => r.hold_id != null).map((r) => `${r.request_id}/v${r.version}`).sort();

/** `[` `]` of names for a sorted expectation. */
export const names = (...xs: string[]): string[] => [...xs].sort();
