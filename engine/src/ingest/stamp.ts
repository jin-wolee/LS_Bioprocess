import { secondsOfWall, validDate } from "../calendar.ts";
import type { DateOrder } from "../raw/types.ts";

// Stamp text to a local instant, under what the adapter entry believes (spec section 2.4.3, RQ1 to RQ3). The result is one of: ok (a local instant in seconds since the
// epoch, in the zone of the device), ambiguous (more than one valid reading and nothing pins one) or malformed (no valid reading). A wrong belief is not detectable here:
// a stamp read under the wrong order is a valid but wrong instant (the invisible case of the matrix row for a timestamp misread).

export type StampBelief = { date_order: DateOrder | "unknown"; date_separator: string; clock_style: "24h" | "12h" | "unknown" };
export type StampResult = { status: "ok"; local_s: number } | { status: "ambiguous" } | { status: "malformed" };

const PATTERN = /^(\d{1,4})([-/.])(\d{1,2})\2(\d{1,4}) (\d{1,2}):(\d{2})(?::(\d{2}))?(?: (AM|PM))?$/;

/** The order a file pins when the entry says unknown: a day above 12 shows the day field (RQ2). Null when no row pins it, or two rows disagree. */
export const pinOrder = (texts: readonly string[], belief: StampBelief): DateOrder | null => {
  let found: DateOrder | null = null;
  for (const text of texts) {
    const m = PATTERN.exec(text.trim());
    if (!m || m[2] !== belief.date_separator || (m[1] as string).length === 4) continue;
    const a = Number(m[1]);
    const b = Number(m[3]);
    const here: DateOrder | null = a > 12 && b <= 12 ? "day_first" : b > 12 && a <= 12 ? "month_first" : null;
    if (here !== null && found !== null && found !== here) return null;
    found = here ?? found;
  }
  return found;
};

export const parseStamp = (text: string, belief: StampBelief, pinned: DateOrder | null): StampResult => {
  const m = PATTERN.exec(text.trim());
  if (!m || m[2] !== belief.date_separator) return { status: "malformed" };
  const [a, b, c] = [Number(m[1]), Number(m[3]), Number(m[4])];
  let order: DateOrder | null;
  if (belief.date_order !== "unknown") order = belief.date_order;
  else if ((m[1] as string).length === 4) order = "year_first";
  else order = a > 12 && b <= 12 ? "day_first" : b > 12 && a <= 12 ? "month_first" : a === b ? "day_first" : pinned;
  if (order === null) return { status: "ambiguous" };
  const [y, mo, d] = order === "year_first" ? [a, b, c] : order === "day_first" ? [c, b, a] : [c, a, b];
  const yearDigits = (order === "year_first" ? m[1] : m[4]) as string;
  if (yearDigits.length !== 4 || !validDate(y, mo, d)) return { status: "malformed" };

  const hh = Number(m[5]);
  const mm = Number(m[6]);
  const ss = m[7] === undefined ? 0 : Number(m[7]);
  const marker = m[8]?.toUpperCase();
  if (mm > 59 || ss > 59) return { status: "malformed" };
  const at = (hour: number): StampResult => ({ status: "ok", local_s: secondsOfWall({ y, m: mo, d, hh: hour, mm, ss }) });
  if (belief.clock_style === "24h") return marker !== undefined || hh > 23 ? { status: "malformed" } : at(hh);
  if (marker !== undefined) return hh < 1 || hh > 12 ? { status: "malformed" } : at((hh % 12) + (marker === "PM" ? 12 : 0));
  // no day-part marker: a 12 h clock cannot say AM from PM (RQ2); an unknown style reads an hour above 12 as 24 h
  if (belief.clock_style === "unknown" && hh > 12) return hh > 23 ? { status: "malformed" } : at(hh);
  return { status: "ambiguous" };
};
