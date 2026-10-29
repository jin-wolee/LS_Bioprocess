import type { ReviewConfig, Roster } from "../../src/record/review.ts";

// The roster of A201 as test-only numbers, typed by hand (seconds from midnight): staffed from 08:00; the second weekday shift starts at 13:00 and the day
// ends at 18:00; a weekend day is one shift, 08:00 to 14:00. Day 0 is a Monday. The scenario files carry the same numbers; review_pipeline.test.ts compares them.
export const ROSTER: Roster = { start_s: 28800, shift_change_s: 46800, end_weekday_s: 64800, end_weekend_s: 50400 };

/** The default review of the S2 review step: the next shift start (A215). */
export const REVIEW: ReviewConfig = { roster: ROSTER, timing: "next_shift_start" };

/** Seconds of a clock time on a day (day 0 is a Monday): hand arithmetic for the fixtures. */
export const at = (day: number, hour: number, minute = 0, second = 0): number => day * 86400 + hour * 3600 + minute * 60 + second;
