import type { ObservableEvent } from "../observe.ts";
import { entryDraw, physicalOf } from "../raw/quirks.ts";
import type { PhysicalIds, RawOpportunity } from "../raw/quirks.ts";
import type { CaptureProvenance } from "../record/types.ts";

// The transcription step of manual_transcription (spec section 5, "Capture path", rules 3 to 5; prompts/20 Step 6): a person reads the instrument screen or printout and
// types the result. The typed value is the observable result after the entry-error opportunities have materialised; no emitter or adapter is involved. The opportunities
// (purpose `error:result_entry`) are drawn for every result row on both paths; only this path lets them materialise. A production run has no ledger rate for a typed value,
// a unit slip or a dilution slip (spec 2.4.8: A047 and A061 are labelling entries, A048 has no rate), so it materialises none and reports the class as not modelled; forced
// mode (fixtures) names the errors. Reads observable data only.

export interface EntryError {
  kind: "value" | "unit" | "dilution";
  request_id: string;
  analyte: string;
  /** Default 1. */
  attempt?: number;
  /** kind value: the number that was typed. */
  typed_value?: number;
  /** kind unit: the unit text that was typed (it must be a unit text of the entry form). */
  typed_unit?: string;
  /** kind dilution: the factor that was typed, or null when it was left out. */
  typed_dilution?: number | null;
}

export interface AppliedEntryError {
  request_id: string;
  analyte: string;
  kind: EntryError["kind"];
  intended: number | string | null;
  typed: number | string | null;
}

export interface TranscribeInput {
  seed: number;
  events: readonly ObservableEvent[];
  /** The physical sample of each result event (raw/quirks.ts): the entry draw is keyed by it, not by the label text the operator typed (S2f F2). */
  physical: PhysicalIds;
  /** The unit text the entry form shows by default per analyte, and the UCUM code of every unit text the form may carry (the dialect data, plain data from the assembly). */
  unit_text: Readonly<Record<string, string>>;
  ucum_of: Readonly<Record<string, string>>;
  /** The dilution factor of a run that applied none (A090, the default ratio); null when the method has none. */
  default_dilution: number | null;
  /** Test-only: a probability that a row is typed wrongly; absent in a production run (no ledger rate), which then materialises nothing. */
  rate?: number;
  forced?: readonly EntryError[];
}

export interface Transcribed {
  events: ObservableEvent[];
  /** Provenance by source event id (analyzer/request/attempt/visit/analyte). */
  provenance: Record<string, CaptureProvenance>;
  applied: AppliedEntryError[];
}

type Measured = Extract<ObservableEvent, { type: "result_measured" }>;

/** A wrong digit: the first two digits of the printed value swap places (5.1 is typed as 1.5, 12.5 as 21.5). A value with fewer than two digits is returned unchanged. */
export const transposeDigits = (value: number): number => {
  const chars = String(value).split("");
  const at = chars.map((c, i) => (c >= "0" && c <= "9" ? i : -1)).filter((i) => i >= 0);
  const [i, j] = at;
  if (i === undefined || j === undefined) return value;
  [chars[i], chars[j]] = [chars[j] as string, chars[i] as string];
  return Number(chars.join(""));
};

/** The entry-error draws of every result row, with no path and no rate: the same list on both capture paths (spec section 5, "Capture path", rule 5). */
export const entryOpportunities = (seed: number, events: readonly ObservableEvent[], physical: PhysicalIds): RawOpportunity[] =>
  events.flatMap((e) => (e.type === "result_measured" ? [entryDraw(seed, physicalOf(physical, e), e.analyte, e.attempt)] : []));

export const transcribe = (input: TranscribeInput): Transcribed => {
  const dilutions = new Map<string, number>();
  const operator = new Map<string, string>();
  for (const e of input.events) {
    if (e.type === "dilution_applied") dilutions.set(`${e.request_id}/${e.attempt}/${e.visit}`, e.dilution_factor);
    else if (e.type === "sample_drawn") operator.set(e.sample_id, e.operator_id);
  }
  const provenance: Record<string, CaptureProvenance> = {};
  const applied: AppliedEntryError[] = [];
  const events = input.events.map((e): ObservableEvent => {
    if (e.type !== "result_measured") return e;
    const m: Measured = e;
    const draw = entryDraw(input.seed, physicalOf(input.physical, m), m.analyte, m.attempt);
    const forced = (input.forced ?? []).find((f) => f.request_id === m.request_id && f.analyte === m.analyte && (f.attempt ?? 1) === m.attempt);
    // a drawn opportunity materialises, as a transposed digit pair, only where a rate exists (test-only); the content is fixed so that the rate alone decides
    const swapped = transposeDigits(m.value);
    const slip = forced ?? (input.rate !== undefined && draw.u < input.rate && swapped !== m.value ? ({ kind: "value", request_id: m.request_id, analyte: m.analyte, typed_value: swapped } as EntryError) : undefined);
    const intendedUnit = input.unit_text[m.analyte] ?? null;
    const intendedDilution = dilutions.get(`${m.request_id}/${m.attempt}/${m.visit}`) ?? input.default_dilution;
    const typedUnit = slip?.kind === "unit" ? (slip.typed_unit as string) : intendedUnit;
    const typedDilution = slip?.kind === "dilution" ? (slip.typed_dilution ?? null) : intendedDilution;
    const typedValue = slip?.kind === "value" ? (slip.typed_value as number) : m.value;
    if (slip) applied.push({ request_id: m.request_id, analyte: m.analyte, kind: slip.kind, intended: slip.kind === "value" ? m.value : slip.kind === "unit" ? intendedUnit : intendedDilution, typed: slip.kind === "value" ? typedValue : slip.kind === "unit" ? typedUnit : typedDilution });
    provenance[`${m.analyzer}/${m.request_id}/${m.attempt}/${m.visit}/${m.analyte}`] = {
      entered_by: operator.get(m.request_id) ?? null, raw_ref: null, unit_original: typedUnit, unit_ucum: typedUnit === null ? null : (input.ucum_of[typedUnit] ?? null), dilution_factor: typedDilution,
    };
    return typedValue === m.value ? e : { ...m, value: typedValue };
  });
  return { events, provenance, applied };
};
