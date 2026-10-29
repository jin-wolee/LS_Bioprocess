// The ingest store: what an adapter remembers between files (data_model section 7, rules active when ingest_idempotency is on). It is the only state of the parser, and it
// is passed in, so ingesting a set of files twice or in another order is a property of the function and the store (prompts/20 Step 6).

export interface KnownRow {
  content: string;
  canonical_id: string;
}

export interface Latest {
  version: number;
  canonical_id: string;
  /** What tells a reanalysis from a repeat of the same row: the injection and result id of a data system, else the row stamp and sample id. */
  tag: string;
}

export interface IngestStore {
  /** idempotency_key to the first content seen. */
  keys: Map<string, KnownRow>;
  /** `<source>|<sample>|<analyte>|<measured_at>` to the latest version of that measurement. */
  latest: Map<string, Latest>;
  counter: number;
}

export const newStore = (): IngestStore => ({ keys: new Map(), latest: new Map(), counter: 0 });
