import { TWO_CLOCKS, bySampleId } from "./rule_types.ts";
import type { Rule } from "./rule_types.ts";
import type { RecordedDataset } from "./types.ts";

// The key, link and attribution rules: VR-008b, VR-009, VR-011, VR-014, VR-015, VR-019 and VR-020 (data_model section 8).

const needs = (flag: keyof RecordedDataset["architecture"]["flags"], why: string): Rule["unmet"] => (ds) => (ds.architecture.flags[flag] ? null : `${flag} is off: ${why}`);

export const KEY_RULES: Rule[] = [
  {
    id: "VR-008b", severity: "error", action: "quarantine",
    unmet: needs("ingest_idempotency", "no source event id and key, duplicates are rows"),
    check: (ds) => ds.ingest_conflict.map((c) => `source_event:${c.source_event_id}`),
  },
  {
    id: "VR-009", severity: "warning", action: "hold",
    unmet: TWO_CLOCKS,
    check: (ds) => {
      const samples = bySampleId(ds);
      const groups = new Map<string, { ids: Set<string>; results: string[] }>();
      for (const r of ds.result) {
        const s = samples.get(r.request_id);
        if (!s || s.sampled_at === null) continue;
        const key = `${s.unit_id}|${s.sampled_at}|${r.analyte}`;
        const g = groups.get(key) ?? { ids: new Set<string>(), results: [] };
        g.ids.add(r.request_id);
        g.results.push(r.result_id);
        groups.set(key, g);
      }
      return [...groups.values()].filter((g) => g.ids.size > 1).flatMap((g) => g.results.map((id) => `result:${id}`));
    },
  },
  {
    id: "VR-011", severity: "warning", action: "hold",
    unmet: needs("instrument_state_snapshot", "there is no link to miss"),
    check: (ds) => {
      const runs = new Map(ds.run.map((x) => [x.run_id, x]));
      return ds.result.filter((r) => runs.get(r.run_id)?.instrument_state_id === null).map((r) => `result:${r.result_id}`);
    },
  },
  {
    id: "VR-014", severity: "error", action: "reject",
    unmet: needs("system_issued_id", "keys are typed, so there is no registry of issued keys to compare with"),
    check: (ds) => {
      const open = new Set(ds.sample.filter((s) => s.state !== "skipped").map((s) => s.sample_id)); // the registry: keys the plan issued for draws that happened
      return ds.result.filter((r) => !open.has(r.request_id)).map((r) => `result:${r.result_id}`);
    },
  },
  {
    id: "VR-015", severity: "warning", action: "hold",
    unmet: needs("audit_trail", "the operator is free text or absent"),
    check: (ds) => ds.sample.filter((s) => s.state !== "skipped" && (s.operator_id === null || s.qualification_id === null)).map((s) => `sample:${s.sample_id}`),
  },
  {
    id: "VR-019", severity: "error", action: "quarantine",
    unmet: needs("append_only_versions", "an overwrite leaves one version, so there is no version n to miss"),
    check: (ds) => {
      const ids = new Set(ds.result.map((r) => r.result_id));
      return ds.result.filter((r) => r.version > 1 && (r.supersedes === null || !ids.has(r.supersedes))).map((r) => `result:${r.result_id}`);
    },
  },
  {
    id: "VR-020", severity: "error", action: "hold",
    unmet: TWO_CLOCKS,
    check: (ds) =>
      ds.sample.filter((s) => {
        const t = s.sampled_at;
        return s.state !== "skipped" && t !== null && !ds.batch.some((b) => b.unit_id === s.unit_id && b.inoculated_at <= t && (b.harvested_at === null || t < b.harvested_at));
      }).map((s) => `sample:${s.sample_id}`),
  },
];
