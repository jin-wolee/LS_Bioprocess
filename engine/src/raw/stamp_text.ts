import { wallOf } from "../calendar.ts";
import type { Wall } from "../calendar.ts";
import type { DeviceSettings } from "./types.ts";

// Seconds to wall-clock text, inside an emitter only (spec section 2.4.1, rule 1). The text has no zone (RQ1); the order, separator and clock style are the
// device's settings (RQ2); a resolution of a minute or more drops the seconds (RQ3).

type Format = Pick<DeviceSettings, "order" | "separator" | "clock" | "day_part_marker">;

const pad = (n: number, width = 2): string => String(n).padStart(width, "0");

/** The text of a local instant (seconds since the epoch, already shifted into the device's zone). */
export const formatStamp = (local: number, f: Format, resolution_s: number): string => {
  const t = resolution_s >= 60 ? Math.floor(local / 60) * 60 : local;
  const w = wallOf(t);
  const s = f.separator;
  const date = f.order === "year_first" ? `${pad(w.y, 4)}${s}${pad(w.m)}${s}${pad(w.d)}` : f.order === "day_first" ? `${pad(w.d)}${s}${pad(w.m)}${s}${pad(w.y, 4)}` : `${pad(w.m)}${s}${pad(w.d)}${s}${pad(w.y, 4)}`;
  const seconds = resolution_s >= 60 ? "" : `:${pad(w.ss)}`;
  if (f.clock === "24h") return `${date} ${pad(w.hh)}:${pad(w.mm)}${seconds}`;
  const marker = f.day_part_marker ? ` ${w.hh < 12 ? "AM" : "PM"}` : "";
  return `${date} ${pad(w.hh % 12 === 0 ? 12 : w.hh % 12)}:${pad(w.mm)}${seconds}${marker}`;
};

/** Can the written text be read validly in more than one way under the format the device writes (RQ2)? A day and a month of 12 or less that differ, with the year last; or a 12 h clock with no day-part marker. */
export const stampAmbiguous = (w: Pick<Wall, "m" | "d">, f: Format): boolean =>
  (f.order !== "year_first" && w.d !== w.m && w.d <= 12 && w.m <= 12) || (f.clock === "12h" && !f.day_part_marker);

export const localSeconds = (t: number, anchorEpoch: number, zone_offset_s: number): number => anchorEpoch + t + zone_offset_s;
