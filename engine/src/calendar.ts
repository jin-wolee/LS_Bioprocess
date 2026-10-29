// Calendar arithmetic for the raw device layer (spec section 2.4.1, rule 1): the engine's integer seconds become wall-clock text only in an emitter, and
// wall-clock text becomes seconds again only in a parser. Whole-number civil-date arithmetic, so no Date object is used (invariant 2) and a result is the
// same in every runtime. Day 0 of a scenario is a Monday (spec section 2.1); the anchor says which calendar date that is.

const DAY = 86400;

/** Days since 1970-01-01 of a civil date (proleptic Gregorian). */
export const daysFromCivil = (y: number, m: number, d: number): number => {
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const doy = Math.floor((153 * (m > 2 ? m - 3 : m + 9) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
};

export interface Civil {
  y: number;
  m: number;
  d: number;
}

/** The civil date of a day count since 1970-01-01. */
export const civilFromDays = (days: number): Civil => {
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  return { y: yoe + era * 400 + (m <= 2 ? 1 : 0), m, d };
};

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const leap = (y: number): boolean => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** Is (y, m, d) a real calendar date? */
export const validDate = (y: number, m: number, d: number): boolean =>
  Number.isInteger(y) && Number.isInteger(m) && Number.isInteger(d) && m >= 1 && m <= 12 && d >= 1 && d <= (DAYS_IN_MONTH[m - 1] as number) + (m === 2 && leap(y) ? 1 : 0);

/** Epoch seconds (UTC) of 00:00:00 on a date given as YYYY-MM-DD: the calendar anchor of a scenario. */
export const anchorEpoch = (text: string): number => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m || !validDate(Number(m[1]), Number(m[2]), Number(m[3]))) throw new Error(`calendar anchor: ${JSON.stringify(text)} is not a YYYY-MM-DD date`);
  return daysFromCivil(Number(m[1]), Number(m[2]), Number(m[3])) * DAY;
};

export interface Wall {
  y: number;
  m: number;
  d: number;
  hh: number;
  mm: number;
  ss: number;
}

/** The wall-clock parts of a count of seconds since the epoch (already shifted into the zone of the reader). */
export const wallOf = (localSeconds: number): Wall => {
  const days = Math.floor(localSeconds / DAY);
  const rest = localSeconds - days * DAY;
  return { ...civilFromDays(days), hh: Math.floor(rest / 3600), mm: Math.floor((rest % 3600) / 60), ss: rest % 60 };
};

/** Seconds since the epoch of wall-clock parts (the inverse of wallOf). */
export const secondsOfWall = (w: Wall): number => daysFromCivil(w.y, w.m, w.d) * DAY + w.hh * 3600 + w.mm * 60 + w.ss;
