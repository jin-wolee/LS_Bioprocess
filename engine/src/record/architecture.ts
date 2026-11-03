import type { Architecture } from "../generated/architecture.schema";

// An architecture is ten flags and a labelling method (spec section 5; ADR-0005, ADR-0017, ADR-0020). The engine reads no files, so the JSON of a preset
// is checked here with the same rules as data/schemas/architecture.schema.json (a test compares the two on the same bad documents).

export type { Architecture };
export type FlagName = keyof Architecture["flags"];

/** The eight flags of ADR-0005. Where a system writes the rows (a row-creation stamp) is decided by these alone. */
export const CORE_FLAG_NAMES = [
  "system_issued_id", "two_clocks", "available_at", "instrument_state_snapshot", "append_only_versions", "write_time_keys", "ingest_idempotency", "audit_trail",
] as const satisfies readonly FlagName[];

/**
 * The ten flags in the order of the flag table of spec section 5. There is no eleventh. The last two, the lot links of ADR-0017 and the equipment links of ADR-0020, are read only
 * where lots and equipment items exist (spec 11.8, the break-out extension): with no such event nothing reads them and no recorded value changes.
 */
export const FLAG_NAMES = [...CORE_FLAG_NAMES, "material_lot_links", "equipment_links"] as const satisfies readonly FlagName[];

const LABELLING = ["handwritten", "preprinted_barcode", "issued_at_draw"] as const;
const SYSTEMS = ["lims", "mes_ebr"] as const;
const CAPTURE_PATHS = ["manual_transcription", "adapter_ingest"] as const;
const TOP = ["schema_version", "id", "flags", "labelling", "capture_path", "source_of_record"];

const fail = (why: string): never => {
  throw new Error(`architecture: ${why}`);
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export const parseArchitecture = (doc: unknown): Architecture => {
  if (!isRecord(doc)) return fail("the document must be an object");
  for (const k of Object.keys(doc)) if (!TOP.includes(k)) fail(`unknown key ${k}`);
  if (doc.schema_version !== "1") fail('schema_version must be "1"');
  if (typeof doc.id !== "string" || doc.id === "") fail("id must be a non-empty string");
  if (!LABELLING.includes(doc.labelling as (typeof LABELLING)[number])) fail(`labelling must be one of ${LABELLING.join(", ")}`);
  if (doc.capture_path !== undefined && !CAPTURE_PATHS.includes(doc.capture_path as (typeof CAPTURE_PATHS)[number])) fail(`capture_path must be one of ${CAPTURE_PATHS.join(", ")}`);
  if (doc.source_of_record !== undefined && !SYSTEMS.includes(doc.source_of_record as (typeof SYSTEMS)[number])) fail(`source_of_record must be one of ${SYSTEMS.join(", ")}`);
  const flags = doc.flags;
  if (!isRecord(flags)) return fail("flags must be an object");
  for (const k of Object.keys(flags)) if (!(FLAG_NAMES as readonly string[]).includes(k)) fail(`flags.${k} is not one of the ten flags (there is no eleventh)`);
  for (const f of FLAG_NAMES) if (typeof flags[f] !== "boolean") fail(`flags.${f} must be a boolean`);
  return structuredClone(doc) as unknown as Architecture;
};

/** The configuration with exactly one flag off. The flag must be on: an ablation removes one thing, it does not repeat a baseline. */
export const ablate = (cfg: Architecture, flag: FlagName): Architecture => {
  if (!cfg.flags[flag]) return fail(`${cfg.id} has ${flag} off already; an ablation removes a flag that is on`);
  return { ...cfg, id: `${cfg.id}_minus_${flag}`, flags: { ...cfg.flags, [flag]: false } };
};

/** One ablation per flag, in the order of the flag table (spec section 5: C with exactly one flag off, ten runs). */
export const ABLATIONS = (cfg: Architecture): { flag: FlagName; config: Architecture }[] => FLAG_NAMES.map((flag) => ({ flag, config: ablate(cfg, flag) }));
