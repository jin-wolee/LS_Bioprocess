import type { RecordedDataset } from "../record/types.ts";
import { EXPORT_FIELDS } from "./columns.ts";
import { toCsv } from "./csv.ts";
import { exportRows } from "./rows.ts";

// The data package of an export: results.csv plus datapackage.json in the Frictionless tabular-data-package form. The table schema is the export columns (the data dictionary describes
// the same columns); UCUM units ride as the custom property `ucum`, or `ucum_column` where the unit differs per row. Provenance: seed, engine and schema version, the architecture with its flags,
// the context time, the ledger ids behind the scenario defaults and the data dictionary reference (data_model section 10).

export interface ExportMeta {
  seed: number;
  engine_version: string;
  schema_version: string;
  /** The end of the horizon of the run in seconds: the default of the context time (ruling 5 of S2d). */
  horizon_s: number;
  /** The stated time of the process context (data_model section 5 as-of rule). Omitted: the end of the horizon, and the package metadata says so. */
  context_as_of?: number;
  /** The ledger ids behind the defaults of the run, as plain data from the caller (the scenario's `ref` fields). */
  ledger_ids?: readonly string[];
  dictionary: { path: string; version: string };
}

/**
 * ADR-0008 (Accepted), option 1: "MIT for code, CC BY 4.0 for documents and exported synthetic data". The data package is exported synthetic data, so CC BY 4.0 applies
 * (orchestrator ruling 6 of S2d).
 */
const LICENCE = { name: "CC-BY-4.0", path: "https://creativecommons.org/licenses/by/4.0/", title: "Creative Commons Attribution 4.0 International" };

export interface DataPackage {
  profile: "tabular-data-package";
  name: string;
  title: string;
  licenses: (typeof LICENCE)[];
  resources: {
    name: string;
    path: string;
    format: "csv";
    mediatype: "text/csv";
    encoding: "utf-8";
    dialect: { delimiter: ","; lineTerminator: "\n"; header: true };
    schema: { fields: { name: string; type: string; ucum?: string; ucum_column?: string; constraints: { required: boolean } }[]; missingValues: [""] };
  }[];
  seed: number;
  engine_version: string;
  schema_version: string;
  context_as_of: number;
  /** How the context time was chosen: `stated` by the caller, or `end_of_horizon` by default. */
  context_as_of_basis: "stated" | "end_of_horizon";
  architecture: { id: string; labelling: string; flags: RecordedDataset["architecture"]["flags"] };
  ledger_ids: string[];
  data_dictionary: ExportMeta["dictionary"];
}

export interface ExportedPackage {
  datapackage: DataPackage;
  /** File text by path in the package. */
  files: Record<string, string>;
}

export const exportPackage = (ds: RecordedDataset, meta: ExportMeta): ExportedPackage => {
  const contextAsOf = meta.context_as_of ?? meta.horizon_s;
  const csv = toCsv(EXPORT_FIELDS, exportRows(ds, { context_as_of: contextAsOf }));
  return {
    datapackage: {
      profile: "tabular-data-package",
      name: `${ds.architecture.id}-seed-${meta.seed}`,
      title: `Synthetic released results, architecture ${ds.architecture.id}, seed ${meta.seed}`,
      licenses: [LICENCE],
      resources: [{
        name: "results", path: "results.csv", format: "csv", mediatype: "text/csv", encoding: "utf-8", dialect: { delimiter: ",", lineTerminator: "\n", header: true },
        schema: {
          fields: EXPORT_FIELDS.map((x) => ({ name: x.name, type: x.type, ...(x.ucum && { ucum: x.ucum }), ...(x.ucum_column && { ucum_column: x.ucum_column }), constraints: { required: x.required } })),
          missingValues: [""],
        },
      }],
      seed: meta.seed, engine_version: meta.engine_version, schema_version: meta.schema_version, context_as_of: contextAsOf,
      context_as_of_basis: meta.context_as_of === undefined ? "end_of_horizon" : "stated",
      architecture: { id: ds.architecture.id, labelling: ds.architecture.labelling, flags: ds.architecture.flags },
      ledger_ids: [...new Set(meta.ledger_ids ?? [])].sort(), data_dictionary: meta.dictionary,
    },
    files: { "results.csv": csv },
  };
};
