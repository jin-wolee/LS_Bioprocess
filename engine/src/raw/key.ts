import type { Source } from "./types.ts";

// The hidden raw quirk key (schemas/raw_quirk_key.schema.json, annotated hidden; spec section 2.4.1, rule 6) and the file the emitter returns beside it. Only the emitter, the
// experiment assembly (which writes the key file) and the evaluator (which reads it) may import this module (eslint.config.js, zone 5): the parser, the recorders, the injector and
// the decision arms never see which quirks were realised or what a stamp was meant to say.

/** One entry of the raw quirk key for a written row (schemas/raw_quirk_key.schema.json, files[].rows[]). */
export interface KeyRow {
  line: number;
  sample_id: string;
  intended_s: number;
  resolution_s: number;
  ambiguous: boolean;
  repeat: boolean;
  quirks: string[];
  unreadable: boolean;
}

export interface EmittedFile {
  file_name: string;
  text: string;
  instrument: string;
  dialect_id: string;
  /** The host clock when the file arrived (seconds of the scenario): the ingested_at of everything loaded from it. */
  received_at: number;
  replay_of: string | null;
  key_rows: KeyRow[];
  /** Per data line: the run bookkeeping of the line. */
  manifest: { line: number; src: Source }[];
}
