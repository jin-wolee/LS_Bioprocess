import { instantIn } from "./link.ts";

// Where the clock of the plant opens (docs/design/plant_ui.md sections 5.5 and 7): after the answer of an operator action it resumes at `resume_at` and plays on if it was playing; otherwise at the
// instant of the link, else where the reader left (an instant outside the run is not used, and the value is given back as the fault, for the notes). Pure.

/** Where the clock resumes after the accepted answer of an action: the epoch of that answer, `resume_at`, and whether the clock was playing when the reader acted. */
export interface Resume {
  epoch: number;
  t: number;
  play: boolean;
}

export interface Opening {
  /** The instant to seek to, or null for the opening of the first shift. */
  t: number | null;
  fault: string | null;
  /** Whether the clock plays on after the seek; null: as it does for any opening (it plays unless the reader prefers reduced motion or an instant was asked for). */
  play: boolean | null;
}

export const openingOf = ({ resume, epoch, linkT, viewT, horizon }: { resume: Resume | null; epoch: number | null; linkT: number | null; viewT: number | null; horizon: number }): Opening => {
  if (resume !== null && resume.epoch === epoch) return { t: resume.t, fault: null, play: resume.play };
  return { ...instantIn(linkT ?? viewT, horizon), play: null };
};
